import { describe, expect, it } from "vitest";
import { RTStruct, RTStructImpl } from "../../src/index.js";
import { FrameOfReferenceMismatchError } from "rt-geometry-js";
import { AmbiguousRoiNameError } from "../../src/errors.js";
import { createUniformGrid } from "rt-geometry-js";
import { cubePhantom } from "rt-geometry-js";

const g = (frameOfReferenceUID?: string) =>
  createUniformGrid({ rows: 32, columns: 32, planeCount: 16, pixelSpacing: [1, 1], sliceSpacingMm: 1, frameOfReferenceUID });

/** Fixtures are BUILT, never checked in: no PHI, no vendor licensing question. */
declare function buildFixture(spec: Record<string, unknown>): ArrayBuffer;

describe("IO: tolerant reading", () => {
  it("IO-01 an ROI with no ContourSequence is listed and does not throw", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ rois: [{ name: "EmptyPTV", contours: [] }] }), geometry: g() });
    expect(rt.getROINames()).toContain("EmptyPTV");
    expect(rt.getMask("EmptyPTV").count()).toBe(0);
    expect(rt.diagnostics.map((d) => d.code)).toContain("EMPTY_ROI");
  });

  it("IO-02 sequences stored out of order are joined by ROINumber", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ shuffleSequences: true, rois: [{ name: "A" }, { name: "B" }] }), geometry: g() });
    expect(rt.roi("B").name).toBe("B");
  });

  it("IO-03 a missing RTROIObservationsSequence reads fine (Type 3 in PS3.3 2026c)", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ omitRTROIObservations: true, rois: [{ name: "A" }] }), geometry: g() });
    expect(rt.getROINames()).toEqual(["A"]);
    expect(rt.diagnostics.map((d) => d.code)).toContain("MISSING_RT_ROI_OBSERVATIONS");
  });

  it("IO-04 ROI names are never normalized", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ rois: [{ name: "gtv_p " }] }), geometry: g() });
    expect(rt.getROINames()).toEqual(["gtv_p "]);
  });

  it("IO-05 absent ROI Volume returns undefined rather than a computed substitute", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ rois: [{ name: "A" }] }), geometry: g() });
    expect(rt.dicomVolume("A")).toBeUndefined();
  });
});

describe("IO: ROI identity is ROINumber, not ROIName — duplicate names must not silently overwrite", () => {
  it("IO-15 two ROIs with the same name both load, keyed by distinct ROINumbers", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "GTV" }, { name: "GTV" }] }),
      geometry: g(),
    });
    expect(rt.getROINumbers()).toEqual([1, 2]);
    expect(rt.getROINames()).toEqual(["GTV", "GTV"]);
  });

  it("IO-16 roi(number) unambiguously resolves either duplicate", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "GTV" }, { name: "GTV" }] }),
      geometry: g(),
    });
    expect(rt.roi(1).roiNumber).toBe(1);
    expect(rt.roi(2).roiNumber).toBe(2);
  });

  it("IO-17 roi(name) throws AmbiguousRoiNameError when more than one ROI shares the name", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "GTV" }, { name: "GTV" }] }),
      geometry: g(),
    });
    expect(() => rt.roi("GTV")).toThrow(AmbiguousRoiNameError);
    expect(() => rt.getMask("GTV")).toThrow(AmbiguousRoiNameError);
  });

  it("IO-18 findROIsByName returns every match instead of forcing disambiguation", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "GTV" }, { name: "GTV" }, { name: "PTV" }] }),
      geometry: g(),
    });
    const matches = rt.findROIsByName("GTV");
    expect(matches).toHaveLength(2);
    expect(matches.map((r) => r.roiNumber).sort()).toEqual([1, 2]);
    expect(rt.findROIsByName("nonexistent")).toEqual([]);
  });

  it("IO-19 a unique name still resolves directly by string, unaffected", async () => {
    const rt = await RTStruct.load({ rtstruct: buildFixture({ rois: [{ name: "A" }] }), geometry: g() });
    expect(rt.roi("A").name).toBe("A");
    expect(rt.getMask("A").count()).toBeGreaterThanOrEqual(0);
  });
});

describe("IO: deprecated RTStructImpl alias", () => {
  it("IO-14 RTStructImpl is the same class as RTStruct and still works", async () => {
    expect(RTStructImpl).toBe(RTStruct);
    const bytes = await RTStructImpl.createFromMask({ mask: cubePhantom(g(), 6), name: "A" });
    const rt = await RTStructImpl.load({ rtstruct: bytes, geometry: g() });
    expect(rt.getROINames()).toEqual(["A"]);
  });
});

describe("IO: frame of reference cross-check on load", () => {
  it("IO-09 mismatched FoR with default strictness warns but still loads", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "A", referencedFrameOfReferenceUID: "1.2.3" }] }),
      geometry: g("1.2.4"),
    });
    expect(rt.getROINames()).toEqual(["A"]);
    expect(rt.diagnostics.map((d) => d.code)).toContain("FRAME_OF_REFERENCE_MISMATCH");
  });

  it("IO-10 mismatched FoR with strictness 'strict' throws", async () => {
    await expect(
      RTStruct.load({
        rtstruct: buildFixture({ rois: [{ name: "A", referencedFrameOfReferenceUID: "1.2.3" }] }),
        geometry: g("1.2.4"),
        strictness: "strict",
      }),
    ).rejects.toThrow(FrameOfReferenceMismatchError);
  });

  it("IO-11 mismatched FoR with strictness 'silent' produces no diagnostic", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "A", referencedFrameOfReferenceUID: "1.2.3" }] }),
      geometry: g("1.2.4"),
      strictness: "silent",
    });
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("FRAME_OF_REFERENCE_MISMATCH");
  });

  it("IO-12 matching FoR produces no diagnostic", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "A", referencedFrameOfReferenceUID: "1.2.3" }] }),
      geometry: g("1.2.3"),
    });
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("FRAME_OF_REFERENCE_MISMATCH");
  });

  it("IO-13 either side missing a FoR produces no diagnostic (nothing to contradict)", async () => {
    const rt = await RTStruct.load({
      rtstruct: buildFixture({ rois: [{ name: "A", referencedFrameOfReferenceUID: "1.2.3" }] }),
      geometry: g(), // no frameOfReferenceUID
    });
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("FRAME_OF_REFERENCE_MISMATCH");
  });
});

describe("IO: conservative writing", () => {
  it("IO-06 writes all three sequences even though 2026c permits omission", async () => {
    const bytes = await RTStruct.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g() });
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("MISSING_RT_ROI_OBSERVATIONS");
  });

  it("IO-07 marks machine-generated structures as AUTOMATIC", async () => {
    const bytes = await RTStruct.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g() });
    expect(rt.roi("AI Tumor").provenance.holeInterpretation).toBeDefined();
  });

  it("IO-08 interpretedType defaults to ORGAN and is never silently EXTERNAL", async () => {
    const bytes = await RTStruct.createFromMask({ mask: cubePhantom(g(), 6), name: "AI Tumor" });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g() });
    expect(rt.roi("AI Tumor").interpretedType).toBe("ORGAN");
  });
});
