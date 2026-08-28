/**
 * rtdose-js — DICOM RTDOSE reading and dose-volume histograms, built on rt-geometry-js.
 *
 * NOT a treatment planning system and NOT clinically validated. See `docs/DVH-METHOD.md`
 * and the README for the resampling / interpolation / partial-volume choices behind every
 * number.
 *
 * The whole rt-geometry-js surface (GridGeometry, Mask3D, ScalarField3D, resampling,
 * histograms, metrics, geometry errors) is re-exported so a caller can build a structure
 * mask and query dose against it from a single import.
 */
export * from "rt-geometry-js";
export * from "./types.js";
export * from "./errors.js";
export { DoseGrid } from "./dose-grid.js";
// readRTDose is a standalone parse (bytes -> dose grid), the counterpart of rtstruct-js's
// readSeriesGeometry. The writeRTDose fixture builder in dicom/port.ts is deliberately NOT
// re-exported — tests import it directly (same rule as rtstruct-js's writeRTStruct).
export { readRTDose } from "./dicom/port.js";
export type { RTDoseParse } from "./dicom/port.js";
