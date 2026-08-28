import { ResourceLimitError, UnclosedContourError } from "../errors.js";
import { DEFAULT_MAX_VOXELS } from "../mask/mask3d.js";
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

/**
 * Two filled voxels touching only diagonally (e.g. `[[1,0],[0,1]]`) share exactly one
 * corner, and at that corner two boundary edges start: one continuing around the current
 * voxel's own square, one jumping to the diagonal neighbor's square. Picking "whichever
 * comes first in `candidates`" is an array-order accident, not a topology rule — it can
 * silently flip between joining the two voxels into one self-touching polygon and keeping
 * them as two separate contours depending on nothing but iteration order.
 *
 * The fix: always take the sharpest CLOCKWISE turn available relative to the incoming
 * edge (screen coordinates, x right / y down). This is the standard resolution for the
 * 4-connectivity vs 8-connectivity ambiguity in boundary tracing — it guarantees the
 * tracer keeps following the boundary of the square it's already on and never crosses a
 * diagonal gap into a different component, deterministically. RTStructJS's foreground is
 * therefore 4-connected (diagonal-only touches are two separate contours); background is
 * correspondingly 8-connected, the standard consistent pairing.
 */
function turnRank(inDx: number, inDy: number, outDx: number, outDy: number): number {
  if (outDx === inDx && outDy === inDy) return 0; // straight ahead
  if (outDx === -inDy && outDy === inDx) return 1; // 90° clockwise
  if (outDx === -inDx && outDy === -inDy) return 2; // 180° back
  return 3; // 90° counter-clockwise
}

function pickNextEdge(incoming: HalfEdge, candidates: readonly HalfEdge[]): HalfEdge | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const inDx = incoming.x1 - incoming.x0;
  const inDy = incoming.y1 - incoming.y0;
  return [...candidates].sort(
    (a, b) =>
      turnRank(inDx, inDy, a.x1 - a.x0, a.y1 - a.y0) - turnRank(inDx, inDy, b.x1 - b.x0, b.y1 - b.y0),
  )[0];
}

/**
 * Stitches boundary edges (matching endpoint-to-startpoint) into closed loops. For a
 * proper binary raster, every exposed voxel boundary forms a closed cycle — an edge chain
 * that fails to return to its own start is an algorithm bug or a corrupted buffer, not
 * unusual-but-valid data, so it throws rather than silently emitting an open path
 * mislabeled as CLOSED_PLANAR. Not independently unit-testable: boundaryEdges() can never
 * produce a set of edges that doesn't close for any real mask buffer (a rectangular binary
 * raster's exposed boundaries are always closed cycles by construction), and this stays
 * unexported to avoid leaking an internal detail into the public API — same reasoning
 * applied to the `at()`-style defensive checks elsewhere in this codebase, which also
 * aren't unit-tested in isolation for the same reason.
 */
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
    let closed = false;
    for (;;) {
      used.add(current);
      loop.push({ x: current.x1, y: current.y1 });
      if (current.x1 === start.x0 && current.y1 === start.y0) {
        closed = true;
        break;
      }
      const candidates = (byStart.get(key(current.x1, current.y1)) ?? []).filter((e) => !used.has(e));
      const next = pickNextEdge(current, candidates);
      if (!next) break;
      current = next;
    }
    if (!closed) {
      throw new UnclosedContourError(
        `boundary trace starting at [${start.x0}, ${start.y0}] did not return to its start ` +
          `after ${loop.length} points — this should never happen for a valid mask buffer`,
      );
    }
    if (loop.length > 3) loops.push(loop.slice(0, -1));
  }
  return loops;
}

/**
 * mask -> contours. Never the inverse gate — see IMPLEMENTATION_PLAN.md Phase 4.
 *
 * Bounds voxel count BEFORE building any boundary/loop data structure — see SEC-01. This
 * matters here specifically because a mask built via maskFromDense (rather than
 * createEmptyMask) never passed through that function's own maxVoxels check, and a
 * worst-case checkerboard mask produces roughly 4 boundary edges per filled voxel, so the
 * intermediate HalfEdge/Map/Set overhead can exceed the raw buffer size by several times.
 */
export function vectorize(mask: Mask3D, maxVoxels: number = DEFAULT_MAX_VOXELS): readonly Contour[] {
  const [columns, rows, planeCount] = mask.dimensions;
  const voxelCount = columns * rows * planeCount;
  if (voxelCount > maxVoxels) {
    throw new ResourceLimitError(`mask of ${voxelCount} voxels exceeds the limit of ${maxVoxels}`);
  }

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
