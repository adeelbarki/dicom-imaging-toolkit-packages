import { describe, expect, it } from "vitest";
import { readSegDataset, writeSeg } from "../../src/dicom/port.js";
import {
  MalformedSegmentationError,
  NotSegmentationError,
  UnsupportedSegmentationTypeError,
} from "../../src/errors.js";
import { binarySeg, fractionalSeg } from "../fixtures.js";

describe("readSegDataset", () => {
  it("PARSE-01 reads a BINARY SEG: type, segments, geometry, overlap", () => {
    const bytes = binarySeg({
      rows: 4,
      columns: 4,
      planeCount: 3,
      segments: [1, 2],
      zStep: 2,
      pixelSpacing: [1.5, 1.5],
      on: (s, c, r) => (s === 1 ? c < 2 && r < 2 : c === 1 && r === 1),
    });
    const p = readSegDataset(bytes);

    expect(p.segmentationType).toBe("BINARY");
    expect(p.segmentsOverlap).toBe("NO");
    expect(p.segments.map((s) => s.number)).toEqual([1, 2]);
    expect(p.geometry.rows).toBe(4);
    expect(p.geometry.columns).toBe(4);
    expect(p.geometry.planes.length).toBe(3);
    expect(p.geometry.pixelSpacing).toEqual([1.5, 1.5]);
    // 2 segments × 3 planes = 6 frames
    expect(p.frames.length).toBe(6);
    expect(p.segments.find((s) => s.number === 1)?.frameCount).toBe(3);
  });

  it("PARSE-02 orders planes ascending along the normal regardless of frame order", () => {
    const bytes = writeSeg({
      rows: 2,
      columns: 2,
      segmentationType: "BINARY",
      segments: [{ number: 1 }],
      frames: [
        { segmentNumber: 1, position: [0, 0, 4], pixels: [1, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 0], pixels: [0, 1, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 2], pixels: [0, 0, 1, 0] },
      ],
    });
    const p = readSegDataset(bytes);
    expect(p.geometry.planes.map((pl) => pl.position[2])).toEqual([0, 2, 4]);
    // the frame written at z=0 must map to plane index 0
    const f0 = p.frames.find((f) => f.frameIndex === 1);
    expect(f0?.planeIndex).toBe(0);
  });

  it("PARSE-03 reads a FRACTIONAL SEG: fractional type + MaximumFractionalValue", () => {
    const bytes = fractionalSeg({
      rows: 3,
      columns: 3,
      planeCount: 2,
      segments: [1],
      max: 100,
      fractionalType: "OCCUPANCY",
      value: () => 50,
    });
    const p = readSegDataset(bytes);
    expect(p.segmentationType).toBe("FRACTIONAL");
    expect(p.fractionalType).toBe("OCCUPANCY");
    expect(p.maximumFractionalValue).toBe(100);
  });

  it("PARSE-04 warns when a FRACTIONAL SEG omits SegmentationFractionalType", () => {
    const bytes = writeSeg({
      rows: 2,
      columns: 2,
      segmentationType: "FRACTIONAL",
      omitFractionalType: true,
      segments: [{ number: 1 }],
      frames: [{ segmentNumber: 1, position: [0, 0, 0], pixels: [255, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 1], pixels: [0, 0, 0, 0] }],
    });
    const p = readSegDataset(bytes);
    expect(p.fractionalType).toBeUndefined();
    expect(p.diagnostics.map((d) => d.code)).toContain("FRACTIONAL_TYPE_ABSENT");
  });

  it("PARSE-05 warns and defaults to 255 when MaximumFractionalValue is absent", () => {
    const bytes = writeSeg({
      rows: 2,
      columns: 2,
      segmentationType: "FRACTIONAL",
      omitMaximumFractionalValue: true,
      segments: [{ number: 1 }],
      frames: [{ segmentNumber: 1, position: [0, 0, 0], pixels: [255, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 1], pixels: [0, 0, 0, 0] }],
    });
    const p = readSegDataset(bytes);
    expect(p.maximumFractionalValue).toBe(255);
    expect(p.diagnostics.map((d) => d.code)).toContain("MISSING_MAX_FRACTIONAL_VALUE");
  });

  it("PARSE-06 surfaces SegmentsOverlap YES as a diagnostic", () => {
    const bytes = binarySeg({
      rows: 2, columns: 2, planeCount: 2, segments: [1, 2], segmentsOverlap: "YES",
      on: () => true,
    });
    const p = readSegDataset(bytes);
    expect(p.segmentsOverlap).toBe("YES");
    expect(p.diagnostics.map((d) => d.code)).toContain("SEGMENTS_OVERLAP");
  });

  it("PARSE-07 rejects LABELMAP with a pointer to 0.2.0", () => {
    const bytes = writeSeg({
      rows: 2, columns: 2, segmentationType: "BINARY", forceType: "LABELMAP",
      segments: [{ number: 1 }],
      frames: [{ segmentNumber: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 1], pixels: [0, 0, 0, 0] }],
    });
    expect(() => readSegDataset(bytes)).toThrow(UnsupportedSegmentationTypeError);
  });

  it("PARSE-08 rejects a non-SEG SOP class", () => {
    const bytes = writeSeg({
      rows: 2, columns: 2, segmentationType: "BINARY",
      sopClassUID: "1.2.840.10008.5.1.4.1.1.2", modality: "CT",
      segments: [{ number: 1 }],
      frames: [{ segmentNumber: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 1], pixels: [0, 0, 0, 0] }],
    });
    expect(() => readSegDataset(bytes)).toThrow(NotSegmentationError);
  });

  it("PARSE-09 rejects a frame that references an undeclared segment number", () => {
    const bytes = writeSeg({
      rows: 2, columns: 2, segmentationType: "BINARY",
      segments: [{ number: 1 }],
      frames: [
        { segmentNumber: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0] },
        { segmentNumber: 7, position: [0, 0, 1], pixels: [1, 0, 0, 0] },
      ],
    });
    expect(() => readSegDataset(bytes)).toThrow(MalformedSegmentationError);
  });

  it("PARSE-10 carries coded category/type through", () => {
    const bytes = writeSeg({
      rows: 2, columns: 2, segmentationType: "BINARY",
      segments: [{
        number: 1,
        category: { value: "T-D000A", scheme: "SRT", meaning: "Anatomical Structure" },
        propertyType: { value: "T-62002", scheme: "SRT", meaning: "Liver" },
      }],
      frames: [{ segmentNumber: 1, position: [0, 0, 0], pixels: [1, 0, 0, 0] },
        { segmentNumber: 1, position: [0, 0, 1], pixels: [0, 0, 0, 0] }],
    });
    const p = readSegDataset(bytes);
    expect(p.segments[0]?.category?.meaning).toBe("Anatomical Structure");
    expect(p.segments[0]?.propertyType?.meaning).toBe("Liver");
  });
});
