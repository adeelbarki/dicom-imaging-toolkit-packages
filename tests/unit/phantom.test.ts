import { describe, expect, it } from "vitest";
import { RTStruct } from "../../src/index.js";
import { createUniformGrid } from "../../src/geometry/grid-geometry.js";
import { spherePhantom, torusPhantom, analyticVolumeMm3 } from "../../src/phantom/index.js";
import { dice, voxelDisagreement, centroidDisplacementMm } from "../../src/metrics.js";
import { axialGrid } from "../helpers.js";
import type { GridGeometry, Mask3D, Vec3 } from "../../src/types.js";

/** THE regression gate: mask -> RTSTRUCT -> mask. Never RT -> mask -> RT. */
async function roundTrip(mask: Mask3D, geometry: GridGeometry): Promise<Mask3D> {
  const bytes = await RTStruct.createFromMask({ mask, name: "PHANTOM" });
  const rt = await RTStruct.load({ rtstruct: bytes, geometry });
  return rt.getMask("PHANTOM");
}

describe("RT: round trip, tiered metrics by structure size", () => {
  it("RT-01 large sphere: Dice >= 0.99 and volume error <= 1%", async () => {
    const g = createUniformGrid({ rows: 96, columns: 96, planeCount: 64, pixelSpacing: [0.7, 0.7], sliceSpacingMm: 1 });
    const a = spherePhantom(g, 15);
    const b = await roundTrip(a, g);
    expect(dice(a, b)).toBeGreaterThanOrEqual(0.99);
    const err = Math.abs(b.volume().valueMm3 - a.volume().valueMm3) / a.volume().valueMm3;
    expect(err).toBeLessThanOrEqual(0.01);
  });

  it("RT-02 torus survives the round trip with its hole intact", async () => {
    const g = createUniformGrid({ rows: 128, columns: 128, planeCount: 48, pixelSpacing: [0.5, 0.5], sliceSpacingMm: 1 });
    const a = torusPhantom(g, 18, 6);
    const b = await roundTrip(a, g);
    expect(dice(a, b)).toBeGreaterThanOrEqual(0.98);
    const analytic = analyticVolumeMm3.torus(18, 6);
    expect(Math.abs(a.volume().valueMm3 - analytic) / analytic).toBeLessThanOrEqual(0.05);
  });

  it("RT-03 oblique orientation round trips", async () => {
    const s = Math.SQRT1_2;
    const g = createUniformGrid({
      rows: 96, columns: 96, planeCount: 48, pixelSpacing: [0.7, 0.7], sliceSpacingMm: 1,
      rowDirection: [s, s, 0] as Vec3, columnDirection: [-s, s, 0] as Vec3,
    });
    const a = spherePhantom(g, 12);
    expect(dice(a, await roundTrip(a, g))).toBeGreaterThanOrEqual(0.99);
  });

  it("RT-04 irregular plane spacing round trips", async () => {
    const g = axialGrid([0, 2, 4, 7, 9, 12, 14]);
    const a = spherePhantom(g, 5);
    expect(dice(a, await roundTrip(a, g))).toBeGreaterThanOrEqual(0.95);
  });

  it("RT-05 tiny structure is gated on absolute disagreement, NOT Dice", async () => {
    const g = createUniformGrid({ rows: 32, columns: 32, planeCount: 16, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    const a = spherePhantom(g, 2);
    const b = await roundTrip(a, g);
    expect(voxelDisagreement(a, b)).toBeLessThanOrEqual(4);
    expect(centroidDisplacementMm(a, b)).toBeLessThanOrEqual(1);
  });
});
