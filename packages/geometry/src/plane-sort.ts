import { createDiagnostic } from "./diagnostics.js";
import { NonParallelPlanesError } from "./errors.js";
import type { Diagnostic, GridPlane, Vec3 } from "./types.js";
import { dot, normalize, scale, sub } from "./vec3.js";

export interface SortPlanesResult {
  readonly planes: GridPlane[];
  readonly diagnostics: Diagnostic[];
}

/**
 * How close two plane projections must be to count as the same physical plane —
 * floating-point round-trip noise, not real slice spacing. This is its own constant,
 * not `GridTolerance.positionMm`, which answers a different question at a coarser,
 * caller-tunable scale: how far apart can two whole grids' plane positions be and still
 * count as the same geometry. Reusing that here would treat two genuinely distinct thin
 * slices — e.g. 10.0mm and 10.4mm, a normal CT slice spacing — as duplicates and
 * silently drop one.
 */
const DUPLICATE_PLANE_EPSILON_MM = 1e-3;

/**
 * How far a plane's origin may sit off the axis through the reference plane before the
 * stack is rejected as non-parallel. Also its own constant, not `GridTolerance.positionMm`
 * — this answers a third, different question from both `equals()` (are two already-built
 * grids the same geometry) and the dedup constant above (is this literally the same
 * plane). `createGridGeometry` doesn't currently expose a way to override this per call;
 * if that's ever added, this is the value to promote into a real parameter.
 */
const OFF_AXIS_TOLERANCE_MM = 0.5;

/** Component of p, relative to ref, perpendicular to n. Zero iff p sits on the plane through ref with normal n. */
function perpendicularOffset(p: Vec3, ref: Vec3, n: Vec3): number {
  const rel = sub(p, ref);
  const perp = sub(rel, scale(n, dot(rel, n)));
  return Math.sqrt(dot(perp, perp));
}

/**
 * Sorts planes by projection onto `normal`, dedupes near-identical positions, and rejects
 * planes that do not stack purely along `normal` (v0.1 grid constraint — see
 * IMPLEMENTATION_PLAN.md section 2). Deliberately takes no `GridTolerance` — the two
 * tolerances this function needs (duplicate detection, off-axis rejection) are each their
 * own dedicated constant; see the comments on `DUPLICATE_PLANE_EPSILON_MM` and
 * `OFF_AXIS_TOLERANCE_MM` above for why they aren't `GridTolerance.positionMm`.
 */
export function sortPlanes(planes: readonly GridPlane[], normal: Vec3): SortPlanesResult {
  if (planes.length === 0) return { planes: [], diagnostics: [] };

  const n = normalize(normal);
  const reference = planes[0]!.position;

  for (const plane of planes) {
    // Non-finite coordinates (malformed DICOM ImagePositionPatient) never touch normalize()
    // like direction vectors do — they only feed dot/sub, which produce NaN silently rather
    // than throwing. Catch that here, at construction, before it corrupts sort order or a
    // distance comparison downstream.
    if (plane.position.some((c) => !Number.isFinite(c))) {
      throw new RangeError(`plane position [${plane.position.join(", ")}] contains a non-finite coordinate`);
    }
    const offset = perpendicularOffset(plane.position, reference, n);
    if (offset > OFF_AXIS_TOLERANCE_MM) {
      throw new NonParallelPlanesError(
        `plane at [${plane.position.join(", ")}] is not parallel to the grid normal ` +
          `(${offset.toFixed(3)}mm off-axis, tolerance ${OFF_AXIS_TOLERANCE_MM}mm)`,
      );
    }
  }

  const withProjection = planes
    .map((plane) => ({ plane, projection: dot(plane.position, n) }))
    .sort((a, b) => a.projection - b.projection);

  const result: GridPlane[] = [];
  const diagnostics: Diagnostic[] = [];
  let lastProjection: number | undefined;

  for (const { plane, projection } of withProjection) {
    if (lastProjection !== undefined && Math.abs(projection - lastProjection) <= DUPLICATE_PLANE_EPSILON_MM) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_PLANE_POSITION",
          "info",
          "duplicate plane position dropped during sort",
          { projection, toleranceMm: DUPLICATE_PLANE_EPSILON_MM },
        ),
      );
      continue;
    }
    result.push(plane);
    lastProjection = projection;
  }

  return { planes: result, diagnostics };
}
