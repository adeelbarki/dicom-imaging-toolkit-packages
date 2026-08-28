import { describe, expect, it } from "vitest";
import { dot } from "rt-geometry-js";
import { readRTDose } from "../../src/dicom/port.js";
import { MalformedDoseGridError, NotRTDoseError } from "../../src/errors.js";
import { writeRTDose } from "../fixtures.js";

describe("readRTDose", () => {
  it("PARSE-01 reads dimensions and applies DoseGridScaling", () => {
    const bytes = writeRTDose({
      rows: 2,
      columns: 3,
      frameOffsets: [0, 2, 4],
      doseGridScaling: 0.5,
      storedValues: (c, r, f) => f * 100 + r * 10 + c,
    });
    const { geometry, doseValues, doseGridScaling } = readRTDose(bytes);

    expect(geometry.rows).toBe(2);
    expect(geometry.columns).toBe(3);
    expect(geometry.planes.length).toBe(3);
    expect(doseGridScaling).toBe(0.5);

    // layout: planeIndex * rows*columns + row*columns + column
    const rc = 2 * 3;
    expect(doseValues[0 * rc + 0 * 3 + 0]).toBe(0);
    expect(doseValues[2 * rc + 1 * 3 + 2]).toBe((200 + 10 + 2) * 0.5);
  });

  it("PARSE-02 places planes along the grid normal at the frame offsets", () => {
    const bytes = writeRTDose({
      rows: 2,
      columns: 2,
      imagePositionPatient: [10, 20, 5],
      frameOffsets: [0, 2, 4],
      storedValues: () => 0,
    });
    const { geometry } = readRTDose(bytes);
    const normal = geometry.normal();
    expect(normal).toEqual([0, 0, 1]);
    expect(geometry.planes[1]!.position[2]).toBeCloseTo(7, 10);
    expect(geometry.planes[2]!.position[2]).toBeCloseTo(9, 10);
  });

  it("PARSE-03 sorts non-ascending frames along the normal and flags it", () => {
    const bytes = writeRTDose({
      rows: 1,
      columns: 1,
      frameOffsets: [4, 2, 0],
      doseGridScaling: 1,
      storedValues: (_c, _r, f) => [400, 200, 0][f]!, // value == its own offset*100
    });
    const { geometry, doseValues, diagnostics } = readRTDose(bytes);

    expect(geometry.planes.map((p) => p.position[2])).toEqual([0, 2, 4]);
    // plane 0 now holds the frame that was written last (offset 0, value 0)
    expect(Array.from(doseValues)).toEqual([0, 200, 400]);
    expect(diagnostics.map((d) => d.code)).toContain("DOSE_FRAMES_REORDERED");
  });

  it("PARSE-04 defaults scaling to 1.0 and warns when DoseGridScaling is absent", () => {
    const bytes = writeRTDose({
      rows: 1,
      columns: 1,
      frameOffsets: [0, 1],
      doseGridScaling: null,
      storedValues: () => 42,
    });
    const { doseGridScaling, doseValues, diagnostics } = readRTDose(bytes);
    expect(doseGridScaling).toBe(1);
    expect(doseValues[0]).toBe(42);
    const d = diagnostics.find((x) => x.code === "MISSING_DOSE_GRID_SCALING");
    expect(d?.severity).toBe("warning");
  });

  it("PARSE-05 surfaces non-Gy DoseUnits", () => {
    const bytes = writeRTDose({
      rows: 1,
      columns: 1,
      frameOffsets: [0, 1],
      doseUnits: "RELATIVE",
      storedValues: () => 1,
    });
    const { doseUnits, diagnostics } = readRTDose(bytes);
    expect(doseUnits).toBe("RELATIVE");
    expect(diagnostics.map((d) => d.code)).toContain("DOSE_UNITS_NOT_GY");
  });

  it("PARSE-06 rejects PixelData shorter than frames * rows * columns", () => {
    const bytes = writeRTDose({
      rows: 4,
      columns: 4,
      frameOffsets: [0, 1],
      storedValues: () => 1,
      truncatePixelDataBytesTo: 8,
    });
    expect(() => readRTDose(bytes)).toThrow(MalformedDoseGridError);
  });

  it("PARSE-07 rejects a non-RTDOSE SOP class", () => {
    const bytes = writeRTDose({
      rows: 1,
      columns: 1,
      frameOffsets: [0, 1],
      sopClassUID: "1.2.840.10008.5.1.4.1.1.2", // CT Image Storage
      modality: "CT",
      storedValues: () => 1,
    });
    expect(() => readRTDose(bytes)).toThrow(NotRTDoseError);
  });

  it("PARSE-08 reads 32-bit stored dose", () => {
    const bytes = writeRTDose({
      rows: 2,
      columns: 2,
      frameOffsets: [0, 3],
      bitsAllocated: 32,
      doseGridScaling: 0.001,
      storedValues: () => 250_000,
    });
    const { doseValues } = readRTDose(bytes);
    expect(doseValues[0]).toBeCloseTo(250, 6);
    expect(doseValues.length).toBe(2 * 2 * 2);
  });

  it("PARSE-09 rejects a multi-frame dose with no GridFrameOffsetVector", () => {
    const bytes = writeRTDose({
      rows: 2,
      columns: 2,
      frameOffsets: [0, 2],
      omitGridFrameOffsetVector: true,
      storedValues: () => 1,
    });
    expect(() => readRTDose(bytes)).toThrow(MalformedDoseGridError);
  });

  it("PARSE-10 flags a single-frame dose grid", () => {
    const bytes = writeRTDose({ rows: 3, columns: 3, frameOffsets: [0], storedValues: () => 1 });
    const { geometry, diagnostics } = readRTDose(bytes);
    expect(geometry.planes.length).toBe(1);
    expect(diagnostics.map((d) => d.code)).toContain("SINGLE_FRAME_DOSE_GRID");
  });

  it("PARSE-11 flags a GridFrameOffsetVector that does not start at zero (treated as relative)", () => {
    const bytes = writeRTDose({
      rows: 1,
      columns: 1,
      imagePositionPatient: [0, 0, 100],
      frameOffsets: [100, 103],
      storedValues: () => 1,
    });
    const { geometry, diagnostics } = readRTDose(bytes);
    expect(diagnostics.map((d) => d.code)).toContain("GRID_FRAME_OFFSET_NONZERO_ORIGIN");
    // offsets are relative to IPP: first plane at z = 100 + 100 = 200
    expect(dot(geometry.planes[0]!.position, geometry.normal())).toBeCloseTo(200, 6);
  });
});
