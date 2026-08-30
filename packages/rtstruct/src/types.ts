import type { Diagnostic, GridGeometry, GridTolerance, Provenance, SliceAssociation, Vec3 } from "rt-geometry-js";

/** A GridGeometry associated with stored DICOM instances. Composition. */
export interface SeriesGeometry {
  readonly grid: GridGeometry;
  readonly slices: readonly DicomSliceReference[];
  readonly frameOfReferenceUID?: string;
}

export interface DicomSliceReference {
  readonly sopInstanceUID: string;
  readonly seriesInstanceUID?: string;
  readonly imagePositionPatient: Vec3;
}

/**
 * The diagnostic codes this package emits. `Diagnostic.code` (from rt-geometry-js) is a
 * plain `string` — this union is the rtstruct-specific vocabulary layered on top, kept
 * exported for callers that want to switch over it exhaustively.
 */
export type DiagnosticCode =
  | "DUPLICATE_PLANE_POSITION"
  | "CONTOUR_PLANE_DISTANCE"
  | "NESTED_CLOSED_PLANAR_INTERPRETED"
  | "MISSING_RT_ROI_OBSERVATIONS"
  | "MISSING_CONTOUR_IMAGE_SEQUENCE"
  | "SOP_REFERENCE_UNRESOLVED"
  | "SOP_REFERENCE_PLANE_MISMATCH"
  | "EMPTY_ROI"
  | "SLICE_ORDER_REVERSED"
  | "FRAME_OF_REFERENCE_MISMATCH"
  | "UNSUPPORTED_CONTOUR_GEOMETRY";

export type Strictness = "strict" | "warn" | "silent";

export interface DicomVolumeResult {
  readonly value: number;
  readonly unit: "cm3";
  readonly source: "DICOM ROI Volume (3006,002C)";
}

/**
 * How each of an ROI's fillable contours was matched to a grid plane. `provenance.
 * sliceAssociation` is `"sop-reference"` only when *every* contour resolved via its
 * `ContourImageSequence` SOP reference; any geometric fallback makes it
 * `"geometric-fallback"`, and this breakdown says how many of each.
 */
export interface SliceAssociationDetail {
  readonly totalContours: number;
  /** matched to a plane by a resolved `ReferencedSOPInstanceUID` */
  readonly sopReferenced: number;
  /** matched by nearest-plane geometry (no SOP ref, or none supplied to compare against) */
  readonly geometricFallback: number;
  /** carried a SOP reference that did not resolve to any supplied slice — counted in
   *  `geometricFallback` as well, and each raised a `SOP_REFERENCE_UNRESOLVED` diagnostic */
  readonly unresolvedSopReferences: number;
}

export interface RoiHandle {
  readonly name: string;
  readonly roiNumber: number;
  readonly interpretedType?: string;
  readonly provenance: Provenance;
  /** Convenience mirror of `provenance.sliceAssociation`. */
  readonly sliceAssociation: SliceAssociation;
  readonly sliceAssociationDetail: SliceAssociationDetail;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParserLimits {
  maxContourPoints: number;
  maxVoxels: number;
}

export interface LoadOptions {
  strictness?: Strictness;
  tolerance?: Partial<GridTolerance>;
  limits?: Partial<ParserLimits>;
}
