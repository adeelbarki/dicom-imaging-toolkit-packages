import { describe, expect, it } from "vitest";
import { RTStruct } from "../../src/index.js";
import { createUniformGrid } from "../../src/geometry/grid-geometry.js";
import { cubePhantom, spherePhantom, torusPhantom, analyticVolumeMm3 } from "../../src/phantom/index.js";
import { dice, voxelDisagreement, centroidDisplacementMm } from "../../src/metrics.js";
import { ResourceLimitError } from "../../src/errors.js";
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

  it("RT-06 anisotropic pixel spacing does not distort the sphere", () => {
    // pixelSpacing[0] != pixelSpacing[1] != sliceSpacingMm: if phantom code ever measured in
    // voxel-index units instead of converting through indexToPatient (patient mm), the sphere
    // would come out as an ellipsoid and this volume check would fail.
    const g = createUniformGrid({ rows: 96, columns: 96, planeCount: 48, pixelSpacing: [0.5, 0.8], sliceSpacingMm: 1.2 });
    const a = spherePhantom(g, 10);
    const analytic = analyticVolumeMm3.sphere(10);
    const err = Math.abs(a.volume().valueMm3 - analytic) / analytic;
    expect(err).toBeLessThanOrEqual(0.03);
  });

  it("RT-07 a genuinely tilted 3D grid normal (not just an in-plane rotation) round trips", async () => {
    // RT-03 rotates rowDirection/columnDirection within the z=0 plane, so the normal stays
    // [0,0,1]. This tilts the normal itself off-axis, which a code path that hardcodes "z"
    // instead of using grid.normal() would get wrong.
    const t = Math.PI / 6; // 30 degrees
    const g = createUniformGrid({
      rows: 96, columns: 96, planeCount: 48, pixelSpacing: [0.7, 0.7], sliceSpacingMm: 1,
      rowDirection: [1, 0, 0] as Vec3,
      columnDirection: [0, Math.cos(t), Math.sin(t)] as Vec3,
    });
    const a = spherePhantom(g, 12);
    expect(dice(a, await roundTrip(a, g))).toBeGreaterThanOrEqual(0.99);
  });
});

describe("PHANTOM-003: phantom parameters are validated, not trusted", () => {
  const g = createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

  it("a non-positive or non-finite cube side is rejected, not silently empty", () => {
    expect(() => cubePhantom(g, -20)).toThrow(RangeError);
    expect(() => cubePhantom(g, 0)).toThrow(RangeError);
    expect(() => cubePhantom(g, NaN)).toThrow(RangeError);
  });

  it("a non-positive or non-finite sphere radius is rejected, not silently empty", () => {
    expect(() => spherePhantom(g, -10)).toThrow(RangeError);
    expect(() => spherePhantom(g, 0)).toThrow(RangeError);
    expect(() => spherePhantom(g, Infinity)).toThrow(RangeError);
  });

  it("non-positive torus radii are rejected", () => {
    expect(() => torusPhantom(g, -10, 5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 10, -5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 10, 0)).toThrow(RangeError);
  });

  it("a torus with majorRadiusMm <= minorRadiusMm is rejected — the tube would self-intersect", () => {
    expect(() => torusPhantom(g, 5, 5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 5, 10)).toThrow(RangeError);
  });
});

describe("PHANTOM-005: phantom builders bound allocation before doing any work", () => {
  it("a grid whose voxel count exceeds maxVoxels is rejected before any voxelization loop runs", () => {
    const huge = createUniformGrid({ rows: 4096, columns: 4096, planeCount: 512, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => spherePhantom(huge, 10, 1000)).toThrow(ResourceLimitError);
    expect(() => cubePhantom(huge, 10, 1000)).toThrow(ResourceLimitError);
    expect(() => torusPhantom(huge, 10, 5, 1000)).toThrow(ResourceLimitError);
  });

  it("a grid within the limit is unaffected", () => {
    const g = createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => spherePhantom(g, 5, 100000)).not.toThrow();
  });
});
