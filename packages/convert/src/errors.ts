/** Base for every error `rt-convert-js` throws directly. Errors from the underlying
 *  packages (`RangeError` for an unknown ROI, `AmbiguousRoiNameError` for a duplicate ROI
 *  name, `GridMismatchError`, …) propagate unwrapped. */
export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A `FRACTIONAL` segmentation was passed to `segToRtstruct` without `options.threshold`.
 * RTSTRUCT has no way to represent a per-voxel probability/occupancy value, so the cut
 * from a fractional field to a binary contour set must be chosen explicitly — there is no
 * safe default (`docs/CONVERSION.md`). The chosen threshold is recorded in the returned
 * provenance.
 */
export class MissingThresholdError extends ConversionError {}

/** `segToRtstruct` was asked for a segment number the SEG does not declare. */
export class SegmentNotFoundError extends ConversionError {}
