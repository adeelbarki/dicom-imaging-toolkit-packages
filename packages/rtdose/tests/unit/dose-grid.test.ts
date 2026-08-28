import { describe, expect, it } from "vitest";
import { createUniformGrid, FrameOfReferenceMismatchError, maskFromDense, type Vec3 } from "rt-geometry-js";
import { DoseGrid } from "../../src/dose-grid.js";
import { doseFixtureFromGy } from "../fixtures.js";

// A 5x5x5 unit grid at the origin: indexToPatient(c, r, k) === [c, r, k].
// Dose is the linear field f(x, y, z) = x + 10y + 100z, so trilinear sampling is exact.
function rampDose(): DoseGrid {
  return DoseGrid.fromDicom(
    doseFixtureFromGy({
      rows: 5,
      columns: 5,
      frameOffsets: [0, 1, 2, 3, 4],
      pixelSpacing: [1, 1],
      imagePositionPatient: [0, 0, 0],
      scaling: 1,
      gy: (c, r, f) => c + 10 * r + 100 * f,
    }),
  );
}

describe("DoseGrid.sample", () => {
  it("DG-01 recovers a linear dose field exactly at fractional points (trilinear)", () => {
    const dose = rampDose();
    expect(dose.sample([2.5, 1.5, 3.0])).toBeCloseTo(2.5 + 15 + 300, 4);
    expect(dose.sample([0, 0, 0])).toBeCloseTo(0, 6);
    expect(dose.sample([4, 4, 4])).toBeCloseTo(444, 4);
  });

  it("DG-02 returns 0 outside the dose grid extent", () => {
    const dose = rampDose();
    expect(dose.sample([-5, 2, 2])).toBe(0);
    expect(dose.sample([2, 2, 99])).toBe(0);
  });

  it("DG-03 nearest sampling returns the containing voxel value", () => {
    const dose = rampDose();
    expect(dose.sample([2.4, 0.6, 1.2], { method: "nearest" })).toBe(2 + 10 * 1 + 100 * 1);
  });
});

describe("DoseGrid.statistics", () => {
  it("DG-04 computes min/max/volume-weighted mean over a coincident mask (no resample)", () => {
    const dose = rampDose();
    const data = new Uint8Array(5 * 5 * 5);
    for (let k = 1; k <= 2; k++)
      for (let r = 1; r <= 2; r++)
        for (let c = 1; c <= 2; c++) data[k * 25 + r * 5 + c] = 1;
    const mask = maskFromDense(dose.geometry, data);

    const s = dose.statistics(mask);
    expect(s.minGy).toBeCloseTo(111, 4); // (1,1,1)
    expect(s.maxGy).toBeCloseTo(222, 4); // (2,2,2)
    expect(s.meanGy).toBeCloseTo(166.5, 4); // mean of the 8 equal-volume corners
    expect(s.voxelCount).toBe(8);
    expect(s.volumeMm3).toBeCloseTo(8, 6);
    expect(s.method.resampledToMaskGrid).toBe(false);
    expect(s.method.resampling).toBe("dose-sampled-at-structure-voxel-centres");
    expect(s.method.volumePolicy).toBe("whole-voxel-binary");
  });

  it("DG-05 resamples onto a shifted structure grid and records it", () => {
    const dose = rampDose();
    const target = createUniformGrid({
      rows: 3,
      columns: 3,
      planeCount: 3,
      pixelSpacing: [1, 1],
      sliceSpacingMm: 1,
      origin: [1.5, 1.5, 1.5] as Vec3,
    });
    const mask = maskFromDense(target, new Uint8Array(27).fill(1));

    const s = dose.statistics(mask);
    expect(s.method.resampledToMaskGrid).toBe(true);
    // centre voxel of the target is at [2.5, 2.5, 2.5] -> dose 277.5; mean is within range
    expect(s.meanGy).toBeGreaterThan(s.minGy);
    expect(s.meanGy).toBeLessThan(s.maxGy);
    expect(s.minGy).toBeCloseTo(1.5 + 15 + 150, 3); // corner [1.5,1.5,1.5]
  });

  it("DG-06 throws across differing frames of reference", () => {
    const dose = DoseGrid.fromDicom(
      doseFixtureFromGy({
        rows: 4,
        columns: 4,
        frameOffsets: [0, 1, 2, 3],
        scaling: 1,
        gy: () => 10,
        frameOfReferenceUID: "1.2.900.1",
      }),
    );
    const otherFrame = createUniformGrid({
      rows: 4,
      columns: 4,
      planeCount: 4,
      pixelSpacing: [1, 1],
      sliceSpacingMm: 1,
      frameOfReferenceUID: "9.9.999.9",
    });
    const mask = maskFromDense(otherFrame, new Uint8Array(64).fill(1));
    expect(() => dose.statistics(mask)).toThrow(FrameOfReferenceMismatchError);
  });

  it("DG-07 throws on an empty mask", () => {
    const dose = rampDose();
    const mask = maskFromDense(dose.geometry, new Uint8Array(125));
    expect(() => dose.statistics(mask)).toThrow(RangeError);
  });
});
