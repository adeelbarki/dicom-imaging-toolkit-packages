export class NotImplementedError extends Error {
  constructor(message: string) {
    super(`NotImplementedError: ${message}`);
    this.name = "NotImplementedError";
  }
}

/** v0.1 grid constraint: plane positions must vary only along a shared normal. */
export class NonParallelPlanesError extends Error {
  constructor(message: string) {
    super(`NonParallelPlanesError: ${message}`);
    this.name = "NonParallelPlanesError";
  }
}

/** Thrown before allocation, never after — see SEC-01. */
export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(`ResourceLimitError: ${message}`);
    this.name = "ResourceLimitError";
  }
}

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

/** Thrown only under LoadOptions.strictness "strict" — see RTStruct.load. */
export class FrameOfReferenceMismatchError extends Error {
  constructor(message: string) {
    super(`FrameOfReferenceMismatchError: ${message}`);
    this.name = "FrameOfReferenceMismatchError";
  }
}

/**
 * rowDirection/columnDirection must be orthogonal — patientToPixel()'s inverse of
 * indexToPatient() is only exact when they are (the cross term vanishes only if
 * dot(row, column) = 0). Non-orthogonal input still "works" without throwing anywhere
 * else, it just silently returns the wrong pixel coordinates.
 */
export class NonOrthogonalBasisError extends Error {
  constructor(message: string) {
    super(`NonOrthogonalBasisError: ${message}`);
    this.name = "NonOrthogonalBasisError";
  }
}

/**
 * A single-plane grid has no second plane to measure slice spacing from, so voxel volume
 * is not derivable from geometry alone — not "zero," genuinely unknown.
 */
export class IndeterminateVolumeError extends Error {
  constructor(message: string) {
    super(`IndeterminateVolumeError: ${message}`);
    this.name = "IndeterminateVolumeError";
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
 * dice()/voxelDisagreement() compare two masks index-by-index — that's only meaningful if
 * both live on the same GridGeometry (same dimensions, spacing, orientation, plane
 * positions, frame of reference). Two masks with identical array dimensions can still
 * represent physically different voxel grids (e.g. different pixel spacing), so "same
 * dimensions" is not a substitute for checking equals().
 */
export class GridMismatchError extends Error {
  constructor(message: string) {
    super(`GridMismatchError: ${message}`);
    this.name = "GridMismatchError";
  }
}

/** A mask with zero occupied voxels has no centroid — [0,0,0] would be a fabricated patient
 *  coordinate, indistinguishable from a real ROI centered at the origin. */
export class IndeterminateCentroidError extends Error {
  constructor(message: string) {
    super(`IndeterminateCentroidError: ${message}`);
    this.name = "IndeterminateCentroidError";
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
