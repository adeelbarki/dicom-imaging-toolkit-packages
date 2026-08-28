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

/**
 * dice()/voxelDisagreement() and histogram()/volumeAboveThreshold()/valueAtVolumeFraction()
 * compare or index two structures voxel-by-voxel — that's only meaningful if both live on
 * the same GridGeometry (same dimensions, spacing, orientation, plane positions, frame of
 * reference). Two structures with identical array dimensions can still represent physically
 * different voxel grids (e.g. different pixel spacing), so "same dimensions" is not a
 * substitute for checking equals().
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
 * Two coordinate spaces that declare different frame-of-reference UIDs are not physically
 * comparable — any numeric agreement between coordinates would be coincidental. Raised by
 * cross-mask metrics (centroidDisplacementMm) and, under `strictness: "strict"`, by
 * rtstruct-js's RTStruct.load when an ROI's referenced FoR disagrees with the supplied grid.
 */
export class FrameOfReferenceMismatchError extends Error {
  constructor(message: string) {
    super(`FrameOfReferenceMismatchError: ${message}`);
    this.name = "FrameOfReferenceMismatchError";
  }
}
