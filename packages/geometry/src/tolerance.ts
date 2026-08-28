import type { GridTolerance } from "./types.js";

/**
 * Default noise tolerance for deciding whether two already-built things are the same,
 * within measurement/round-trip noise rather than exact bit equality. That's the one job
 * every field here does — `GridGeometry.equals()` (are these two grids the same geometry)
 * and `readSeriesGeometry`'s instance-consistency check (do these DICOM instances belong
 * to the same series) are the only two consumers. It is deliberately NOT used for
 * construction-time input validation (duplicate-plane detection, off-axis/parallelism
 * rejection, row/column orthogonality) — those each answer a different question at a
 * different scale and use their own dedicated constants near where they're checked.
 *
 * - `positionMm` (0.5mm): how far apart can two corresponding plane positions be and
 *   still count as the same slice position. Loose enough to absorb float noise from
 *   DICOM DS round-tripping, tight enough that a genuine multi-mm offset still fails.
 * - `spacingMm` (0.01mm): same idea for `pixelSpacing`, tighter because pixel spacing is
 *   usually specified to more decimal places than plane position in practice.
 * - `directionAngleRad` (1e-3 rad, ~0.057°): angular tolerance for comparing
 *   `rowDirection`/`columnDirection` between two instances — angle, not a linear delta,
 *   per GEO-05.
 *
 * These are initial values, not yet re-derived from real multi-vendor DICOM (no vendor
 * files exist in this repo — see the phantom-only correctness philosophy in the README).
 * Revisit once real interoperability testing across vendors is possible.
 */
export const DEFAULT_TOLERANCE: GridTolerance = {
  positionMm: 0.5,
  spacingMm: 0.01,
  directionAngleRad: 1e-3,
};
