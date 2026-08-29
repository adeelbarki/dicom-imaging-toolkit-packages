import { writeSeg, type WriteSegOptions, type WriteSegFrame } from "../src/dicom/port.js";
import type { Vec3 } from "rt-geometry-js";

/** Fixtures are BUILT, never checked in — same rule as rtstruct-js / rtdose-js. */
export { writeSeg };
export type { WriteSegOptions, WriteSegFrame };

/**
 * A BINARY SEG whose pixel at (column, row) of segment `s` on the plane at `z = zStep·k`
 * is `on(s, column, row, k) ? 1 : 0`. Planes k = 0..planeCount-1. Frames are emitted for
 * every (segment, plane) pair (dense — no sparse omission).
 */
export function binarySeg(params: {
  rows: number;
  columns: number;
  planeCount: number;
  segments: readonly number[];
  zStep?: number;
  pixelSpacing?: readonly [number, number];
  frameOfReferenceUID?: string;
  segmentsOverlap?: "YES" | "NO" | "UNDEFINED";
  on: (segment: number, column: number, row: number, k: number) => boolean;
}): ArrayBuffer {
  const zStep = params.zStep ?? 1;
  const frames: WriteSegFrame[] = [];
  for (const s of params.segments) {
    for (let k = 0; k < params.planeCount; k++) {
      const pixels = new Uint8Array(params.rows * params.columns);
      for (let r = 0; r < params.rows; r++)
        for (let c = 0; c < params.columns; c++) pixels[r * params.columns + c] = params.on(s, c, r, k) ? 1 : 0;
      frames.push({ segmentNumber: s, position: [0, 0, k * zStep] as Vec3, pixels });
    }
  }
  const opts: WriteSegOptions = {
    rows: params.rows,
    columns: params.columns,
    segmentationType: "BINARY",
    sliceThickness: zStep,
    segments: params.segments.map((n) => ({ number: n, label: `seg-${n}` })),
    frames,
    ...(params.pixelSpacing ? { pixelSpacing: params.pixelSpacing } : {}),
    ...(params.frameOfReferenceUID ? { frameOfReferenceUID: params.frameOfReferenceUID } : {}),
    ...(params.segmentsOverlap ? { segmentsOverlap: params.segmentsOverlap } : {}),
  };
  return writeSeg(opts);
}

/**
 * A FRACTIONAL SEG whose stored integer at (column, row) of segment `s` on plane `k` is
 * `value(s, column, row, k)` (0..max). Rescaled reads return `value / max`.
 */
export function fractionalSeg(params: {
  rows: number;
  columns: number;
  planeCount: number;
  segments: readonly number[];
  zStep?: number;
  max?: number;
  fractionalType?: "PROBABILITY" | "OCCUPANCY";
  value: (segment: number, column: number, row: number, k: number) => number;
}): ArrayBuffer {
  const zStep = params.zStep ?? 1;
  const max = params.max ?? 255;
  const frames: WriteSegFrame[] = [];
  for (const s of params.segments) {
    for (let k = 0; k < params.planeCount; k++) {
      const pixels = new Uint8Array(params.rows * params.columns);
      for (let r = 0; r < params.rows; r++)
        for (let c = 0; c < params.columns; c++) pixels[r * params.columns + c] = params.value(s, c, r, k);
      frames.push({ segmentNumber: s, position: [0, 0, k * zStep] as Vec3, pixels });
    }
  }
  return writeSeg({
    rows: params.rows,
    columns: params.columns,
    segmentationType: "FRACTIONAL",
    sliceThickness: zStep,
    maximumFractionalValue: max,
    fractionalType: params.fractionalType ?? "PROBABILITY",
    segments: params.segments.map((n) => ({ number: n, label: `seg-${n}` })),
    frames,
  });
}
