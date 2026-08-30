/**
 * `SegmentationType` (0062,0001).
 *
 * - `BINARY` — 1 bit per pixel, one frame per (segment, plane).
 * - `FRACTIONAL` — 8 bits per pixel, `0..MaximumFractionalValue`, one frame per
 *   (segment, plane). {@link FractionalType} says whether the value is a probability or an
 *   occupancy.
 * - `LABELMAP` (PS3.3 Sup 243) — one frame per **plane**, each pixel an integer equal to
 *   the `SegmentNumber` it belongs to (`0` = background). A partition: a voxel has at most
 *   one label. `seg.mask(n)` returns the voxels whose label is `n`; there is no
 *   `seg.field()`.
 */
export type SegmentationType = "BINARY" | "FRACTIONAL" | "LABELMAP";

/**
 * `SegmentationFractionalType` (0062,0010). PROBABILITY = "the probability that the
 * segmented property occupies the voxel"; OCCUPANCY = "the fraction of the voxel volume
 * the property occupies". A stored 0.5 means very different things under each — never
 * assume one (roadmap §7.1). Undefined when the SEG did not declare it.
 */
export type FractionalType = "PROBABILITY" | "OCCUPANCY";

/** `SegmentsOverlap` (0062,0013) — whether segments may share voxels. */
export type SegmentsOverlap = "YES" | "NO" | "UNDEFINED";

/** A DICOM coded concept — `CodeValue` + `CodingSchemeDesignator` + `CodeMeaning`. */
export interface CodedConcept {
  readonly value: string;
  readonly scheme: string;
  readonly meaning: string;
}

/** One entry of `SegmentSequence` (0062,0002). */
export interface SegmentInfo {
  /** `SegmentNumber` (0062,0004) — 1-based, unique within the SEG. The key for `mask()` / `field()`. */
  readonly number: number;
  /** `SegmentLabel` (0062,0005). */
  readonly label: string;
  /** `SegmentAlgorithmType` (0062,0008) — `AUTOMATIC` | `SEMIAUTOMATIC` | `MANUAL`. */
  readonly algorithmType: string;
  /** `SegmentAlgorithmName` (0062,0009), when present. */
  readonly algorithmName: string | undefined;
  /** `SegmentedPropertyCategoryCodeSequence` (0062,0003) — e.g. Tissue, Anatomical Structure. */
  readonly category: CodedConcept | undefined;
  /** `SegmentedPropertyTypeCodeSequence` (0062,000F) — e.g. Liver, Tumor. */
  readonly propertyType: CodedConcept | undefined;
  /** `SegmentedPropertyTypeModifierCodeSequence` (0062,0011), when present — e.g. Left. */
  readonly propertyTypeModifier: CodedConcept | undefined;
  /** `TrackingID` (0062,0020) / `TrackingUID` (0062,0021), when present. */
  readonly trackingId: string | undefined;
  readonly trackingUid: string | undefined;
  /** Number of frames actually stored for this segment (sparse SEGs omit all-empty frames). */
  readonly frameCount: number;
}
