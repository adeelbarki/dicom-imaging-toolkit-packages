import { describe, expect, it } from "vitest";
import { createScalarField, createUniformGrid, cubePhantom, maskFromDense, spherePhantom } from "rt-geometry-js";
import { readSeg, writeSeg } from "dicom-seg-js";
import { RTStruct } from "rtstruct-js";
import {
  MissingThresholdError,
  SegmentNotFoundError,
  segToRtstruct,
} from "../../src/index.js";
import type {
  ConversionProvenance,
  FractionalThresholdStep,
  MaskVectorizationStep,
} from "../../src/index.js";

/** Narrow the union — every `segToRtstruct` result carries exactly one. */
function vectorStep(p: ConversionProvenance): MaskVectorizationStep {
  const s = p.lossySteps.find((x) => x.kind === "mask-vectorization");
  if (!s || s.kind !== "mask-vectorization") throw new Error("expected a mask-vectorization step");
  return s;
}

function thresholdStep(p: ConversionProvenance): FractionalThresholdStep {
  const s = p.lossySteps.find((x) => x.kind === "fractional-threshold");
  if (!s || s.kind !== "fractional-threshold") throw new Error("expected a fractional-threshold step");
  return s;
}

function fractionalSeg(
  fn: (c: number, r: number, k: number) => number,
  opts: { fractionalType?: "PROBABILITY" | "OCCUPANCY"; maximumFractionalValue?: number; fieldScale?: "unit" | "raw"; label?: string } = {},
) {
  const g = grid();
  const field = createScalarField(g, fn);
  return readSeg(
    writeSeg({
      segmentationType: "FRACTIONAL",
      fractionalType: opts.fractionalType ?? "PROBABILITY",
      ...(opts.maximumFractionalValue !== undefined ? { maximumFractionalValue: opts.maximumFractionalValue } : {}),
      ...(opts.fieldScale !== undefined ? { fieldScale: opts.fieldScale } : {}),
      segments: [{ number: 1, label: opts.label ?? "tumour", field }],
    }),
  );
}

/** A soft blob: confidence ramps from ~0.9 at the centre to 0 at the edge of a box. */
function blob(c: number, r: number, k: number): number {
  const dc = Math.abs(c - 12) / 8;
  const dr = Math.abs(r - 12) / 8;
  const dk = Math.abs(k - 6) / 4;
  const d = Math.max(dc, dr, dk);
  return d >= 1 ? 0 : 0.9 * (1 - d);
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

  it("CONV-SR-06 a FRACTIONAL SEG with no threshold throws MissingThresholdError", async () => {
    const seg = fractionalSeg(blob);
    expect(seg.type).toBe("FRACTIONAL");
    await expect(segToRtstruct(seg, 1)).rejects.toThrow(MissingThresholdError);
  });

  it("CONV-SR-09 FRACTIONAL + unit threshold: two lossy steps, fractional-threshold recorded", async () => {
    const seg = fractionalSeg(blob, { fractionalType: "OCCUPANCY" });
    const { bytes, provenance } = await segToRtstruct(seg, 1, { threshold: 0.5 });

    expect(provenance.lossySteps.map((s) => s.kind)).toEqual(["fractional-threshold", "mask-vectorization"]);
    const ft = thresholdStep(provenance);
    expect(ft).toMatchObject({ threshold: 0.5, thresholdScale: "unit", fractionalType: "OCCUPANCY", maximumFractionalValue: 255 });
    expect(ft.voxelsBefore).toBe(seg.support(1).count());
    expect(ft.voxelsAfter).toBeGreaterThan(0);
    expect(ft.voxelsAfter).toBeLessThan(ft.voxelsBefore); // a soft blob loses its low-confidence rim
    expect(provenance.source).toContain("FRACTIONAL/OCCUPANCY");
    expect(provenance.voxelCount).toBe(ft.voxelsAfter);

    // the written RTSTRUCT re-rasterizes to the thresholded mask
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: seg.geometry });
    expect(rt.getMask("tumour").count()).toBe(vectorStep(provenance).voxelsAfter);
  });

  it("CONV-SR-10 a higher threshold keeps strictly fewer voxels", async () => {
    const seg = fractionalSeg(blob);
    const low = thresholdStep((await segToRtstruct(seg, 1, { threshold: 0.3 })).provenance);
    const high = thresholdStep((await segToRtstruct(seg, 1, { threshold: 0.7 })).provenance);
    expect(high.voxelsAfter).toBeLessThan(low.voxelsAfter);
    expect(low.voxelsAfter).toBeLessThanOrEqual(seg.support(1).count());
  });

  it("CONV-SR-11 raw scale thresholds against the stored integers", async () => {
    // stored value = round(unit * 255); blob peaks at 0.9 -> ~229
    const seg = fractionalSeg(blob);
    const { provenance } = await segToRtstruct(seg, 1, { threshold: 200, thresholdScale: "raw" });
    const ft = thresholdStep(provenance);
    expect(ft).toMatchObject({ threshold: 200, thresholdScale: "raw", maximumFractionalValue: 255 });
    expect(ft.voxelsAfter).toBeGreaterThan(0);
    expect(ft.detail).toContain("raw");
  });

  it("CONV-SR-12 an out-of-range threshold throws RangeError", async () => {
    const seg = fractionalSeg(blob);
    await expect(segToRtstruct(seg, 1, { threshold: 1.5 })).rejects.toThrow(RangeError);
    await expect(segToRtstruct(seg, 1, { threshold: 0 })).rejects.toThrow(RangeError);
    await expect(segToRtstruct(seg, 1, { threshold: 300, thresholdScale: "raw" })).rejects.toThrow(RangeError);
  });

  it("CONV-SR-13 a threshold passed for a BINARY SEG is ignored, with a note", async () => {
    const g = grid();
    const seg = binarySeg(cubePhantom(g, 20));
    const { provenance } = await segToRtstruct(seg, 1, { threshold: 0.5 });
    expect(provenance.lossySteps.map((s) => s.kind)).toEqual(["mask-vectorization"]);
    expect(provenance.notes.join(" ")).toContain("ignored");
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
    expect(provenance.notes.join(" ")).toContain("produced no voxels");

    expect(vectorStep(provenance)).toMatchObject({ voxelsBefore: 0, voxelsAfter: 0, voxelDisagreement: 0 });

    const rt = await RTStruct.load({ rtstruct: bytes, geometry: g });
    expect(rt.getMask("EmptyPTV").count()).toBe(0);
  });
});
