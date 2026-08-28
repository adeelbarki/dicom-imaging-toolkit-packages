import type { InterpMethod } from "rt-geometry-js";

/**
 * How a dose number was produced. Attached to every metric return, the same discipline
 * `rt-geometry-js`'s `volume({ method })` follows: a physicist WILL compare these numbers
 * against a treatment planning system, and a disagreement is only explicable if the method
 * travels with the value. See `docs/DVH-METHOD.md`.
 */
export interface DoseMethod {
  /**
   * Which grid the voxel-by-voxel computation happened on. `rtdose-js` samples the dose
   * **at the structure's voxel centres** (roadmap §6.1 default) — the dose field is
   * resampled onto the mask's grid, never the reverse.
   */
  readonly resampling: "dose-sampled-at-structure-voxel-centres";
  /** Interpolation used when resampling the dose field. `"trilinear"` unless overridden. */
  readonly interpolation: InterpMethod;
  /**
   * A structure voxel counts fully or not at all — no fractional edge coverage
   * (roadmap §6.3). Supersampling is deferred to a later minor.
   */
  readonly volumePolicy: "whole-voxel-binary";
  /**
   * `false` when the dose grid already coincided with the mask's grid (no resample was
   * needed); `true` when the dose field was resampled onto the mask.
   */
  readonly resampledToMaskGrid: boolean;
}

/** Min / max / volume-weighted mean dose over a structure mask, plus how it was computed. */
export interface DoseStatistics {
  readonly minGy: number;
  readonly maxGy: number;
  /** Volume-weighted: `Σ(vᵢ·dᵢ) / Σvᵢ`, so irregular slice spacing is handled. */
  readonly meanGy: number;
  readonly volumeMm3: number;
  readonly voxelCount: number;
  readonly method: DoseMethod;
}

export interface DvhPoint {
  readonly doseGy: number;
  /** Structure volume (mm³) receiving **at least** `doseGy`. */
  readonly volumeMm3: number;
  /** `volumeMm3 / structureVolumeMm3`, in [0, 1]. */
  readonly volumeFraction: number;
}

/**
 * A cumulative dose-volume histogram: `points` ascend in dose, and each point's volume is
 * the structure volume receiving at least that dose (so the curve is non-increasing).
 * `points[0].doseGy` is `0`; `points[bins].doseGy` is the max dose, with volume `0`.
 */
export interface CumulativeDvh {
  readonly kind: "cumulative";
  readonly structureVolumeMm3: number;
  readonly maxDoseGy: number;
  readonly meanDoseGy: number;
  readonly bins: number;
  readonly points: readonly DvhPoint[];
  readonly method: DoseMethod;
}

/** Result of `getD(percent, mask)` — the dose covering `percent`% of the structure. */
export interface DoseAtVolume {
  readonly doseGy: number;
  /** The `x` in `Dx%`, as a fraction in [0, 1]. */
  readonly volumeFraction: number;
  readonly method: DoseMethod;
}

/** Result of `getV(doseGy, mask)` — the structure volume at or above `doseGy`. */
export interface VolumeAtDose {
  readonly doseGy: number;
  readonly volumeMm3: number;
  /** `volumeMm3 / structureVolumeMm3`, in [0, 1]. */
  readonly volumeFraction: number;
  readonly method: DoseMethod;
}

export interface DvhOptions {
  /** Equal-width dose bins spanning `[0, maxDose]`. Default `256`. */
  bins?: number;
  /** Interpolation for the dose→structure resample. Default `"trilinear"`. */
  method?: InterpMethod;
}

export interface DoseQueryOptions {
  /** Interpolation for the dose→structure resample. Default `"trilinear"`. */
  method?: InterpMethod;
}

export interface DoseSampleOptions {
  /** Default `"trilinear"`. `"nearest"` returns the containing voxel's value. */
  method?: InterpMethod;
}
