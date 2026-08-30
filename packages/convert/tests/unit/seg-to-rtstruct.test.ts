import { describe, expect, it } from "vitest";
import { createScalarField, createUniformGrid, cubePhantom, maskFromDense, spherePhantom } from "rt-geometry-js";
import { readSeg, writeSeg } from "dicom-seg-js";
import { RTStruct } from "rtstruct-js";
import {
  MissingThresholdError,
  SegmentNotFoundError,
  segToRtstruct,
} from "../../src/index.js";
import type { ConversionProvenance, MaskVectorizationStep } from "../../src/index.js";

/** Narrow the union — every `segToRtstruct` result carries exactly one. */
function vectorStep(p: ConversionProvenance): MaskVectorizationStep {
  const s = p.lossySteps.find((x) => x.kind === "mask-vectorization");
  if (!s || s.kind !== "mask-vectorization") throw new Error("expected a mask-vectorization step");
  return s;
}

// A valid DICOM UID (numeric components only) — dcmjs silently mangles non-numeric ones.
const FOR = "1.2.826.0.1.3680043.9.7.300";

function grid(frameOfReferenceUID: string | undefined = FOR) {
  return createUniformGrid({
    rows: 24,
    columns: 24,
    planeCount: 12,
    pixelSpacing: [2, 2],
    sliceSpacingMm: 2,
    frameOfReferenceUID,
  });
}

function binarySeg(mask: ReturnType<typeof cubePhantom>, label = "Kidney", number = 1) {
  return readSeg(writeSeg({ segmentationType: "BINARY", segments: [{ number, label, mask }] }));
}

describe("segToRtstruct", () => {
  it("CONV-SR-01 a grid-aligned BINARY segment round-trips to an RTSTRUCT ROI with no voxel change", async () => {
    const g = grid();
    const seg = binarySeg(cubePhantom(g, 20));
    const { bytes, provenance } = await segToRtstruct(seg, 1);

    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g });
    expect(rt.getROINames()).toEqual(["Kidney"]);

    const step = vectorStep(provenance);
    expect(step).toMatchObject({ voxelDisagreement: 0, dice: 1 });
    expect(step.voxelsBefore).toBe(seg.mask(1).count());
    expect(step.voxelsAfter).toBe(seg.mask(1).count());
  });

  it("CONV-SR-02 a curved segment reports the vectorization round trip honestly (high Dice, not exact)", async () => {
    const g = grid();
    const seg = binarySeg(spherePhantom(g, 16));
    const { provenance } = await segToRtstruct(seg, 1);

    const step = vectorStep(provenance);
    expect(step.voxelsBefore).toBe(seg.mask(1).count());
    expect(step.voxelsBefore).toBeGreaterThan(0);
    expect(step.voxelsAfter).toBeGreaterThan(0);
    expect(step.dice).toBeGreaterThan(0.95);
    expect(step.dice).toBeLessThanOrEqual(1);
    // detail text reflects whichever branch was taken
    expect(step.detail.length).toBeGreaterThan(0);
  });

  it("CONV-SR-03 provenance records direction, grid, voxel count, source, library identity", async () => {
    const g = grid();
    const seg = binarySeg(cubePhantom(g, 20), "Liver");
    const { provenance } = await segToRtstruct(seg, 1);

    expect(provenance.direction).toBe("seg-to-rtstruct");
    expect(provenance.grid).toEqual({ rows: 24, columns: 24, planes: 12, frameOfReferenceUID: FOR });
    expect(provenance.voxelCount).toBe(seg.mask(1).count());
    expect(provenance.source).toContain("segment 1");
    expect(provenance.source).toContain("Liver");
    expect(provenance.library).toBe("rt-convert-js");
    expect(provenance.libraryVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("CONV-SR-04 roiName / interpretedType / referencedFrameOfReferenceUID flow into the RTSTRUCT", async () => {
    const g = grid();
    const seg = binarySeg(cubePhantom(g, 20));
    const { bytes } = await segToRtstruct(seg, 1, {
      roiName: "GTVp",
      interpretedType: "GTV",
      referencedFrameOfReferenceUID: FOR,
    });

    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g });
    expect(rt.getROINames()).toEqual(["GTVp"]);
    expect(rt.roi("GTVp").interpretedType).toBe("GTV");
    expect(rt.diagnostics.map((d) => d.code)).not.toContain("FRAME_OF_REFERENCE_MISMATCH");
  });

  it("CONV-SR-05 default ROIName is the SegmentLabel, or 'Segment <n>' when the label is empty", async () => {
    const g = grid();
    expect(
      (await RTStruct.load({
        rtstruct: (await segToRtstruct(binarySeg(cubePhantom(g, 20), "Spinal Cord"), 1)).bytes,
        geometry: g,
      })).getROINames(),
    ).toEqual(["Spinal Cord"]);

    expect(
      (await RTStruct.load({
        rtstruct: (await segToRtstruct(binarySeg(cubePhantom(g, 20), "", 2), 2)).bytes,
        geometry: g,
      })).getROINames(),
    ).toEqual(["Segment 2"]);
  });

  it("CONV-SR-06 a FRACTIONAL SEG throws MissingThresholdError", async () => {
    const g = grid();
    const field = createScalarField(g, (c, r, k) => (c > 6 && c < 16 && r > 6 && r < 16 && k > 2 && k < 9 ? 0.8 : 0));
    const seg = readSeg(
      writeSeg({
        segmentationType: "FRACTIONAL",
        fractionalType: "PROBABILITY",
        segments: [{ number: 1, label: "tumour", field }],
      }),
    );
    expect(seg.type).toBe("FRACTIONAL");
    await expect(segToRtstruct(seg, 1)).rejects.toThrow(MissingThresholdError);
  });

  it("CONV-SR-07 an unknown segment number throws SegmentNotFoundError", async () => {
    const g = grid();
    const seg = binarySeg(cubePhantom(g, 20));
    await expect(segToRtstruct(seg, 9)).rejects.toThrow(SegmentNotFoundError);
  });

  it("CONV-SR-08 an empty segment converts without throwing and is flagged in provenance notes", async () => {
    const g = grid();
    const emptyMask = maskFromDense(g, new Uint8Array(g.rows * g.columns * g.planes.length));
    const seg = binarySeg(emptyMask, "EmptyPTV");

    const { bytes, provenance } = await segToRtstruct(seg, 1);
    expect(provenance.voxelCount).toBe(0);
    expect(provenance.notes.join(" ")).toContain("is empty");

    expect(vectorStep(provenance)).toMatchObject({ voxelsBefore: 0, voxelsAfter: 0, voxelDisagreement: 0 });

    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g });
    expect(rt.getMask("EmptyPTV").count()).toBe(0);
  });
});
