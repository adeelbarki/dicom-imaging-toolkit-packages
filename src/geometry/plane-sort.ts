import { createDiagnostic } from "../diagnostics/index.js";
import { NonParallelPlanesError } from "../errors.js";
import type { Diagnostic, GridPlane, GridTolerance, Vec3 } from "../types.js";
import { DEFAULT_TOLERANCE } from "./tolerance.js";
import { dot, normalize, scale, sub } from "./vec3.js";

export interface SortPlanesResult {
  readonly planes: GridPlane[];
  readonly diagnostics: Diagnostic[];
}

/** Component of p, relative to ref, perpendicular to n. Zero iff p sits on the plane through ref with normal n. */
function perpendicularOffset(p: Vec3, ref: Vec3, n: Vec3): number {
  const rel = sub(p, ref);
  const perp = sub(rel, scale(n, dot(rel, n)));
  return Math.sqrt(dot(perp, perp));
}

/**
 * Sorts planes by projection onto `normal`, dedupes positions within
 * tolerance, and rejects planes that do not stack purely along `normal`
 * (v0.1 grid constraint — see IMPLEMENTATION_PLAN.md section 2).
 */
export function sortPlanes(
  planes: readonly GridPlane[],
  normal: Vec3,
  tolerance: GridTolerance = DEFAULT_TOLERANCE,
): SortPlanesResult {
  if (planes.length === 0) return { planes: [], diagnostics: [] };

  const n = normalize(normal);
  const reference = planes[0]!.position;

  for (const plane of planes) {
    const offset = perpendicularOffset(plane.position, reference, n);
    if (offset > tolerance.positionMm) {
      throw new NonParallelPlanesError(
        `plane at [${plane.position.join(", ")}] is not parallel to the grid normal ` +
          `(${offset.toFixed(3)}mm off-axis, tolerance ${tolerance.positionMm}mm)`,
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
    if (lastProjection !== undefined && Math.abs(projection - lastProjection) <= tolerance.positionMm) {
      diagnostics.push(
        createDiagnostic(
          "DUPLICATE_PLANE_POSITION",
          "info",
          "duplicate plane position dropped during sort",
          { projection, toleranceMm: tolerance.positionMm },
        ),
      );
      continue;
    }
    result.push(plane);
    lastProjection = projection;
  }

  return { planes: result, diagnostics };
}
