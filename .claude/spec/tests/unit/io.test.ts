import { describe, expect, it } from "vitest";
import { RTStructImpl } from "../../src/index.js";
import { createUniformGrid } from "../../src/geometry/grid-geometry.js";
import { cubePhantom } from "../../src/phantom/index.js";

const g = () => createUniformGrid({ rows: 32, columns: 32, planeCount: 16, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

/** Fixtures are BUILT, never checked in: no PHI, no vendor licensing question. */
declare function buildFixture(spec: Record<string, unknown>): ArrayBuffer;

describe("IO: tolerant reading", () => {
  it("IO-01 an ROI with no ContourSequence is listed and does not throw", async () => {
    const rt = await RTStructImpl.load({ rtstruct: buildFixture({ rois: [{ name: "EmptyPTV", contours: [] }] }), geometry: g() });
    expect(rt.getROINames()).toContain("EmptyPTV");
    expect(rt.getMask("EmptyPTV").count()).toBe(0);
    expect(rt.diagnostics.map((d) => d.code)).toContain("EMPTY_ROI");
  });

  it("IO-02 sequences stored out of order are joined by ROINumber", async () => {
    const rt = await RTStructImpl.load({ rtstruct: buildFixture({ shuffleSequences: true, rois: [{ name: "A" }, { name: "B" }] }), geometry: g() });
    expect(rt.roi("B").name).toBe("B");
  });

  it("IO-03 a missing RTROIObservationsSequence reads fine (Type 3 in PS3.3 2026c)", async () => {
    const rt = await RTStructImpl.load({ rtstruct: buildFixture({ omitRTROIObservations: true, rois: [{ name: "A" }] }), geometry: g() });
    expect(rt.getROINames()).toEqual(["A"]);
    expect(rt.diagnostics.map((d) => d.code)).toContain("MISSING_RT_ROI_OBSERVATIONS");
  });

  it("IO-04 ROI names are never normalized", async () => {
    const rt = await RTStructImpl.load({ rtstruct: buildFixture({ rois: [{ name: "gtv_p " }] }), geometry: g() });
    expect(rt.getROINames()).toEqual(["gtv_p "]);
  });

  it("IO-05 absent ROI Volume returns undefined rather than a computed substitute", async () => {
    const rt = await RTStructImpl.load({ rtstruct: buildFixture({ rois: [{ name: "A" }] }), geometry: g() });
    expect(rt.dicomVolume("A")).toBeUndefined();
  });
});

describe("IO: conservative writing", () => {
  it("IO-06 writes all three sequences even though 2026c permits omission", async () => {
    const bytes = await RTStructImpl.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStructImpl.load({ rtstruct: bytes, geometry: g() });
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("MISSING_RT_ROI_OBSERVATIONS");
  });

  it("IO-07 marks machine-generated structures as AUTOMATIC", async () => {
    const bytes = await RTStructImpl.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStructImpl.load({ rtstruct: bytes, geometry: g() });
    expect(rt.roi("AI Tumor").provenance.holeInterpretation).toBeDefined();
  });

  it("IO-08 interpretedType defaults to ORGAN and is never silently EXTERNAL", async () => {
    const bytes = await RTStructImpl.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStructImpl.load({ rtstruct: bytes, geometry: g() });
    expect(rt.roi("AI Tumor").interpretedType).toBe("ORGAN");
  });
});
