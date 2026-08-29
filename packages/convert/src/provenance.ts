import type { GridGeometry } from "rt-geometry-js";
import { VERSION } from "./version.js";

export type ConversionDirection = "rtstruct-to-seg" | "seg-to-rtstruct";

export interface GridSummary {
  readonly rows: number;
  readonly columns: number;
  readonly planes: number;
  readonly frameOfReferenceUID: string | undefined;
}

/**
 * A step in a conversion that does not round-trip. Every conversion result lists the ones
 * that applied, each with enough detail to reproduce and audit it.
 */
export type LossyStep = FractionalThresholdStep | MaskVectorizationStep;

/** A `FRACTIONAL` SEG field was cut to a binary mask at a caller-chosen threshold. */
export interface FractionalThresholdStep {
  readonly kind: "fractional-threshold";
  /** The threshold as supplied by the caller. */
  readonly threshold: number;
  /** `"unit"`: threshold is in `[0, 1]` against the rescaled field. `"raw"`: it is a
   *  stored integer in `[0, maximumFractionalValue]`. */
  readonly thresholdScale: "unit" | "raw";
  /** The SEG's declared `SegmentationFractionalType`, or `undefined` if the file omitted
   *  it (a value of 0.7 means something different under PROBABILITY vs OCCUPANCY). */
  readonly fractionalType: "PROBABILITY" | "OCCUPANCY" | undefined;
  readonly maximumFractionalValue: number;
  /** Non-zero voxels in the source field. */
  readonly voxelsBefore: number;
  /** Voxels kept after the threshold. */
  readonly voxelsAfter: number;
  readonly detail: string;
}

/** A binary mask was traced to polygon contours for RTSTRUCT. */
export interface MaskVectorizationStep {
  readonly kind: "mask-vectorization";
  readonly detail: string;
}

export interface ConversionProvenance {
  readonly direction: ConversionDirection;
  /** Human-readable description of what was converted. */
  readonly source: string;
  /** The grid both objects share. Conversions never resample — the output is on exactly
   *  this grid. */
  readonly grid: GridSummary;
  /** Non-zero voxels in the mask/field that was written. */
  readonly voxelCount: number;
  readonly lossySteps: readonly LossyStep[];
  /** Non-fatal observations, including diagnostics carried across from the source object. */
  readonly notes: readonly string[];
  readonly library: "rt-convert-js";
  readonly libraryVersion: string;
}

export interface ConversionResult {
  /** The converted DICOM object, ready to write to disk or send onward. */
  readonly bytes: ArrayBuffer;
  readonly provenance: ConversionProvenance;
}

export function gridSummary(g: GridGeometry): GridSummary {
  return {
    rows: g.rows,
    columns: g.columns,
    planes: g.planes.length,
    frameOfReferenceUID: g.frameOfReferenceUID,
  };
}

export function buildProvenance(
  p: Omit<ConversionProvenance, "library" | "libraryVersion">,
): ConversionProvenance {
  return { ...p, library: "rt-convert-js", libraryVersion: VERSION };
}
