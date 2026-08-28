import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { createScalarField } from "../../src/scalar-field.js";
import { ResourceLimitError } from "../../src/errors.js";

const grid = () =>
  createUniformGrid({ rows: 2, columns: 2, planeCount: 2, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

describe("SF: createScalarField", () => {
  it("SF-01 wraps a dense Float32Array in plane-major, row-major order", () => {
    const g = grid();
    // plane 0: [[0,1],[2,3]]  plane 1: [[4,5],[6,7]]
    const field = createScalarField(g, Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(field.dimensions).toEqual([2, 2, 2]);
    expect(field.get(0, 0, 0)).toBe(0);
    expect(field.get(1, 0, 0)).toBe(1);
    expect(field.get(0, 1, 0)).toBe(2);
    expect(field.get(1, 1, 1)).toBe(7);
    expect(Array.from(field.getSliceBuffer(1))).toEqual([4, 5, 6, 7]);
  });

  it("SF-02 accepts a per-voxel generator with (column, row, planeIndex) args", () => {
    const g = grid();
    const field = createScalarField(g, (c, r, k) => c + 10 * r + 100 * k);
    expect(field.get(1, 0, 0)).toBe(1);
    expect(field.get(0, 1, 0)).toBe(10);
    expect(field.get(1, 1, 1)).toBe(111);
  });

  it("SF-03 rejects a dense array whose length does not match the voxel count", () => {
    expect(() => createScalarField(grid(), new Float32Array(7))).toThrow(RangeError);
  });

  it("SF-04 bounds allocation before building — oversized grid throws ResourceLimitError", () => {
    const huge = createUniformGrid({
      rows: 4096, columns: 4096, planeCount: 512, pixelSpacing: [1, 1], sliceSpacingMm: 1,
    });
    expect(() => createScalarField(huge, () => 0, 1000)).toThrow(ResourceLimitError);
  });

  it("SF-05 out-of-range indices throw rather than fabricating a value", () => {
    const field = createScalarField(grid(), () => 1);
    expect(() => field.get(2, 0, 0)).toThrow(RangeError);
    expect(() => field.get(0, 0, 2)).toThrow(RangeError);
    expect(() => field.getSliceBuffer(5)).toThrow(RangeError);
  });
});
