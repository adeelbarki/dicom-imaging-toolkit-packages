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
