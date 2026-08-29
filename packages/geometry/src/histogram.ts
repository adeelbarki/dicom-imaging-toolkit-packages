import { GridMismatchError } from "./errors.js";
import type { ScalarField3D } from "./scalar-field.js";
import type { GridTolerance, Mask3D } from "./types.js";

/**
 * A scalar field restricted to a mask, bucketed by value. A dose-volume histogram is
 * exactly this — histogram a dose `ScalarField3D` over an ROI `Mask3D`. Swap dose for
 * FRACTIONAL-SEG probability and the identical structure is a confidence histogram. One
 * algorithm, reused by rtdose-js and dicom-seg-js; built here so it exists once.
 *
 * Every bin `i` covers the half-open value interval `[binEdges[i], binEdges[i + 1])`,
 * except the last, which is closed on both ends so the maximum value lands somewhere.
 */
export interface Histogram {
  /** Length `bins + 1`, ascending. */
  readonly binEdges: readonly number[];
  /** Occupied-voxel count per bin. Length `bins`. */
  readonly counts: readonly number[];
  /** Physical volume (mm³) per bin — voxels weighted by the territory they represent on an
   *  irregularly spaced grid, not merely counted. Length `bins`. */
  readonly volumesMm3: readonly number[];
  readonly totalVolumeMm3: number;
  /** The value range the bins span (either supplied via options or measured over the mask). */
  readonly min: number;
  readonly max: number;
}

export interface HistogramOptions {
  /** Number of equal-width bins. Must be a positive integer. */
  bins: number;
  /** Lower edge of the first bin. Default: the minimum field value over the mask. */
  min?: number;
  /** Upper edge of the last bin. Default: the maximum field value over the mask. */
  max?: number;
  /** Passed to `GridGeometry.equals` when checking the field and mask share a grid. */
  tolerance?: GridTolerance;
}

interface Sample {
  readonly value: number;
  readonly volumeMm3: number;
}

function assertSameGrid(field: ScalarField3D, mask: Mask3D, tolerance: GridTolerance | undefined): void {
  if (!field.geometry.equals(mask.geometry, tolerance)) {
    throw new GridMismatchError(
      "scalar field and mask are not on equivalent grids (dimensions, spacing, orientation, " +
        "plane positions, or frame of reference differ) — a voxel-by-voxel histogram is not " +
        "meaningful across different grids. Resample one onto the other first.",
    );
  }
}

/** Every occupied voxel of `mask`, paired with the field value and physical volume there. */
function collectSamples(field: ScalarField3D, mask: Mask3D, tolerance: GridTolerance | undefined): Sample[] {
  assertSameGrid(field, mask, tolerance);
  const grid = mask.geometry;
  const columns = grid.columns;
  const rows = grid.rows;
  const areaMm2 = grid.pixelSpacing[0] * grid.pixelSpacing[1];
  const samples: Sample[] = [];
  for (let k = 0; k < grid.planes.length; k++) {
    const voxelVolumeMm3 = areaMm2 * grid.planeThicknessMm(k);
    const maskSlice = mask.getSliceBuffer(k);
    const fieldSlice = field.getSliceBuffer(k);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const i = row * columns + column;
        if (maskSlice[i] !== 0) {
          samples.push({ value: fieldSlice[i] as number, volumeMm3: voxelVolumeMm3 });
        }
      }
    }
  }
  return samples;
}

function totalVolume(samples: readonly Sample[]): number {
  let total = 0;
  for (const s of samples) total += s.volumeMm3;
  return total;
}

/**
 * Buckets `field` over `mask` into `opts.bins` equal-width bins spanning `[min, max]`
 * (defaults measured over the mask). Values outside an explicit `[min, max]` are clamped
 * into the edge bins rather than dropped, so `totalVolumeMm3` always equals the full masked
 * volume. Throws `GridMismatchError` unless the field and mask share a grid.
 */
export function histogram(field: ScalarField3D, mask: Mask3D, opts: HistogramOptions): Histogram {
  if (!Number.isInteger(opts.bins) || opts.bins <= 0) {
    throw new RangeError(`bins must be a positive integer, got ${opts.bins}`);
  }
  const samples = collectSamples(field, mask, opts.tolerance);

  let min = opts.min;
  let max = opts.max;
  if (min === undefined || max === undefined) {
    if (samples.length === 0) {
      throw new RangeError(
        "cannot infer a histogram range from an empty mask — pass explicit min and max",
      );
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of samples) {
      if (s.value < lo) lo = s.value;
      if (s.value > hi) hi = s.value;
    }
    min ??= lo;
    max ??= hi;
  }
  if (!(Number.isFinite(min) && Number.isFinite(max)) || max < min) {
    throw new RangeError(`invalid histogram range [${min}, ${max}]`);
  }

  const bins = opts.bins;
  const span = max - min;
  const binEdges = Array.from({ length: bins + 1 }, (_, i) => min + (span * i) / bins);
  const counts = new Array<number>(bins).fill(0);
  const volumesMm3 = new Array<number>(bins).fill(0);

  for (const s of samples) {
    let b = span === 0 ? 0 : Math.floor(((s.value - min) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b] = (counts[b] ?? 0) + 1;
    volumesMm3[b] = (volumesMm3[b] ?? 0) + s.volumeMm3;
  }

  return { binEdges, counts, volumesMm3, totalVolumeMm3: totalVolume(samples), min, max };
}

/**
 * Physical volume (mm³) of the masked region where `field >= threshold`. This is the DVH
 * "V(x)" query — e.g. `volumeAboveThreshold(dose, lung, 20)` is V20 in absolute volume.
 * Throws `GridMismatchError` unless the field and mask share a grid.
 */
export function volumeAboveThreshold(
  field: ScalarField3D,
  mask: Mask3D,
  threshold: number,
  tolerance?: GridTolerance,
): number {
  let volume = 0;
  for (const s of collectSamples(field, mask, tolerance)) {
    if (s.value >= threshold) volume += s.volumeMm3;
  }
  return volume;
}

/**
 * The value `d` such that a `fraction` of the masked volume has `field >= d` — the DVH
 * "D(x)" query. `valueAtVolumeFraction(dose, ptv, 0.95)` is D95. `fraction` is in [0, 1];
 * 0 returns the maximum value present, 1 the minimum. Throws `GridMismatchError` unless the
 * field and mask share a grid, and `RangeError` for an empty mask or an out-of-range
 * fraction.
 */
export function valueAtVolumeFraction(
  field: ScalarField3D,
  mask: Mask3D,
  fraction: number,
  tolerance?: GridTolerance,
): number {
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new RangeError(`fraction must be in [0, 1], got ${fraction}`);
  }
  const samples = collectSamples(field, mask, tolerance);
  if (samples.length === 0) {
    throw new RangeError("cannot compute a dose-at-volume for an empty mask");
  }
  samples.sort((a, b) => b.value - a.value);
  const target = fraction * totalVolume(samples);

  let cumulative = 0;
  let last = samples[0]!.value;
  for (const s of samples) {
    cumulative += s.volumeMm3;
    last = s.value;
    if (cumulative >= target) return s.value;
  }
  return last;
}

/**
 * Volume-weighted mean of `field` over `mask` — `Σ(vᵢ·xᵢ) / Σvᵢ`, so irregular plane
 * spacing is handled. For a FRACTIONAL DICOM SEG confidence field this is the mean
 * confidence inside a segment (dicom-seg-js's `meanConfidence`); for a dose field it is the
 * mean dose. Throws `GridMismatchError` unless the field and mask share a grid, and
 * `RangeError` for a mask with no occupied voxels.
 */
export function meanValue(field: ScalarField3D, mask: Mask3D, tolerance?: GridTolerance): number {
  const samples = collectSamples(field, mask, tolerance);
  if (samples.length === 0) {
    throw new RangeError("cannot compute a mean over a mask with no occupied voxels");
  }
  let weighted = 0;
  let volume = 0;
  for (const s of samples) {
    weighted += s.value * s.volumeMm3;
    volume += s.volumeMm3;
  }
  return weighted / volume;
}

export interface ThresholdSensitivityPoint {
  readonly threshold: number;
  /** Masked volume (mm³) where `field >= threshold`. */
  readonly volumeMm3: number;
  /** `volumeMm3` divided by the total masked volume, in [0, 1]. */
  readonly volumeFraction: number;
}

/**
 * How the above-threshold volume moves as the threshold moves — `volumeAboveThreshold`
 * evaluated across `thresholds` in one pass over the masked voxels. For a FRACTIONAL SEG
 * this answers "how much does the segmented volume depend on where the confidence cut is
 * placed?": a nearly flat curve means the choice barely matters, a steep one means it
 * dominates the result. Points are returned ascending by threshold. Throws
 * `GridMismatchError` unless the field and mask share a grid, and `RangeError` for an empty
 * `thresholds` list or a mask with no occupied voxels.
 */
export function thresholdSensitivity(
  field: ScalarField3D,
  mask: Mask3D,
  thresholds: readonly number[],
  tolerance?: GridTolerance,
): ThresholdSensitivityPoint[] {
  if (thresholds.length === 0) {
    throw new RangeError("thresholds must be a non-empty list");
  }
  const samples = collectSamples(field, mask, tolerance);
  if (samples.length === 0) {
    throw new RangeError("cannot compute threshold sensitivity over a mask with no occupied voxels");
  }
  const total = totalVolume(samples);
  return [...thresholds]
    .sort((a, b) => a - b)
    .map((threshold) => {
      let volume = 0;
      for (const s of samples) if (s.value >= threshold) volume += s.volumeMm3;
      return { threshold, volumeMm3: volume, volumeFraction: total > 0 ? volume / total : 0 };
    });
}
