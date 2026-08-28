import { describe, expect, it } from "vitest";
import { vectorize } from "../../src/contour/vectorize.js";
import { ResourceLimitError } from "rt-geometry-js";
import { maskFromDense } from "rt-geometry-js";
import { createUniformGrid } from "rt-geometry-js";

const grid = (rows: number, columns: number) =>
  createUniformGrid({ rows, columns, planeCount: 1, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

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
