import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import type { Vec3 } from "../../src/types.js";
import { axialGrid } from "../helpers.js";

describe("GEO: patient <-> pixel", () => {
  it("GEO-20 axial round trip is identity", () => {
    const g = axialGrid([0, 3, 6], [0.7, 0.7]);
    const pt = g.indexToPatient(4, 5, 1);
    const px = g.patientToPixel(pt, 1);
    expect(px.column).toBeCloseTo(4, 9);
    expect(px.row).toBeCloseTo(5, 9);
  });

  it("GEO-21 oblique orientation round trip is identity", () => {
    const s = Math.SQRT1_2;
    const g = createUniformGrid({
      rows: 16, columns: 16, planeCount: 4,
      pixelSpacing: [0.7, 0.7], sliceSpacingMm: 3,
      rowDirection: [s, s, 0] as Vec3, columnDirection: [-s, s, 0] as Vec3,
    });
    const pt = g.indexToPatient(3, 9, 2);
    const px = g.patientToPixel(pt, 2);
    expect(px.column).toBeCloseTo(3, 9);
    expect(px.row).toBeCloseTo(9, 9);
  });

  it("GEO-22 findNearestPlane works on irregular spacing", () => {
    const g = axialGrid([0, 2, 4, 7, 9]);
    const hit = g.findNearestPlane([0, 0, 7.03]);
    expect(hit.planeIndex).toBe(3);
    expect(hit.distanceMm).toBeCloseTo(0.03, 6);
  });

  it("GEO-23 isUniformlySpaced distinguishes regular from irregular", () => {
    expect(axialGrid([0, 3, 6, 9]).isUniformlySpaced()).toBe(true);
    expect(axialGrid([0, 2, 4, 7, 9]).isUniformlySpaced()).toBe(false);
  });
});
