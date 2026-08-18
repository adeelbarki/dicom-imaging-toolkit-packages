import { createDiagnostic } from "../diagnostics/index.js";
import { XorHomogeneityError } from "../errors.js";
import { maskFromDense } from "../mask/mask3d.js";
import type { Diagnostic, GridGeometry, HoleInterpretation, Mask3D, Provenance } from "../types.js";
import type { Contour } from "./types.js";

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
  const xorContours = contours.filter((c) => c.geometricType === "CLOSEDPLANAR_XOR");
  const closedPlanarContours = contours.filter((c) => c.geometricType === "CLOSED_PLANAR");

  if (xorContours.length > 0 && xorContours.length !== contours.length) {
    throw new XorHomogeneityError("cannot mix CLOSEDPLANAR_XOR with other geometric types in one ROI");
  }

  const diagnostics: Diagnostic[] = [];
  let holeInterpretation: HoleInterpretation;
  let fillable: readonly Contour[];

  if (xorContours.length > 0) {
    holeInterpretation = "xor";
    fillable = xorContours;
  } else if (closedPlanarContours.length > 1) {
    holeInterpretation = "nested-even-odd";
    fillable = closedPlanarContours;
    diagnostics.push(
      createDiagnostic(
        "NESTED_CLOSED_PLANAR_INTERPRETED",
        "info",
        `${closedPlanarContours.length} nested CLOSED_PLANAR contours on one plane interpreted via even-odd fill`,
      ),
    );
  } else {
    holeInterpretation = "none";
    fillable = closedPlanarContours;
  }

  const byPlane = new Map<number, Contour[]>();
  for (const contour of fillable) {
    const { planeIndex } = grid.findNearestPlane(at(contour.points, 0));
    const list = byPlane.get(planeIndex);
    if (list) list.push(contour);
    else byPlane.set(planeIndex, [contour]);
  }

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
