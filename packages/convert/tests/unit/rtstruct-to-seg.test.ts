import { describe, expect, it } from "vitest";
import {
  createUniformGrid,
  cubePhantom,
  maskFromDense,
  spherePhantom,
  voxelDisagreement,
} from "rt-geometry-js";
import { RTStruct } from "rtstruct-js";
import { readSeg } from "dicom-seg-js";
import { rtstructToSeg } from "../../src/index.js";

// A valid DICOM UID (numeric components only) — dcmjs silently mangles non-numeric ones.
const FOR = "1.2.826.0.1.3680043.9.7.100";

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

/** phantom mask -> RTSTRUCT bytes -> loaded RTStruct on the same grid. */
async function loadedRtstruct(
  mask: ReturnType<typeof cubePhantom>,
  g = grid(),
  name = "Kidney",
) {
  const bytes = await RTStruct.createFromMask({
    mask,
    name,
    interpretedType: "ORGAN",
    referencedFrameOfReferenceUID: FOR,
  });
  return RTStruct.load({ rtstruct: bytes, geometry: g });
}

describe("rtstructToSeg", () => {
  it("CONV-RS-01 round-trips an ROI to a BINARY SEG, voxel-for-voxel identical to the loaded ROI mask", async () => {
    const g = grid();
    const rt = await loadedRtstruct(cubePhantom(g, 20), g);
    const { bytes } = rtstructToSeg(rt, "Kidney");

    const seg = readSeg(bytes);
    expect(seg.type).toBe("BINARY");
    expect(seg.segments().map((s) => s.number)).toEqual([1]);
    expect(voxelDisagreement(seg.mask(1), rt.getMask("Kidney"))).toBe(0);
  });

  it("CONV-RS-02 the copy is exact even for a curved shape (no second rasterization)", async () => {
    const g = grid();
    const rt = await loadedRtstruct(spherePhantom(g, 16), g);
    const { bytes, provenance } = rtstructToSeg(rt, "Kidney");

    expect(voxelDisagreement(readSeg(bytes).mask(1), rt.getMask("Kidney"))).toBe(0);
    // this direction adds nothing lossy — the contours were already voxels
    expect(provenance.lossySteps).toEqual([]);
  });

  it("CONV-RS-03 provenance records direction, grid, voxel count, and library identity", async () => {
    const g = grid();
    const rt = await loadedRtstruct(cubePhantom(g, 20), g);
    const { provenance } = rtstructToSeg(rt, "Kidney");

    expect(provenance.direction).toBe("rtstruct-to-seg");
    expect(provenance.grid).toEqual({ rows: 24, columns: 24, planes: 12, frameOfReferenceUID: FOR });
    expect(provenance.voxelCount).toBe(rt.getMask("Kidney").count());
    expect(provenance.voxelCount).toBeGreaterThan(0);
    expect(provenance.library).toBe("rt-convert-js");
    expect(provenance.libraryVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(provenance.source).toContain("Kidney");
  });

  it("CONV-RS-04 segmentNumber / segmentLabel / category / propertyType flow into the SEG", async () => {
    const g = grid();
    const rt = await loadedRtstruct(cubePhantom(g, 20), g);
    const { bytes } = rtstructToSeg(rt, "Kidney", {
      segmentNumber: 3,
      segmentLabel: "Right kidney",
      category: { value: "T-D0050", scheme: "SRT", meaning: "Anatomical Structure" },
      propertyType: { value: "T-71000", scheme: "SRT", meaning: "Kidney" },
    });

    const seg = readSeg(bytes);
    const info = seg.segments()[0]!;
    expect(info.number).toBe(3);
    expect(info.label).toBe("Right kidney");
    expect(info.category?.meaning).toBe("Anatomical Structure");
    expect(info.propertyType?.meaning).toBe("Kidney");
    expect(seg.mask(3).count()).toBe(rt.getMask("Kidney").count());
  });

  it("CONV-RS-05 the SEG carries the shared frame of reference; an explicit override wins", async () => {
    const g = grid();
    const rt = await loadedRtstruct(cubePhantom(g, 20), g);

    expect(readSeg(rtstructToSeg(rt, "Kidney").bytes).frameOfReferenceUID).toBe(FOR);
    expect(
      readSeg(rtstructToSeg(rt, "Kidney", { frameOfReferenceUID: "1.2.826.0.1.3680043.9.7.200" }).bytes)
        .frameOfReferenceUID,
    ).toBe("1.2.826.0.1.3680043.9.7.200");
  });

  it("CONV-RS-06 an empty ROI converts without throwing and is flagged in provenance notes", async () => {
    const g = grid();
    const emptyMask = maskFromDense(g, new Uint8Array(g.rows * g.columns * g.planes.length));
    const rt = await RTStruct.load({
      rtstruct: await RTStruct.createFromMask({ mask: emptyMask, name: "EmptyPTV", referencedFrameOfReferenceUID: FOR }),
      geometry: g,
    });

    const { bytes, provenance } = rtstructToSeg(rt, "EmptyPTV");
    expect(provenance.voxelCount).toBe(0);
    expect(provenance.notes.join(" ")).toContain("zero voxels");

    const seg = readSeg(bytes);
    expect(seg.segments().map((s) => s.number)).toEqual([1]);
    expect(seg.mask(1).count()).toBe(0);
  });

  it("CONV-RS-07 an unknown ROI name throws (RangeError from rtstruct-js, not wrapped)", async () => {
    const g = grid();
    const rt = await loadedRtstruct(cubePhantom(g, 20), g);
    expect(() => rtstructToSeg(rt, "NoSuchROI")).toThrow(RangeError);
  });
});
