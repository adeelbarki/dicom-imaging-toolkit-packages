import { describe, expect, it } from "vitest";
import { maskFromDense } from "rt-geometry-js";
import { DoseGrid } from "../../src/dose-grid.js";
import { doseFixtureFromGy } from "../fixtures.js";

/** Uniform 10 Gy over a 6³ grid; mask is the 4³ interior block, all on the dose grid. */
function uniformDoseAndMask(): { dose: DoseGrid; mask: ReturnType<typeof maskFromDense> } {
  const dose = DoseGrid.fromDicom(
    doseFixtureFromGy({
      rows: 6,
      columns: 6,
      frameOffsets: [0, 1, 2, 3, 4, 5],
      pixelSpacing: [1, 1],
      imagePositionPatient: [0, 0, 0],
      scaling: 1,
      gy: () => 10,
    }),
  );
  const data = new Uint8Array(6 * 6 * 6);
  for (let k = 1; k <= 4; k++)
    for (let r = 1; r <= 4; r++)
      for (let c = 1; c <= 4; c++) data[k * 36 + r * 6 + c] = 1;
  return { dose, mask: maskFromDense(dose.geometry, data) };
}

/** Dose = 10·planeIndex over a 4×4×10 grid; mask is the whole grid. */
function rampAlongZ(): { dose: DoseGrid; mask: ReturnType<typeof maskFromDense> } {
  const dose = DoseGrid.fromDicom(
    doseFixtureFromGy({
      rows: 4,
      columns: 4,
      frameOffsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      pixelSpacing: [1, 1],
      imagePositionPatient: [0, 0, 0],
      scaling: 1,
      gy: (_c, _r, f) => 10 * f,
    }),
  );
  return { dose, mask: maskFromDense(dose.geometry, new Uint8Array(4 * 4 * 10).fill(1)) };
}

describe("DoseGrid.getD / getV — uniform dose", () => {
  it("DVH-01 D at any volume fraction equals the single dose level", () => {
    const { dose, mask } = uniformDoseAndMask();
    expect(dose.getD(95, mask).doseGy).toBeCloseTo(10, 4);
    expect(dose.getD(0, mask).doseGy).toBeCloseTo(10, 4);
    expect(dose.getD(100, mask).doseGy).toBeCloseTo(10, 4);
  });

  it("DVH-02 V is the whole structure below the level and nothing above it", () => {
    const { dose, mask } = uniformDoseAndMask();
    const total = mask.volume({ method: "voxel" }).valueMm3;

    const v5 = dose.getV(5, mask);
    expect(v5.volumeFraction).toBeCloseTo(1, 6);
    expect(v5.volumeMm3).toBeCloseTo(total, 6);

    expect(dose.getV(10, mask).volumeFraction).toBeCloseTo(1, 6); // threshold is inclusive
    expect(dose.getV(20, mask).volumeFraction).toBeCloseTo(0, 6);
  });

  it("DVH-03 every return carries the computation method", () => {
    const { dose, mask } = uniformDoseAndMask();
    for (const m of [dose.getD(50, mask).method, dose.getV(5, mask).method, dose.statistics(mask).method]) {
      expect(m.resampling).toBe("dose-sampled-at-structure-voxel-centres");
      expect(m.interpolation).toBe("trilinear");
      expect(m.volumePolicy).toBe("whole-voxel-binary");
      expect(m.resampledToMaskGrid).toBe(false);
    }
  });
});

describe("DoseGrid.calculateDVH", () => {
  it("DVH-04 uniform dose gives a flat-then-cliff cumulative curve", () => {
    const { dose, mask } = uniformDoseAndMask();
    const dvh = dose.calculateDVH(mask, { bins: 100 });

    expect(dvh.kind).toBe("cumulative");
    expect(dvh.maxDoseGy).toBeCloseTo(10, 4);
    expect(dvh.meanDoseGy).toBeCloseTo(10, 4);
    expect(dvh.points).toHaveLength(101);
    expect(dvh.points[0]!.volumeFraction).toBeCloseTo(1, 6);
    expect(dvh.points.at(-1)!.volumeFraction).toBeCloseTo(0, 6);
    expect(dvh.points.at(-1)!.doseGy).toBeCloseTo(10, 4);

    // non-increasing in volume, non-decreasing in dose
    for (let i = 1; i < dvh.points.length; i++) {
      expect(dvh.points[i]!.volumeFraction).toBeLessThanOrEqual(dvh.points[i - 1]!.volumeFraction + 1e-9);
      expect(dvh.points[i]!.doseGy).toBeGreaterThanOrEqual(dvh.points[i - 1]!.doseGy);
    }
  });

  it("DVH-05 monotone ramp: D50 is the median dose, V50 is half the volume", () => {
    const { dose, mask } = rampAlongZ();
    // planes carry 0,10,20,...,90 Gy, 16 voxels each, equal volume
    expect(dose.getD(10, mask).doseGy).toBeCloseTo(90, 4); // top 10% of volume
    expect(dose.getD(50, mask).doseGy).toBeCloseTo(50, 4); // top 50% of volume
    expect(dose.getV(50, mask).volumeFraction).toBeCloseTo(0.5, 6); // planes at 50..90

    const dvh = dose.calculateDVH(mask, { bins: 90 });
    expect(dvh.maxDoseGy).toBeCloseTo(90, 4);
    expect(dvh.meanDoseGy).toBeCloseTo(45, 4);
  });

  it("DVH-06 rejects a non-positive bin count", () => {
    const { dose, mask } = uniformDoseAndMask();
    expect(() => dose.calculateDVH(mask, { bins: 0 })).toThrow(RangeError);
  });
});
