import { FrameOfReferenceMismatchError } from "./errors.js";
import { checkVoxelBudget, DEFAULT_MAX_VOXELS, maskFromDense } from "./mask3d.js";
import { createScalarField, type ScalarField3D } from "./scalar-field.js";
import type { GridGeometry, Mask3D, Vec3 } from "./types.js";
import { dot } from "./vec3.js";

export type InterpMethod = "trilinear" | "nearest";

export interface SampleOptions {
  /** Default `"trilinear"`. */
  method?: InterpMethod;
  /** Value returned for a point outside the source grid's extent. Default `0`. */
  outOfBounds?: number;
}

export interface ResampleOptions extends SampleOptions {
  /** Allocation guard for the resampled grid (SEC-01). Default `DEFAULT_MAX_VOXELS`. */
  maxVoxels?: number;
}

const EPS = 1e-9;

/**
 * Continuous grid index `(fx = column, fy = row, fz = plane fraction)` for a physical
 * point, or `null` if the point projects outside the plane stack along the grid normal.
 * Plane spacing may be irregular, so `fz` interpolates between the two bracketing planes
 * by their projected positions, not by a constant pitch.
 */
function toContinuousIndex(g: GridGeometry, p: Vec3): { fx: number; fy: number; fz: number } | null {
  const planes = g.planes;
  const n = planes.length;
  const normal = g.normal();
  const s = dot(p, normal);

  let fz: number;
  if (n === 1) {
    fz = 0;
  } else {
    const s0 = dot(planes[0]!.position, normal);
    const sLast = dot(planes[n - 1]!.position, normal);
    if (s < s0 - EPS || s > sLast + EPS) return null;
    let k = 0;
    while (k < n - 2 && dot(planes[k + 1]!.position, normal) < s) k++;
    const a = dot(planes[k]!.position, normal);
    const b = dot(planes[k + 1]!.position, normal);
    const span = b - a;
    fz = k + (Math.abs(span) < EPS ? 0 : (s - a) / span);
  }

  // v0.1 grids stack purely along the normal (sortPlanes enforces < 0.5mm off-axis), so
  // patientToPixel returns the same (column, row) for any plane index.
  const kFloor = Math.max(0, Math.min(n - 1, Math.floor(fz)));
  const px = g.patientToPixel(p, kFloor);
  return { fx: px.column, fy: px.row, fz };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Value of `field` at an arbitrary physical point. `"trilinear"` interpolates the 8
 * surrounding voxels (corner-clamped at the grid boundary); `"nearest"` returns the
 * containing voxel. A point outside the grid extent (more than half a voxel past any
 * edge, or off the end of the plane stack) returns `opts.outOfBounds` (default `0`).
 */
export function sampleFieldAt(field: ScalarField3D, point: Vec3, opts: SampleOptions = {}): number {
  const method = opts.method ?? "trilinear";
  const oob = opts.outOfBounds ?? 0;
  const [columns, rows, planeCount] = field.dimensions;

  const idx = toContinuousIndex(field.geometry, point);
  if (!idx) return oob;
  const { fx, fy, fz } = idx;
  if (fx < -0.5 || fx > columns - 0.5 || fy < -0.5 || fy > rows - 0.5) return oob;

  if (method === "nearest") {
    const c = Math.round(fx);
    const r = Math.round(fy);
    const k = Math.round(fz);
    if (c < 0 || c >= columns || r < 0 || r >= rows || k < 0 || k >= planeCount) return oob;
    return field.get(c, r, k);
  }

  const clampC = (v: number): number => (v < 0 ? 0 : v > columns - 1 ? columns - 1 : v);
  const clampR = (v: number): number => (v < 0 ? 0 : v > rows - 1 ? rows - 1 : v);
  const clampK = (v: number): number => (v < 0 ? 0 : v > planeCount - 1 ? planeCount - 1 : v);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  const plane = (dz: number): number => {
    const k = clampK(z0 + dz);
    const c0 = clampC(x0);
    const c1 = clampC(x0 + 1);
    const r0 = clampR(y0);
    const r1 = clampR(y0 + 1);
    const top = lerp(field.get(c0, r0, k), field.get(c1, r0, k), tx);
    const bot = lerp(field.get(c0, r1, k), field.get(c1, r1, k), tx);
    return lerp(top, bot, ty);
  };

  return planeCount === 1 ? plane(0) : lerp(plane(0), plane(1), tz);
}

function assertCompatibleFrame(a: GridGeometry, b: GridGeometry): void {
  const fa = a.frameOfReferenceUID;
  const fb = b.frameOfReferenceUID;
  if (fa !== undefined && fb !== undefined && fa !== fb) {
    throw new FrameOfReferenceMismatchError(
      `cannot resample between frames of reference "${fa}" and "${fb}" — the coordinate ` +
        `systems are not physically comparable, so an interpolated value would be meaningless`,
    );
  }
}

/**
 * Resamples `source` onto `target`'s voxel grid: each target voxel gets `source`'s value
 * interpolated at that voxel's physical centre. This is the operation that lets a dose
 * field (a coarse `ScalarField3D`) be compared against a fine structure grid — resample
 * the dose onto the structure grid, then histogram. Throws `FrameOfReferenceMismatchError`
 * if the two grids declare different frames of reference.
 */
export function resampleField(
  source: ScalarField3D,
  target: GridGeometry,
  opts: ResampleOptions = {},
): ScalarField3D {
  assertCompatibleFrame(source.geometry, target);
  return createScalarField(
    target,
    (c, r, k) => sampleFieldAt(source, target.indexToPatient(c, r, k), opts),
    opts.maxVoxels ?? DEFAULT_MAX_VOXELS,
  );
}

/**
 * Resamples a boolean `source` mask onto `target`'s grid by nearest-voxel membership —
 * the reverse direction of {@link resampleField}, for callers who would rather move the
 * structure onto the dose grid than the dose onto the structure grid. Nearest only:
 * interpolating a boolean is not meaningful. Throws `FrameOfReferenceMismatchError` on a
 * frame-of-reference mismatch.
 */
export function resampleMask(
  source: Mask3D,
  target: GridGeometry,
  opts: { maxVoxels?: number } = {},
): Mask3D {
  assertCompatibleFrame(source.geometry, target);
  const voxelCount = checkVoxelBudget(target, opts.maxVoxels ?? DEFAULT_MAX_VOXELS);
  const [sc, sr, sp] = source.dimensions;
  const data = new Uint8Array(voxelCount);
  const { columns, rows } = target;

  let w = 0;
  for (let k = 0; k < target.planes.length; k++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++, w++) {
        const idx = toContinuousIndex(source.geometry, target.indexToPatient(c, r, k));
        if (!idx) continue;
        const cc = Math.round(idx.fx);
        const rr = Math.round(idx.fy);
        const kk = Math.round(idx.fz);
        if (cc >= 0 && cc < sc && rr >= 0 && rr < sr && kk >= 0 && kk < sp && source.get(cc, rr, kk)) {
          data[w] = 1;
        }
      }
    }
  }
  return maskFromDense(target, data);
}
