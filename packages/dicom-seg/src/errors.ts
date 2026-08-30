/**
 * dicom-seg-js-specific errors. Geometry-core errors (ResourceLimitError,
 * GridMismatchError, NonParallelPlanesError, …) live in rt-geometry-js and are re-exported
 * from this package's entry point.
 */

/**
 * The supplied bytes are not a DICOM Segmentation. `SOPClassUID` (0008,0016) is present and
 * is not Segmentation Storage (`1.2.840.10008.5.1.4.1.1.66.4`), and `Modality` (0008,0060)
 * is not `"SEG"`.
 */
export class NotSegmentationError extends Error {
  constructor(message: string) {
    super(`NotSegmentationError: ${message}`);
    this.name = "NotSegmentationError";
  }
}

/**
 * The segmentation cannot be assembled: a required element is missing
 * (`SegmentSequence`, the shared `PixelMeasuresSequence` / `PlaneOrientationSequence`,
 * `Rows`/`Columns`), the per-frame functional-group count disagrees with `NumberOfFrames`,
 * a frame references an undeclared `SegmentNumber`, or the decoded `PixelData` is too
 * short for the frame count.
 */
export class MalformedSegmentationError extends Error {
  constructor(message: string) {
    super(`MalformedSegmentationError: ${message}`);
    this.name = "MalformedSegmentationError";
  }
}

/**
 * `SegmentationType` (0062,0001) is a value dicom-seg-js does not handle. As of 0.2.0
 * `BINARY`, `FRACTIONAL`, and `LABELMAP` (PS3.3 Supplement 243) are all supported, so this
 * is now raised only for an unknown/vendor value.
 */
export class UnsupportedSegmentationTypeError extends Error {
  constructor(message: string) {
    super(`UnsupportedSegmentationTypeError: ${message}`);
    this.name = "UnsupportedSegmentationTypeError";
  }
}

/**
 * A `writeSeg({ segmentationType: "LABELMAP" })` call was given segments whose masks
 * overlap. LABELMAP is a partition — each pixel stores exactly one `SegmentNumber` — so
 * overlapping input cannot be represented. Use `BINARY` (with `SegmentsOverlap`) instead.
 */
export class LabelmapOverlapError extends Error {
  constructor(message: string) {
    super(`LabelmapOverlapError: ${message}`);
    this.name = "LabelmapOverlapError";
  }
}

/**
 * `mask()` was called on a FRACTIONAL segmentation, `field()` on a BINARY or LABELMAP one,
 * or `field()` on LABELMAP. The forms are not interchangeable and there is no safe default
 * threshold to turn a probability field into a mask (roadmap §7.1) — the caller must pick
 * one explicitly.
 */
export class SegmentationTypeMismatchError extends Error {
  constructor(message: string) {
    super(`SegmentationTypeMismatchError: ${message}`);
    this.name = "SegmentationTypeMismatchError";
  }
}
