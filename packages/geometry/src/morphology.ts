import { createScalarField } from "./scalar-field.js";
import type { ScalarField3D } from "./scalar-field.js";
import { maskFromDense } from "./mask3d.js";
import type { GridGeometry, Mask3D } from "./types.js";

const INF = 1e20;

/**
 * Felzenszwalb–Huttenlocher 1D squared-distance transform with an anisotropic scale.
 * Given `f[0..n-1]`, writes `d[i] = min_j ( scale * (i - j)^2 + f[j] )`. `scale` is the
 * squared physical spacing along this axis (mm² per voxel²). O(n).
 */
function dt1d(f: Float64Array, d: Float64Array, n: number, scale: number): void {
  const v = new Int32Array(n); // locations of parabolas in the lower envelope
  const z = new Float64Array(n + 1); // boundaries between parabolas
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s =
      ((f[q] as number) + scale * q * q - ((f[v[k] as number] as number) + scale * (v[k] as number) * (v[k] as number))) /
      (2 * scale * q - 2 * scale * (v[k] as number));
    while (s <= (z[k] as number)) {
      k--;
      s =
        ((f[q] as number) + scale * q * q - ((f[v[k] as number] as number) + scale * (v[k] as number) * (v[k] as number))) /
        (2 * scale * q - 2 * scale * (v[k] as number));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const dq = q - (v[k] as number);
    d[q] = scale * dq * dq + (f[v[k] as number] as number);
  }
}

/** Mean plane-to-plane spacing along the normal, or 0 for a single-plane grid. */
function meanPlaneSpacingMm(grid: GridGeometry): number {
  const planes = grid.planes;
  if (planes.length < 2) return 0;
  const n = grid.normal();
  const proj = (i: number) => {
    const p = planes[i]!.position;
    return p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
  };
  return (proj(planes.length - 1) - proj(0)) / (planes.length - 1);
}

/** Full 3D squared-distance field (mm²) from every voxel to the nearest set voxel of `seed`. */
function squaredDistanceToSet(seed: Uint8Array, grid: GridGeometry): Float64Array {
  const columns = grid.columns;
  const rows = grid.rows;
  const planes = grid.planes.length;
  const sliceSize = columns * rows;

  const g = new Float64Array(seed.length);
  for (let i = 0; i < seed.length; i++) g[i] = seed[i] !== 0 ? 0 : INF;

  const colScale = grid.pixelSpacing[1] * grid.pixelSpacing[1]; // spacing along rowDirection (columns)
  const rowScale = grid.pixelSpacing[0] * grid.pixelSpacing[0]; // spacing along columnDirection (rows)
  const planeSpacing = meanPlaneSpacingMm(grid);
  const planeScale = planeSpacing * planeSpacing;

  const maxLen = Math.max(columns, rows, planes);
  const fbuf = new Float64Array(maxLen);
  const dbuf = new Float64Array(maxLen);

  // Pass 1 — along columns (x), for each (row, plane).
  for (let k = 0; k < planes; k++) {
    for (let r = 0; r < rows; r++) {
      const base = k * sliceSize + r * columns;
      for (let c = 0; c < columns; c++) fbuf[c] = g[base + c] as number;
      dt1d(fbuf, dbuf, columns, colScale);
      for (let c = 0; c < columns; c++) g[base + c] = dbuf[c] as number;
    }
  }
  // Pass 2 — along rows (y), for each (column, plane).
  for (let k = 0; k < planes; k++) {
    for (let c = 0; c < columns; c++) {
      const base = k * sliceSize + c;
      for (let r = 0; r < rows; r++) fbuf[r] = g[base + r * columns] as number;
      dt1d(fbuf, dbuf, rows, rowScale);
      for (let r = 0; r < rows; r++) g[base + r * columns] = dbuf[r] as number;
    }
  }
  // Pass 3 — along planes (z). Skipped for a single-plane grid (no through-plane distance).
  if (planes >= 2 && planeScale > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const base = r * columns + c;
        for (let k = 0; k < planes; k++) fbuf[k] = g[base + k * sliceSize] as number;
        dt1d(fbuf, dbuf, planes, planeScale);
        for (let k = 0; k < planes; k++) g[base + k * sliceSize] = dbuf[k] as number;
      }
    }
  }
  return g;
}

function densify(mask: Mask3D): Uint8Array {
  const [columns, rows, planes] = mask.dimensions;
  const out = new Uint8Array(columns * rows * planes);
  const sliceSize = columns * rows;
  for (let k = 0; k < planes; k++) {
    const s = mask.getSliceBuffer(k);
    const base = k * sliceSize;
    for (let i = 0; i < sliceSize; i++) if (s[i] !== 0) out[base + i] = 1;
  }
  return out;
}

export interface DistanceTransformOptions {
  /** When `true`, voxels **inside** the mask get the negative distance to the nearest
   *  background voxel; outside stays positive. Default `false` (0 inside, positive outside). */
  readonly signed?: boolean;
}

/**
 * Euclidean distance (mm) from every voxel to the nearest set voxel of `mask`, as a
 * `ScalarField3D` on the same grid. Exact in-plane (Felzenszwalb–Huttenlocher, anisotropic
 * by `pixelSpacing`). The through-plane axis uses the grid's **mean** plane spacing — for a
 * non-uniformly spaced grid this is an approximation; use `planeThicknessMm` if you need
 * the per-plane value, or resample to a uniform grid first. A single-plane grid gets a
 * purely in-plane transform.
 */
export function distanceTransformMm(mask: Mask3D, opts: DistanceTransformOptions = {}): ScalarField3D {
  const grid = mask.geometry;
  const fg = densify(mask);
  const outside = squaredDistanceToSet(fg, grid);

  const values = new Float32Array(outside.length);
  for (let i = 0; i < outside.length; i++) values[i] = Math.sqrt(outside[i] as number);

  if (opts.signed) {
    const bg = new Uint8Array(fg.length);
    for (let i = 0; i < fg.length; i++) bg[i] = fg[i] === 0 ? 1 : 0;
    const inside = squaredDistanceToSet(bg, grid);
    for (let i = 0; i < fg.length; i++) {
      if (fg[i] !== 0) values[i] = -Math.sqrt(inside[i] as number);
    }
  }

  return createScalarField(grid, values);
}

function distanceField(mask: Mask3D, fromComplement: boolean): Float64Array {
  const grid = mask.geometry;
  const fg = densify(mask);
  if (!fromComplement) return squaredDistanceToSet(fg, grid);
  const bg = new Uint8Array(fg.length);
  for (let i = 0; i < fg.length; i++) bg[i] = fg[i] === 0 ? 1 : 0;
  return squaredDistanceToSet(bg, grid);
}

/**
 * Grow `mask` by `mm` in physical (mm) space: every voxel whose centre is within `mm` of a
 * set voxel is included. True Euclidean dilation (a mm-radius ball), anisotropic by
 * `pixelSpacing`; see {@link distanceTransformMm} for the through-plane caveat.
 * `dilateMm(mask, 0)` returns a copy of `mask`.
 */
export function dilateMm(mask: Mask3D, mm: number): Mask3D {
  if (!Number.isFinite(mm) || mm < 0) throw new RangeError(`dilateMm radius must be finite and >= 0, got ${mm}`);
  const sq = mm * mm;
  const d2 = distanceField(mask, false); // squared distance to the foreground
  const out = new Uint8Array(d2.length);
  for (let i = 0; i < d2.length; i++) if ((d2[i] as number) <= sq) out[i] = 1;
  return maskFromDense(mask.geometry, out);
}

/**
 * Shrink `mask` by `mm` in physical space: a set voxel is kept only if it is **more than**
 * `mm` from the nearest background voxel. True Euclidean erosion, the exact dual of
 * {@link dilateMm} (`dilateMm(A, r) = ¬erodeMm(¬A, r)`), anisotropic by `pixelSpacing`;
 * see {@link distanceTransformMm} for the through-plane caveat. `erodeMm(mask, 0)` returns
 * a copy of `mask`.
 */
export function erodeMm(mask: Mask3D, mm: number): Mask3D {
  if (!Number.isFinite(mm) || mm < 0) throw new RangeError(`erodeMm radius must be finite and >= 0, got ${mm}`);
  const sq = mm * mm;
  const fg = densify(mask);
  const d2 = distanceField(mask, true); // squared distance to the background
  const out = new Uint8Array(fg.length);
  for (let i = 0; i < fg.length; i++) if (fg[i] !== 0 && (d2[i] as number) > sq) out[i] = 1;
  return maskFromDense(mask.geometry, out);
}
