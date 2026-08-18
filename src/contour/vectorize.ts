import type { Mask3D } from "../types.js";
import type { Contour } from "./types.js";

interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface HalfEdge {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Boundary edges of the filled cells in a binary raster, in the unit-square
 * lattice (a filled cell at (row, column) occupies [column-0.5, column+0.5]
 * x [row-0.5, row+0.5]). One edge is emitted per filled-cell side that
 * borders an unfilled (or out-of-bounds) neighbor. Because these boundaries
 * always sit at half-integer offsets, they never touch the integer sample
 * points rasterize() tests against — the round trip is exact, not just close.
 */
function boundaryEdges(buffer: Uint8Array, rows: number, columns: number): HalfEdge[] {
  const filled = (row: number, column: number): boolean =>
    row >= 0 && row < rows && column >= 0 && column < columns && buffer[row * columns + column] !== 0;

  const edges: HalfEdge[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!filled(row, column)) continue;
      if (!filled(row - 1, column)) edges.push({ x0: column - 0.5, y0: row - 0.5, x1: column + 0.5, y1: row - 0.5 });
      if (!filled(row, column + 1)) edges.push({ x0: column + 0.5, y0: row - 0.5, x1: column + 0.5, y1: row + 0.5 });
      if (!filled(row + 1, column)) edges.push({ x0: column + 0.5, y0: row + 0.5, x1: column - 0.5, y1: row + 0.5 });
      if (!filled(row, column - 1)) edges.push({ x0: column - 0.5, y0: row + 0.5, x1: column - 0.5, y1: row - 0.5 });
    }
  }
  return edges;
}

/** Stitches boundary edges (matching endpoint-to-startpoint) into closed loops. */
function linkLoops(edges: readonly HalfEdge[]): Point2D[][] {
  const key = (x: number, y: number): string => `${x},${y}`;
  const byStart = new Map<string, HalfEdge[]>();
  for (const edge of edges) {
    const k = key(edge.x0, edge.y0);
    const list = byStart.get(k);
    if (list) list.push(edge);
    else byStart.set(k, [edge]);
  }

  const used = new Set<HalfEdge>();
  const loops: Point2D[][] = [];
  for (const start of edges) {
    if (used.has(start)) continue;
    const loop: Point2D[] = [{ x: start.x0, y: start.y0 }];
    let current: HalfEdge = start;
    for (;;) {
      used.add(current);
      loop.push({ x: current.x1, y: current.y1 });
      if (current.x1 === start.x0 && current.y1 === start.y0) break;
      const candidates: HalfEdge[] = byStart.get(key(current.x1, current.y1)) ?? [];
      const next: HalfEdge | undefined = candidates.find((e: HalfEdge) => !used.has(e));
      if (!next) break;
      current = next;
    }
    if (loop.length > 3) loops.push(loop.slice(0, -1));
  }
  return loops;
}

/** mask -> contours. Never the inverse gate — see IMPLEMENTATION_PLAN.md Phase 4. */
export function vectorize(mask: Mask3D): readonly Contour[] {
  const grid = mask.geometry;
  const contours: Contour[] = [];
  for (let planeIndex = 0; planeIndex < grid.planes.length; planeIndex++) {
    const buffer = mask.getSliceBuffer(planeIndex);
    const loops = linkLoops(boundaryEdges(buffer, grid.rows, grid.columns));
    for (const loop of loops) {
      contours.push({
        geometricType: "CLOSED_PLANAR",
        points: loop.map((p) => grid.indexToPatient(p.x, p.y, planeIndex)),
      });
    }
  }
  return contours;
}
