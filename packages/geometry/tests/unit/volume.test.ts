import { describe, expect, it } from "vitest";
import { cubePhantom, analyticVolumeMm3 } from "../../src/phantom.js";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { IndeterminateVolumeError } from "../../src/errors.js";

describe("VOL: voxel volume against analytic ground truth", () => {
  it("VOL-01 10mm cube on 1mm isotropic voxels is 1000 mm3", () => {
    const g = createUniformGrid({ rows: 32, columns: 32, planeCount: 32, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    const v = cubePhantom(g, 10).volume();
    expect(v.valueMm3).toBeCloseTo(analyticVolumeMm3.cube(10), 6);
  });

  it("VOL-02 anisotropic 0.7 x 0.7 x 3mm voxels scale correctly", () => {
    const g = createUniformGrid({ rows: 64, columns: 64, planeCount: 16, pixelSpacing: [0.7, 0.7], sliceSpacingMm: 3 });
    const m = cubePhantom(g, 21);
    expect(m.volume().valueMm3 / m.count()).toBeCloseTo(0.7 * 0.7 * 3, 9);
  });

  it("VOL-03 the method is always attached to the number", () => {
    const g = createUniformGrid({ rows: 8, columns: 8, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(cubePhantom(g, 4).volume().method).toBe("voxel");
  });

  it("VOL-04 contour method is out of scope for v0.1 and must not silently fall back", () => {
    const g = createUniformGrid({ rows: 8, columns: 8, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => cubePhantom(g, 4).volume({ method: "contour" })).toThrowError(/NotImplemented|contour/i);
  });

  it("a single-plane grid's voxel volume is not computable, not silently zero", () => {
    const g = createUniformGrid({ rows: 8, columns: 8, planeCount: 1, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => cubePhantom(g, 4).volume()).toThrow(IndeterminateVolumeError);
  });
});
