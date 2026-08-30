import { describe, expect, it } from "vitest";
import { createUniformGrid } from "rt-geometry-js";
import { RTStruct } from "../../src/index.js";
import { readRTStruct } from "../../src/dicom/port.js";
import { buildFixture } from "../fixtures.js";
import type { Contour } from "../../src/contour/types.js";
import type { SeriesGeometry } from "../../src/types.js";

// dcmjs strips non-numeric characters from VR UI values, so SOPInstanceUIDs in fixtures
// must be real (numeric-component) UIDs — "s0" would round-trip through write→read as "0".
const SOP = [
  "1.2.826.0.1.3680043.9.7.101",
  "1.2.826.0.1.3680043.9.7.102",
  "1.2.826.0.1.3680043.9.7.103",
  "1.2.826.0.1.3680043.9.7.104",
] as const;
const SOP_MISSING = "1.2.826.0.1.3680043.9.7.999";

// A 4-plane axial grid at z = 0, 2, 4, 6 mm.
function grid() {
  return createUniformGrid({
    rows: 16,
    columns: 16,
    planeCount: 4,
    pixelSpacing: [1, 1],
    sliceSpacingMm: 2,
    frameOfReferenceUID: "1.2.826.0.1.3680043.9.7.777",
  });
}

/** A small square contour on plane `z`, optionally carrying a ContourImageSequence ref. */
function square(z: number, ref?: string): Contour {
  return {
    geometricType: "CLOSED_PLANAR",
    points: [
      [2, 2, z],
      [6, 2, z],
      [6, 6, z],
      [2, 6, z],
    ],
    ...(ref ? { referencedSOPInstanceUIDs: [ref] } : {}),
  };
}

/** A SeriesGeometry whose slices carry the given SOP UIDs, one per plane (z = 0,2,4,6). */
function series(sopUIDs: readonly (string | undefined)[]): SeriesGeometry {
  const g = grid();
  return {
    grid: g,
    frameOfReferenceUID: g.frameOfReferenceUID,
    slices: sopUIDs.flatMap((uid, i) =>
      uid === undefined ? [] : [{ sopInstanceUID: uid, imagePositionPatient: [0, 0, i * 2] as const }],
    ),
  };
}

describe("SLICE-ASSOC: ContourImageSequence parsing", () => {
  it("SA-01 referencedSOPInstanceUIDs round-trips through write → read", () => {
    const bytes = buildFixture({ rois: [{ name: "GTV", contours: [square(0, "1.2.3.4"), square(2)] }] });
    const parsed = readRTStruct(bytes);
    const contours = parsed.rois[0]!.contours;
    expect(contours[0]!.referencedSOPInstanceUIDs).toEqual(["1.2.3.4"]);
    expect(contours[1]!.referencedSOPInstanceUIDs).toBeUndefined();
  });
});

describe("SLICE-ASSOC: association path", () => {
  it("SA-02 a bare GridGeometry is always geometric-fallback, even with SOP refs present", async () => {
    const bytes = buildFixture({ rois: [{ name: "GTV", contours: [square(0, SOP[0]), square(2, SOP[1])] }] });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: grid() });
    const roi = rt.roi("GTV");
    expect(roi.sliceAssociation).toBe("geometric-fallback");
    expect(roi.sliceAssociationDetail).toEqual({
      totalContours: 2,
      sopReferenced: 0,
      geometricFallback: 2,
      unresolvedSopReferences: 0,
    });
  });

  it("SA-03 a SeriesGeometry whose slices match every contour ref → sop-reference", async () => {
    const bytes = buildFixture({
      rois: [{ name: "GTV", contours: [square(0, SOP[0]), square(2, SOP[1]), square(4, SOP[2])] }],
    });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: series(SOP) });
    const roi = rt.roi("GTV");
    expect(roi.sliceAssociation).toBe("sop-reference");
    expect(roi.sliceAssociationDetail.sopReferenced).toBe(3);
    expect(roi.sliceAssociationDetail.geometricFallback).toBe(0);
    expect(rt.getMask("GTV").count()).toBeGreaterThan(0);
  });

  it("SA-04 some refs resolve, some don't → geometric-fallback with a split + SOP_REFERENCE_UNRESOLVED", async () => {
    const bytes = buildFixture({
      rois: [{ name: "GTV", contours: [square(0, SOP[0]), square(2, SOP_MISSING), square(4)] }],
    });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: series(SOP) });
    const roi = rt.roi("GTV");
    expect(roi.sliceAssociation).toBe("geometric-fallback");
    expect(roi.sliceAssociationDetail).toEqual({
      totalContours: 3,
      sopReferenced: 1,
      geometricFallback: 2,
      unresolvedSopReferences: 1,
    });
    expect(roi.diagnostics.map((d) => d.code)).toContain("SOP_REFERENCE_UNRESOLVED");
  });

  it("SA-05 a SOP ref that disagrees with geometry wins, and raises SOP_REFERENCE_PLANE_MISMATCH", async () => {
    // contour geometry says z=0 (plane 0) but its ref names the slice at plane 2
    const contour: Contour = { ...square(0), referencedSOPInstanceUIDs: [SOP[2]] };
    const bytes = buildFixture({ rois: [{ name: "GTV", contours: [contour] }] });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: series(SOP) });
    const roi = rt.roi("GTV");
    expect(roi.sliceAssociation).toBe("sop-reference");
    expect(roi.diagnostics.map((d) => d.code)).toContain("SOP_REFERENCE_PLANE_MISMATCH");
    // the mask voxels landed on plane 2, not plane 0
    expect(rt.getMask("GTV").getSliceBuffer(0).some((v) => v !== 0)).toBe(false);
    expect(rt.getMask("GTV").getSliceBuffer(2).some((v) => v !== 0)).toBe(true);
  });

  it("SA-06 SeriesGeometry supplied but no contour carries a ref → MISSING_CONTOUR_IMAGE_SEQUENCE, all geometric", async () => {
    const bytes = buildFixture({ rois: [{ name: "GTV", contours: [square(0), square(2)] }] });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: series(SOP) });
    expect(rt.diagnostics.map((d) => d.code)).toContain("MISSING_CONTOUR_IMAGE_SEQUENCE");
    expect(rt.roi("GTV").sliceAssociation).toBe("geometric-fallback");
    expect(rt.roi("GTV").sliceAssociationDetail.geometricFallback).toBe(2);
  });

  it("SA-07 provenance.sliceAssociation and the handle mirror agree", async () => {
    const bytes = buildFixture({ rois: [{ name: "GTV", contours: [square(0, SOP[0]), square(2, SOP[1])] }] });
    const rt = await RTStruct.load({ rtstruct: bytes, geometry: series(SOP) });
    const roi = rt.roi("GTV");
    expect(roi.sliceAssociation).toBe(roi.provenance.sliceAssociation);
    expect(roi.sliceAssociation).toBe("sop-reference");
  });
});
