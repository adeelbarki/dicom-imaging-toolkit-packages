/**
 * RTSTRUCT-specific errors. Geometry-core errors (ResourceLimitError,
 * NonParallelPlanesError, NonOrthogonalBasisError, IndeterminateVolumeError,
 * GridMismatchError, IndeterminateCentroidError, FrameOfReferenceMismatchError,
 * NotImplementedError) live in rt-geometry-js and are re-exported from this package's
 * entry point, so `import { ResourceLimitError } from "rtstruct-js"` keeps working.
 */

/** CLOSEDPLANAR_XOR cannot be mixed with other geometric types in one ROI. */
export class XorHomogeneityError extends Error {
  constructor(message: string) {
    super(`XorHomogeneityError (XOR): ${message}`);
    this.name = "XorHomogeneityError";
  }
}

/** All instances in a series must share rows/columns/pixelSpacing/orientation — the grid model has one value each, not per-plane. */
export class InconsistentSeriesError extends Error {
  constructor(message: string) {
    super(`InconsistentSeriesError: ${message}`);
    this.name = "InconsistentSeriesError";
  }
}

/** A contour cannot be a well-formed (x,y,z) point sequence: either the raw ContourData
 *  isn't a multiple of 3 (would silently drop trailing coordinates if chunked anyway), or
 *  it has fewer points than its geometricType can meaningfully represent (e.g. a
 *  CLOSED_PLANAR contour with 0-2 points, which can never rasterize to anything but a
 *  meaningless or empty fill). Both are rejected before reaching rasterization. */
export class MalformedContourError extends Error {
  constructor(message: string) {
    super(`MalformedContourError: ${message}`);
    this.name = "MalformedContourError";
  }
}

/**
 * A boundary trace in vectorize() failed to return to its own starting point. Unlike
 * malformed external DICOM input, this is our own internally-consistent Mask3D buffer —
 * for a proper binary raster, exposed voxel boundaries always form closed cycles, so this
 * means an algorithm bug, not unusual-but-valid data. Fail loudly, don't silently emit an
 * open path mislabeled as CLOSED_PLANAR.
 */
export class UnclosedContourError extends Error {
  constructor(message: string) {
    super(`UnclosedContourError: ${message}`);
    this.name = "UnclosedContourError";
  }
}

/**
 * ROIName is a label, not an identifier — ROINumber is (PS3.3 Type 1, required, unique).
 * Two ROIs are legally allowed to share a name. Looking one up by name when more than one
 * ROI has it is ambiguous; silently returning "whichever was loaded last" would be the same
 * silent-data-loss shape as the bug this error exists to prevent. Callers with duplicate
 * names must disambiguate via ROINumber (RTStruct.roi(number)) or use findROIsByName().
 */
export class AmbiguousRoiNameError extends Error {
  constructor(message: string) {
    super(`AmbiguousRoiNameError: ${message}`);
    this.name = "AmbiguousRoiNameError";
  }
}
