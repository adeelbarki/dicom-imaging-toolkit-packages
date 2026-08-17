import { describe, expect, it } from "vitest";
import { createEmptyMask } from "../../src/mask/mask3d.js";
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
