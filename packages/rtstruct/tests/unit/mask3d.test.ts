import { describe, expect, it } from "vitest";
import { createEmptyMask, maskFromDense } from "../../src/mask/mask3d.js";
import { ResourceLimitError } from "../../src/errors.js";
import { cubePhantom } from "../../src/phantom/index.js";
import { createUniformGrid } from "../../src/geometry/grid-geometry.js";

const g = () => createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

describe("MSK: access paths", () => {
  it("MSK-01 getSliceBuffer length is rows * columns", () => {
    expect(createEmptyMask(g()).getSliceBuffer(0)).toHaveLength(16 * 16);
  });

  it("MSK-02 get() agrees with the bulk buffer", () => {
    const m = cubePhantom(g(), 6);
    const buf = m.getSliceBuffer(4);
    for (let r = 0; r < 16; r++)
      for (let c = 0; c < 16; c++)
        expect(m.get(c, r, 4)).toBe(buf[r * 16 + c] !== 0);
  });

  it("MSK-03 count() matches a manual bulk count", () => {
    const m = cubePhantom(g(), 6);
    let n = 0;
    for (let k = 0; k < 8; k++) { const b = m.getSliceBuffer(k); for (let i = 0; i < b.length; i++) if (b[i]) n++; }
    expect(m.count()).toBe(n);
  });

  it("MSK-04 dimensions are [columns, rows, planes]", () => {
    expect(createEmptyMask(g()).dimensions).toEqual([16, 16, 8]);
  });
});

describe("MSK: out-of-range access throws instead of returning a plausible-but-wrong result", () => {
  it("get() rejects an out-of-bounds column/row/planeIndex", () => {
    const m = createEmptyMask(g());
    expect(() => m.get(16, 0, 0)).toThrow(RangeError);
    expect(() => m.get(0, 16, 0)).toThrow(RangeError);
    expect(() => m.get(0, 0, 8)).toThrow(RangeError);
    expect(() => m.get(-1, 0, 0)).toThrow(RangeError);
  });

  it("get() rejects a non-integer index", () => {
    const m = createEmptyMask(g());
    expect(() => m.get(1.5, 0, 0)).toThrow(RangeError);
  });

  it("getSliceBuffer() rejects an out-of-range planeIndex instead of clamping to an empty or wrapped-around slice", () => {
    const m = createEmptyMask(g());
    expect(() => m.getSliceBuffer(1000)).toThrow(/plane index 1000 out of range \[0, 7\]/);
    // subarray() treats a negative index as counting from the end — must not silently
    // succeed with data from the wrong plane.
    expect(() => m.getSliceBuffer(-1)).toThrow(RangeError);
  });
});

describe("MSK: voxel count overflow is rejected before allocation", () => {
  it("dimensions whose product exceeds Number.MAX_SAFE_INTEGER throw ResourceLimitError", () => {
    const huge = createUniformGrid({ rows: 100_000_000, columns: 100_000_000, planeCount: 2, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => createEmptyMask(huge, Number.MAX_SAFE_INTEGER)).toThrow(ResourceLimitError);
    expect(() => maskFromDense(huge, new Uint8Array(0))).toThrow(ResourceLimitError);
  });
});
