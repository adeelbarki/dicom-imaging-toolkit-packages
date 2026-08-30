import type { InterpMethod } from "rt-geometry-js";

/**
 * How a dose number was produced. Attached to every metric return, the same discipline
 * `rt-geometry-js`'s `volume({ method })` follows: a physicist WILL compare these numbers
 * against a treatment planning system, and a disagreement is only explicable if the method
 * travels with the value. See `docs/DVH-METHOD.md`.
 */
export interface DoseMethod {
  /**
   * Where the dose was sampled. `"dose-sampled-at-structure-voxel-centres"` (default) —
   * the dose field is resampled onto the mask's grid, one value per structure voxel.
   * `"dose-sampled-at-structure-subvoxel-centres"` — with `volumePolicy: "supersample"`,
   * each structure voxel is split `supersampling`³ ways and the dose sampled at every
   * sub-voxel centre.
   */
  readonly resampling:
    | "dose-sampled-at-structure-voxel-centres"
    | "dose-sampled-at-structure-subvoxel-centres";
  /** Interpolation used when sampling the dose field. `"trilinear"` unless overridden. */
  readonly interpolation: InterpMethod;
  /**
   * `"whole-voxel-binary"` (default) — a structure voxel counts fully or not at all.
   * `"supersampled"` — each voxel was split into `supersampling`³ sub-voxels, each
   * carrying `1/supersampling³` of the voxel volume and its own dose sample; this tracks a
   * steep dose gradient across a voxel and moves D95/V20 on small structures (see
   * `docs/DVH-METHOD.md`). Neither recovers sub-voxel *boundary* coverage — the mask is
   * already binary.
   */
  readonly volumePolicy: "whole-voxel-binary" | "supersampled";
  /** The `k` in `k³` sub-voxels, present only when `volumePolicy` is `"supersampled"`. */
  readonly supersampling?: number;
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

export interface DoseQueryOptions {
  /** Interpolation for the dose sample. Default `"trilinear"`. */
  method?: InterpMethod;
  /**
   * `"whole-voxel-binary"` (default) — one dose sample per structure voxel.
   * `"supersample"` — split each voxel `supersampling`³ ways (default `2`) and sample the
   * dose at every sub-voxel centre. Slower (≈ `k³`×) but tracks a steep gradient across a
   * voxel; matters most for small structures. Recorded on the returned `method`.
   */
  volumePolicy?: "whole-voxel-binary" | "supersample";
  /** The `k` for `"supersample"`. Integer in `[2, 4]`. Default `2`. */
  supersampling?: number;
}

export interface DvhOptions extends DoseQueryOptions {
  /** Equal-width dose bins spanning `[0, maxDose]`. Default `256`. */
  bins?: number;
}

export interface DoseSampleOptions {
  /** Default `"trilinear"`. `"nearest"` returns the containing voxel's value. */
  method?: InterpMethod;
}
