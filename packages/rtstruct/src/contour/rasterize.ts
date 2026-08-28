import {
  createDiagnostic,
  dot,
  maskFromDense,
  sub,
  type Diagnostic,
  type GridGeometry,
  type HoleInterpretation,
  type Mask3D,
  type Provenance,
  type Vec3,
} from "rt-geometry-js";
import { MalformedContourError, XorHomogeneityError } from "../errors.js";
import type { Contour, ContourGeometricType } from "./types.js";

export interface RasterizeResult {
  readonly mask: Mask3D;
  readonly provenance: Provenance;
  readonly diagnostics: readonly Diagnostic[];
}

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`point index ${index} out of range (length ${arr.length})`);
  return value;
}

/** Below this, a contour of the given type can never represent meaningful geometry —
 *  raw count only, not true uniqueness (checking that would need its own tolerance). */
const MIN_POINTS: Record<ContourGeometricType, number> = {
  POINT: 1,
  OPEN_PLANAR: 2,
  OPEN_NONPLANAR: 2,
  CLOSED_PLANAR: 3,
  CLOSEDPLANAR_XOR: 3,
};

/** Only CLOSED_PLANAR/CLOSEDPLANAR_XOR can be filled — see rasterize()'s UNSUPPORTED_CONTOUR_GEOMETRY diagnostic. */
function isFillableType(t: ContourGeometricType): boolean {
  return t === "CLOSED_PLANAR" || t === "CLOSEDPLANAR_XOR";
}

interface Edge {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function contourEdges(contour: Contour, grid: GridGeometry, planeIndex: number): Edge[] {
  const pixels = contour.points.map((p) => grid.patientToPixel(p, planeIndex));
  const n = pixels.length;
  return pixels.map((a, i) => {
    const b = at(pixels, (i + 1) % n);
    return { x0: a.column, y0: a.row, x1: b.column, y1: b.row };
  });
}

/**
 * Even-odd ray-cast test with the half-open edge rule (y0 <= y < y1): an
 * edge counts as crossing row y only on its lower endpoint, never its
 * upper one. This is what makes keyhole channels (traversed once out, once
 * back along the same segment) cancel to zero net crossings instead of
 * double-counting and filling the hole solid.
 */
function isInside(edges: readonly Edge[], x: number, y: number): boolean {
  let inside = false;
  for (const e of edges) {
    const crosses = (e.y0 <= y && y < e.y1) || (e.y1 <= y && y < e.y0);
    if (!crosses) continue;
    const xCross = e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0);
    if (x < xCross) inside = !inside;
  }
  return inside;
}

/**
 * How far, in mm, a point may sit from a plane before it's flagged as anomalous — half
 * the local inter-plane spacing (same average-neighbor-distance idea as
 * mask3d.ts's planeThicknessMm, computed independently here so this module doesn't need
 * to depend on mask/ for one calculation). A single-plane grid has no spacing to judge
 * against, so nothing is ever flagged for one — the safe default when we lack the info to
 * tell anomalous from normal, rather than assuming the worst.
 */
function localPlaneToleranceMm(grid: GridGeometry, planeIndex: number): number {
  const normal = grid.normal();
  const planes = grid.planes;
  const n = planes.length;
  if (n === 1) return Infinity;
  const proj = (i: number) => dot(at(planes, i).position, normal);
  const thicknessMm =
    planeIndex === 0
      ? proj(1) - proj(0)
      : planeIndex === n - 1
        ? proj(n - 1) - proj(n - 2)
        : (proj(planeIndex + 1) - proj(planeIndex - 1)) / 2;
  return thicknessMm / 2;
}

function distanceToPlaneMm(point: Vec3, grid: GridGeometry, planeIndex: number): number {
  return Math.abs(dot(sub(point, at(grid.planes, planeIndex).position), grid.normal()));
}

/**
 * Cheap, sufficient nesting test: does any contour's first point land inside another
 * contour's edges on the same plane? True for genuine containment (a hole or an island
 * inside another shape); false for disjoint components sitting side by side — even-odd
 * fills both correctly, but only the first is actually "nested."
 */
function hasNesting(contours: readonly Contour[], grid: GridGeometry, planeIndex: number): boolean {
  for (const candidate of contours) {
    for (const container of contours) {
      if (candidate === container) continue;
      const containerEdges = contourEdges(container, grid, planeIndex);
      const px = grid.patientToPixel(at(candidate.points, 0), planeIndex);
      if (isInside(containerEdges, px.column, px.row)) return true;
    }
  }
  return false;
}

function fillPlane(
  data: Uint8Array,
  planeIndex: number,
  sliceSize: number,
  grid: GridGeometry,
  contours: readonly Contour[],
): void {
  const edges = contours.flatMap((c) => contourEdges(c, grid, planeIndex));
  const offset = planeIndex * sliceSize;
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (isInside(edges, column, row)) data[offset + row * grid.columns + column] = 1;
    }
  }
}

function createProvenance(holeInterpretation: HoleInterpretation): Provenance {
  return {
    sliceAssociation: "geometric-fallback",
    holeInterpretation,
    frameOfReferenceOverride: false,
    redact(): Provenance {
      return createProvenance(holeInterpretation);
    },
  };
}

/** contours -> mask. Half-open edge rule (y0 <= y < y1) — see IMPLEMENTATION_PLAN.md Phase 3. */
export function rasterize(contours: readonly Contour[], grid: GridGeometry): RasterizeResult {
  for (const contour of contours) {
    const min = MIN_POINTS[contour.geometricType];
    if (contour.points.length < min) {
      throw new MalformedContourError(
        `${contour.geometricType} contour has ${contour.points.length} point(s), at least ${min} required`,
      );
    }
    // A NaN/Infinity coordinate — a malformed ContourData DS value, or a bad transform
    // upstream — otherwise flows straight into patientToPixel/findNearestPlane, where every
    // comparison against it is silently false: the contour vanishes from the fill or lands
    // on the wrong plane with no error. Reject it here, where the message can still name
    // the cause.
    for (const point of contour.points) {
      if (!point.every((c) => Number.isFinite(c))) {
        throw new MalformedContourError(
          `${contour.geometricType} contour has a non-finite point coordinate [${point.join(", ")}] ` +
            `— likely malformed ContourData (NaN or Infinity)`,
        );
      }
    }
  }

  const xorContours = contours.filter((c) => c.geometricType === "CLOSEDPLANAR_XOR");
  const closedPlanarContours = contours.filter((c) => c.geometricType === "CLOSED_PLANAR");

  if (xorContours.length > 0 && xorContours.length !== contours.length) {
    throw new XorHomogeneityError("cannot mix CLOSEDPLANAR_XOR with other geometric types in one ROI");
  }

  const diagnostics: Diagnostic[] = [];

  const unsupported = contours.filter((c) => !isFillableType(c.geometricType));
  if (unsupported.length > 0) {
    const types = [...new Set(unsupported.map((c) => c.geometricType))].join(", ");
    diagnostics.push(
      createDiagnostic(
        "UNSUPPORTED_CONTOUR_GEOMETRY",
        "warning",
        `${unsupported.length} contour(s) of type ${types} cannot be represented as a filled Mask3D and were skipped`,
        { count: unsupported.length },
      ),
    );
  }

  const usingXor = xorContours.length > 0;
  const fillable: readonly Contour[] = usingXor ? xorContours : closedPlanarContours;

  // Group by plane FIRST — hole interpretation is a per-plane question (multiple contours
  // spread across different planes are not "nested," they're just different slices), and
  // grouping also validates slice association instead of trusting contour.points[0] blindly.
  const byPlane = new Map<number, Contour[]>();
  for (const contour of fillable) {
    const { planeIndex, distanceMm } = grid.findNearestPlane(at(contour.points, 0));
    const tol = localPlaneToleranceMm(grid, planeIndex);

    if (distanceMm > tol) {
      diagnostics.push(
        createDiagnostic(
          "CONTOUR_PLANE_DISTANCE",
          "warning",
          `contour's first point is ${distanceMm.toFixed(2)}mm from its nearest plane ` +
            `(index ${planeIndex}), farther than the local tolerance of ${tol.toFixed(2)}mm`,
          { planeIndex, distanceMm },
        ),
      );
    } else {
      // Only check internal coplanarity once slice association itself looks sane —
      // otherwise this would double-report the same underlying problem.
      for (const point of contour.points) {
        const d = distanceToPlaneMm(point, grid, planeIndex);
        if (d > tol) {
          diagnostics.push(
            createDiagnostic(
              "CONTOUR_PLANE_DISTANCE",
              "warning",
              `a point in this contour is ${d.toFixed(2)}mm from the plane it was assigned ` +
                `to (index ${planeIndex}) — CLOSED_PLANAR/CLOSEDPLANAR_XOR points should be coplanar`,
              { planeIndex, distanceMm: d },
            ),
          );
          break;
        }
      }
    }

    const list = byPlane.get(planeIndex);
    if (list) list.push(contour);
    else byPlane.set(planeIndex, [contour]);
  }

  // Now that grouping is correct, hole interpretation is decided per plane, not from the
  // ROI-wide contour count — a 4-plane ROI with one contour per plane is never "nested."
  let anyNested = false;
  for (const [planeIndex, planeContours] of byPlane) {
    if (!usingXor && planeContours.length > 1 && hasNesting(planeContours, grid, planeIndex)) {
      anyNested = true;
      diagnostics.push(
        createDiagnostic(
          "NESTED_CLOSED_PLANAR_INTERPRETED",
          "info",
          `${planeContours.length} nested CLOSED_PLANAR contours on plane ${planeIndex} interpreted via even-odd fill`,
          { planeIndex },
        ),
      );
    }
  }
  const holeInterpretation: HoleInterpretation = usingXor ? "xor" : anyNested ? "nested-even-odd" : "none";

  const sliceSize = grid.columns * grid.rows;
  const data = new Uint8Array(sliceSize * grid.planes.length);
  for (const [planeIndex, planeContours] of byPlane) {
    fillPlane(data, planeIndex, sliceSize, grid, planeContours);
  }

  return {
    mask: maskFromDense(grid, data),
    provenance: createProvenance(holeInterpretation),
    diagnostics,
  };
}
