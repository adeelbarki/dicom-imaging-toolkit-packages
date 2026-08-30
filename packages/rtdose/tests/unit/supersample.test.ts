import { describe, expect, it } from "vitest";
import { maskFromDense } from "rt-geometry-js";
import { DoseGrid } from "../../src/dose-grid.js";
import { doseFixtureFromGy } from "../fixtures.js";

/**
 * A steep linear gradient across columns: dose = 40·column Gy (40 Gy/mm at 1 mm spacing),
 * over an 8³ grid. The mask is one voxel at (column 4, row 4, plane 4) — centre dose 160.
 * The mask sits on the dose grid's own geometry, so neither path resamples: the only
 * difference between whole-voxel and supersampled is the sub-voxel sampling.
 */
function oneVoxelInGradient(): { dose: DoseGrid; mask: ReturnType<typeof maskFromDense> } {
  const dose = DoseGrid.fromDicom(
    doseFixtureFromGy({
      rows: 8,
      columns: 8,
      frameOffsets: [0, 1, 2, 3, 4, 5, 6, 7],
      pixelSpacing: [1, 1],
      imagePositionPatient: [0, 0, 0],
      scaling: 0.01,
      gy: (c) => 40 * c,
    }),
  );
  const data = new Uint8Array(8 * 8 * 8);
  data[4 * 64 + 4 * 8 + 4] = 1;
  return { dose, mask: maskFromDense(dose.geometry, data) };
}

/** Uniform 25 Gy everywhere; mask is a 3³ block. Supersampling a flat field is a no-op. */
function uniformBlock(): { dose: DoseGrid; mask: ReturnType<typeof maskFromDense> } {
  const dose = DoseGrid.fromDicom(
    doseFixtureFromGy({
      rows: 6,
      columns: 6,
      frameOffsets: [0, 1, 2, 3, 4, 5],
      pixelSpacing: [1, 1],
      imagePositionPatient: [0, 0, 0],
      scaling: 0.01,
      gy: () => 25,
    }),
  );
  const data = new Uint8Array(6 * 6 * 6);
  for (let k = 2; k <= 4; k++) for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) data[k * 36 + r * 6 + c] = 1;
  return { dose, mask: maskFromDense(dose.geometry, data) };
}

describe("DoseGrid supersampling — method plumbing", () => {
  it("SUP-01 default is whole-voxel-binary; the method object says so", () => {
    const { dose, mask } = oneVoxelInGradient();
    const m = dose.statistics(mask).method;
    expect(m.volumePolicy).toBe("whole-voxel-binary");
    expect(m.resampling).toBe("dose-sampled-at-structure-voxel-centres");
    expect(m.supersampling).toBeUndefined();
  });

  it("SUP-02 volumePolicy 'supersample' records k on every metric's method", () => {
    const { dose, mask } = oneVoxelInGradient();
    const opts = { volumePolicy: "supersample", supersampling: 3 } as const;
    for (const m of [
      dose.statistics(mask, opts).method,
      dose.calculateDVH(mask, opts).method,
      dose.getD(95, mask, opts).method,
      dose.getV(100, mask, opts).method,
    ]) {
      expect(m.volumePolicy).toBe("supersampled");
      expect(m.supersampling).toBe(3);
      expect(m.resampling).toBe("dose-sampled-at-structure-subvoxel-centres");
      expect(m.resampledToMaskGrid).toBe(false);
    }
  });

  it("SUP-03 supersampling defaults to 2 and is validated to [2, 4]", () => {
    const { dose, mask } = oneVoxelInGradient();
    expect(dose.statistics(mask, { volumePolicy: "supersample" }).method.supersampling).toBe(2);
    for (const bad of [1, 5, 0, 2.5, -2]) {
      expect(() => dose.statistics(mask, { volumePolicy: "supersample", supersampling: bad })).toThrow(RangeError);
    }
  });
});

describe("DoseGrid supersampling — it changes the numbers in a gradient", () => {
  it("SUP-04 statistics: whole-voxel is a point value, supersampled spreads around it", () => {
    const { dose, mask } = oneVoxelInGradient();
    const whole = dose.statistics(mask);
    expect(whole.minGy).toBeCloseTo(160, 6);
    expect(whole.maxGy).toBeCloseTo(160, 6);
    expect(whole.voxelCount).toBe(1);

    const sup = dose.statistics(mask, { volumePolicy: "supersample", supersampling: 2 });
    expect(sup.minGy).toBeCloseTo(150, 4); // sub-centres at column 3.75
    expect(sup.maxGy).toBeCloseTo(170, 4); // and 4.25
    expect(sup.meanGy).toBeCloseTo(160, 4); // linear gradient → mean unchanged
    expect(sup.volumeMm3).toBeCloseTo(whole.volumeMm3, 9); // k³ sub-voxels sum to the voxel
    expect(sup.voxelCount).toBe(1); // the voxel count, not the sample count
  });

  it("SUP-05 D95 and V(d) move once the gradient across the voxel is resolved", () => {
    const { dose, mask } = oneVoxelInGradient();

    expect(dose.getD(95, mask).doseGy).toBeCloseTo(160, 6);
    expect(dose.getD(95, mask, { volumePolicy: "supersample", supersampling: 2 }).doseGy).toBeCloseTo(150, 4);

    // whole voxel: its one 160 Gy sample is entirely ≥ 160 → full volume
    expect(dose.getV(160, mask).volumeFraction).toBeCloseTo(1, 6);
    // supersampled: only the 170 Gy half clears 160
    expect(dose.getV(160, mask, { volumePolicy: "supersample", supersampling: 2 }).volumeFraction).toBeCloseTo(0.5, 4);
  });

  it("SUP-06 calculateDVH under supersampling carries k and a non-increasing curve", () => {
    const { dose, mask } = oneVoxelInGradient();
    const dvh = dose.calculateDVH(mask, { bins: 64, volumePolicy: "supersample", supersampling: 2 });
    expect(dvh.method.supersampling).toBe(2);
    expect(dvh.points[0]!.volumeFraction).toBeCloseTo(1, 6);
    expect(dvh.points.at(-1)!.volumeMm3).toBe(0);
    for (let i = 1; i < dvh.points.length; i++) {
      expect(dvh.points[i]!.volumeMm3).toBeLessThanOrEqual(dvh.points[i - 1]!.volumeMm3 + 1e-9);
    }
    expect(dvh.maxDoseGy).toBeCloseTo(170, 4);
  });
});

describe("DoseGrid supersampling — no effect on a flat field", () => {
  it("SUP-07 supersampling a uniform dose leaves every metric unchanged", () => {
    const { dose, mask } = uniformBlock();
    const whole = dose.statistics(mask);
    const sup = dose.statistics(mask, { volumePolicy: "supersample", supersampling: 4 });
    expect(sup.minGy).toBeCloseTo(whole.minGy, 6);
    expect(sup.maxGy).toBeCloseTo(whole.maxGy, 6);
    expect(sup.meanGy).toBeCloseTo(whole.meanGy, 6);
    expect(sup.volumeMm3).toBeCloseTo(whole.volumeMm3, 6);

    expect(dose.getD(95, mask, { volumePolicy: "supersample", supersampling: 4 }).doseGy).toBeCloseTo(
      dose.getD(95, mask).doseGy,
      6,
    );
  });
});
