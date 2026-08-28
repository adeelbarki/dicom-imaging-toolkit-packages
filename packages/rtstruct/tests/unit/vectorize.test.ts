import { describe, expect, it } from "vitest";
import { createUniformGrid, maskFromDense, ResourceLimitError, type Vec3 } from "rt-geometry-js";
import { vectorize } from "../../src/contour/vectorize.js";

const grid = (rows: number, columns: number) =>
  createUniformGrid({ rows, columns, planeCount: 1, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

/** Shoelace sum over a planar loop in (x=column, y=row) screen space. In y-down screen
 *  coordinates a positive value means clockwise winding. */
const signedArea2x = (pts: readonly Vec3[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Vec3;
    const b = pts[(i + 1) % pts.length] as Vec3;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
};

describe("VECTOR-001: diagonally-touching voxels are two contours, not one self-touching polygon", () => {
  it("a checkerboard corner touch produces two separate 4-point contours", () => {
    const g = grid(4, 4);
    const data = new Uint8Array(16);
    data[0 * 4 + 0] = 1; // row0, col0
    data[1 * 4 + 1] = 1; // row1, col1 — touches (0,0) only at the shared corner
    const contours = vectorize(maskFromDense(g, data));
    expect(contours).toHaveLength(2);
    expect(contours[0]?.points).toHaveLength(4);
    expect(contours[1]?.points).toHaveLength(4);
  });

  it("the reverse diagonal (top-right / bottom-left) is also two contours", () => {
    const g = grid(4, 4);
    const data = new Uint8Array(16);
    data[0 * 4 + 1] = 1; // row0, col1
    data[1 * 4 + 0] = 1; // row1, col0
    const contours = vectorize(maskFromDense(g, data));
    expect(contours).toHaveLength(2);
  });

  it("a 4-connected L-shape (not a pure diagonal touch) is still one contour", () => {
    const g = grid(4, 4);
    const data = new Uint8Array(16);
    data[0 * 4 + 0] = 1;
    data[0 * 4 + 1] = 1;
    data[1 * 4 + 0] = 1; // shares a full edge with both neighbors, not just a corner
    const contours = vectorize(maskFromDense(g, data));
    expect(contours).toHaveLength(1);
  });
});

describe("VECTOR-ORDER: output ordering and winding are a stable contract", () => {
  it("VECTOR-ORDER-01 a single voxel yields its four corners, clockwise, starting at the top-left", () => {
    const g = grid(16, 16);
    const data = new Uint8Array(256);
    data[3 * 16 + 2] = 1; // row 3, column 2
    const [contour, ...rest] = vectorize(maskFromDense(g, data));
    expect(rest).toHaveLength(0);
    // indexToPatient(column, row, 0) == [column, row, 0] for this grid, so loop vertices
    // are the cell's half-integer corners, emitted top -> right -> bottom -> left.
    expect(contour?.points).toEqual([
      [1.5, 2.5, 0],
      [2.5, 2.5, 0],
      [2.5, 3.5, 0],
      [1.5, 3.5, 0],
    ]);
    expect(signedArea2x(contour!.points)).toBeGreaterThan(0); // clockwise in y-down space
  });

  it("VECTOR-ORDER-02 contours come out in row-major discovery order, then by plane", () => {
    const g = grid(16, 16);
    const data = new Uint8Array(256);
    data[1 * 16 + 8] = 1; // upper voxel (row 1)
    data[9 * 16 + 3] = 1; // lower voxel (row 9)
    const contours = vectorize(maskFromDense(g, data));
    expect(contours).toHaveLength(2);
    // first contour is the one whose top edge is discovered first in the row-major scan
    expect(contours[0]?.points[0]).toEqual([7.5, 0.5, 0]);
    expect(contours[1]?.points[0]).toEqual([2.5, 8.5, 0]);
  });

  it("VECTOR-ORDER-03 a hole boundary winds counter-clockwise (opposite the outer)", () => {
    const g = grid(16, 16);
    const data = new Uint8Array(256);
    for (let r = 4; r <= 8; r++) for (let c = 4; c <= 8; c++) data[r * 16 + c] = 1;
    data[6 * 16 + 6] = 0; // punch a one-voxel hole in the centre
    const contours = vectorize(maskFromDense(g, data));
    expect(contours).toHaveLength(2);
    const areas = contours.map((k) => signedArea2x(k.points));
    // exactly one outer (clockwise, +) and one hole (counter-clockwise, -)
    expect(areas.filter((a) => a > 0)).toHaveLength(1);
    expect(areas.filter((a) => a < 0)).toHaveLength(1);
  });
});

describe("VECTOR-005: vectorize() bounds voxel count before doing any work", () => {
  it("a mask exceeding the given maxVoxels throws ResourceLimitError immediately", () => {
    const g = grid(16, 16); // 256 voxels
    const data = new Uint8Array(256);
    expect(() => vectorize(maskFromDense(g, data), 10)).toThrow(ResourceLimitError);
  });

  it("a mask within the limit is unaffected", () => {
    const g = grid(4, 4);
    const data = new Uint8Array(16);
    data[0] = 1;
    data[1] = 1;
    data[2] = 1;
    expect(() => vectorize(maskFromDense(g, data), 1000)).not.toThrow();
  });
});
