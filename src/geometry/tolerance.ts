import type { GridTolerance } from "../types.js";

/**
 * Provisional (IMPLEMENTATION_PLAN.md section 8): re-derive from real
 * multi-vendor data before v0.1 ships. Loose enough to absorb float noise
 * from DICOM decimal-string round-tripping, tight enough that a genuine
 * multi-mm plane offset still fails equality.
 */
export const DEFAULT_TOLERANCE: GridTolerance = {
  positionMm: 0.5,
  spacingMm: 0.01,
  directionAngleRad: 1e-3,
};
