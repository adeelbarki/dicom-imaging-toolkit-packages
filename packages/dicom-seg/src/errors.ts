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
 * `SegmentationType` (0062,0001) is `LABELMAP`. dicom-seg-js 0.1.0 reads `BINARY` and
 * `FRACTIONAL` only; LABELMAP (PS3.3 Supplement 243) support is planned for 0.2.0.
 */
export class UnsupportedSegmentationTypeError extends Error {
  constructor(message: string) {
    super(`UnsupportedSegmentationTypeError: ${message}`);
    this.name = "UnsupportedSegmentationTypeError";
  }
}

/**
 * `mask()` was called on a FRACTIONAL segmentation, or `field()` on a BINARY one. The two
 * are not interchangeable and there is no safe default threshold to turn a probability
 * field into a mask (roadmap §7.1) — the caller must pick one explicitly.
 */
export class SegmentationTypeMismatchError extends Error {
  constructor(message: string) {
    super(`SegmentationTypeMismatchError: ${message}`);
    this.name = "SegmentationTypeMismatchError";
  }
}
