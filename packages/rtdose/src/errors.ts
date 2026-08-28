/**
 * RTDOSE-specific errors. Geometry-core errors (ResourceLimitError, GridMismatchError,
 * FrameOfReferenceMismatchError, IndeterminateVolumeError, …) live in rt-geometry-js and
 * are re-exported from this package's entry point, so
 * `import { GridMismatchError } from "rtdose-js"` works.
 */

/**
 * The supplied bytes are not an RT Dose object. `SOPClassUID` (0008,0016) is present and
 * is not the RT Dose Storage UID, and `Modality` (0008,0060) is not `"RTDOSE"`. Parsing a
 * CT/MR/RTSTRUCT as a dose grid would misread its pixel data as dose values.
 */
export class NotRTDoseError extends Error {
  constructor(message: string) {
    super(`NotRTDoseError: ${message}`);
    this.name = "NotRTDoseError";
  }
}

/**
 * The dose grid cannot be assembled from the file: a Type 1 element is missing
 * (Rows/Columns/PixelSpacing/ImageOrientationPatient/ImagePositionPatient), the
 * `GridFrameOffsetVector` (3004,000C) length disagrees with `NumberOfFrames`, or the
 * decoded `PixelData` length is not `frames × rows × columns`. Unlike a soft diagnostic,
 * there is no partial grid worth returning.
 */
export class MalformedDoseGridError extends Error {
  constructor(message: string) {
    super(`MalformedDoseGridError: ${message}`);
    this.name = "MalformedDoseGridError";
  }
}
