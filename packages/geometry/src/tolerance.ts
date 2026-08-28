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
 * Re-derived against real data (2026-08, roadmap v2 Phase B step 4;
 * `rtstruct-js/scripts/validation/tolerance-derivation.ts`, findings in
 * `rtstruct-js/VALIDATION.md`). Across 7 de-identified series from 5+ acquisition
 * origins (Elekta MR 1.5mm, Plastimatch/LCTSC CT 2-3mm, MIM CT 3.27mm, Varian CT 5mm,
 * TCIA NSCLC CT 3mm), the measured noise these tolerances must absorb was **exactly
 * zero** on every axis: per-slice `PixelSpacing` and `ImageOrientationPatient` are
 * bit-identical within each series, every series' slice origins sit perfectly on the
 * normal (0mm off-axis), and a read -> `number` -> DS re-encode -> re-parse round trip
 * shifts no coordinate (vendor DS precision tops out at 6 fractional digits, lossless
 * through a JS `number`). So the values below are far above the real noise floor and
 * nothing in real multi-vendor data comes close to them. They are kept as-is: a
 * deliberate margin for the one case this dataset can't probe — the same physical
 * geometry reconstructed by two independent software pipelines (e.g. an RTSTRUCT's
 * referenced-FoR grid vs. the CT it was drawn on). Revisit if such a paired dataset
 * appears; `positionMm` is the loosest and the first candidate to tighten.
 */
export const DEFAULT_TOLERANCE: GridTolerance = {
  positionMm: 0.5,
  spacingMm: 0.01,
  directionAngleRad: 1e-3,
};
