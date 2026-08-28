import { writeRTDose, type WriteRTDoseOptions } from "../src/dicom/port.js";

/** Fixtures are BUILT, never checked in — same rule as rtstruct-js. */
export { writeRTDose };
export type { WriteRTDoseOptions };

/**
 * A dose grid whose stored value at frame `f`, row `r`, column `c` is `fn(c, r, f)` in Gy,
 * encoded back to integers via `1 / scaling`. With the default `scaling = 0.01` and
 * 16-bit unsigned storage, doses up to ~655 Gy round-trip within 0.01 Gy.
 */
export function doseFixtureFromGy(params: {
  rows: number;
  columns: number;
  frameOffsets?: readonly number[];
  gy: (column: number, row: number, frame: number) => number;
  scaling?: number;
  imagePositionPatient?: readonly [number, number, number];
  pixelSpacing?: readonly [number, number];
  frameOfReferenceUID?: string;
  bitsAllocated?: 16 | 32;
}): ArrayBuffer {
  const scaling = params.scaling ?? 0.01;
  const opts: WriteRTDoseOptions = {
    rows: params.rows,
    columns: params.columns,
    frameOffsets: params.frameOffsets ?? [0],
    doseGridScaling: scaling,
    bitsAllocated: params.bitsAllocated ?? 16,
    storedValues: (c, r, f) => Math.round(params.gy(c, r, f) / scaling),
    ...(params.imagePositionPatient ? { imagePositionPatient: params.imagePositionPatient } : {}),
    ...(params.pixelSpacing ? { pixelSpacing: params.pixelSpacing } : {}),
    ...(params.frameOfReferenceUID ? { frameOfReferenceUID: params.frameOfReferenceUID } : {}),
  };
  return writeRTDose(opts);
}
