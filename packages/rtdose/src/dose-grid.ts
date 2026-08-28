import {
  createScalarField,
  histogram,
  resampleField,
  sampleFieldAt,
  valueAtVolumeFraction,
  volumeAboveThreshold,
  type Diagnostic,
  type GridGeometry,
  type InterpMethod,
  type Mask3D,
  type ScalarField3D,
  type Vec3,
} from "rt-geometry-js";
import { readRTDose, type RTDoseParse } from "./dicom/port.js";
import type {
  CumulativeDvh,
  DoseAtVolume,
  DoseMethod,
  DoseQueryOptions,
  DoseSampleOptions,
  DoseStatistics,
  DvhOptions,
  DvhPoint,
  VolumeAtDose,
} from "./types.js";

const DEFAULT_INTERPOLATION: InterpMethod = "trilinear";
const DEFAULT_DVH_BINS = 256;

/**
 * A parsed RT Dose grid and the dose-volume queries over it.
 *
 * **Not a treatment planning system and not clinically validated.** D95 and V20 gate plan
 * approval in a TPS; the numbers here are for research and QA. Every metric carries its
 * `method` (roadmap §6.4) and `docs/DVH-METHOD.md` states the resampling, interpolation,
 * and partial-volume choices so a TPS disagreement is explicable.
 *
 * All mask-based queries resample the dose field **onto the structure mask's grid**
 * (roadmap §6.1 default — sample dose at structure voxel centres), trilinear by default,
 * then run `rt-geometry-js`'s histogram engine. The resample per `(maskGeometry, method)`
 * is memoised, so calling `statistics` / `calculateDVH` / `getD` / `getV` for one ROI
 * costs one resample, not four.
 */
export class DoseGrid {
  /** Dose grid geometry, planes ascending along the normal. */
  readonly geometry: GridGeometry;
  /** Dose per voxel in {@link units} ({@link doseGridScaling} already applied). */
  readonly field: ScalarField3D;
  /** `DoseUnits` (3004,0002), upper-cased — `"GY"`, `"RELATIVE"`, or `"UNKNOWN"`. */
  readonly units: string;
  /** `DoseType` (3004,0004) — `"PHYSICAL"`, `"EFFECTIVE"`, `"ERROR"`, or undefined. */
  readonly doseType: string | undefined;
  /** `DoseSummationType` (3004,000A) — `"PLAN"`, `"BEAM"`, `"FRACTION"`, … or undefined. */
  readonly doseSummationType: string | undefined;
  readonly doseGridScaling: number;
  readonly frameOfReferenceUID: string | undefined;
  /** Non-fatal issues found while parsing (units not Gy, reordered frames, …). */
  readonly diagnostics: readonly Diagnostic[];

  private readonly resampleCache = new WeakMap<GridGeometry, Map<InterpMethod, ScalarField3D>>();

  private constructor(parse: RTDoseParse) {
    this.geometry = parse.geometry;
    this.field = createScalarField(parse.geometry, parse.doseValues);
    this.units = parse.doseUnits;
    this.doseType = parse.doseType;
    this.doseSummationType = parse.doseSummationType;
    this.doseGridScaling = parse.doseGridScaling;
    this.frameOfReferenceUID = parse.frameOfReferenceUID;
    this.diagnostics = parse.diagnostics;
  }

  /** Parse one RTDOSE object's bytes. Throws `NotRTDoseError` / `MalformedDoseGridError`. */
  static fromDicom(bytes: ArrayBuffer): DoseGrid {
    return new DoseGrid(readRTDose(bytes));
  }

  /** Build directly from a pre-parsed grid (e.g. a non-DICOM source or a test). */
  static fromParsed(parse: RTDoseParse): DoseGrid {
    return new DoseGrid(parse);
  }

  /**
   * Interpolated dose at a physical point, in {@link units}. A point outside the dose grid
   * returns `0` — dose is taken to be zero beyond the stored extent. This is the raw dose
   * field, never resampled; the same call underlies a dose-under-cursor tooltip.
   */
  sample(point: Vec3, opts: DoseSampleOptions = {}): number {
    return sampleFieldAt(this.field, point, {
      method: opts.method ?? DEFAULT_INTERPOLATION,
      outOfBounds: 0,
    });
  }

  /** Min / max / volume-weighted mean dose over `mask`. Throws `RangeError` if `mask` is empty. */
  statistics(mask: Mask3D, opts: DoseQueryOptions = {}): DoseStatistics {
    const method = opts.method ?? DEFAULT_INTERPOLATION;
    const s = this.samplesOver(mask, method);
    if (s.values.length === 0) {
      throw new RangeError("cannot compute dose statistics over a mask with no occupied voxels");
    }
    let min = Infinity;
    let max = -Infinity;
    let weighted = 0;
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i] as number;
      if (v < min) min = v;
      if (v > max) max = v;
      weighted += v * (s.volumes[i] as number);
    }
    return {
      minGy: min,
      maxGy: max,
      meanGy: weighted / s.totalVolumeMm3,
      volumeMm3: s.totalVolumeMm3,
      voxelCount: s.values.length,
      method: this.methodInfo(method, s.resampled),
    };
  }

  /**
   * Cumulative dose-volume histogram over `mask`: `bins` equal-width dose bins over
   * `[0, maxDose]`, each point giving the structure volume receiving at least that dose.
   * Throws `RangeError` on an empty mask or non-positive `bins`.
   */
  calculateDVH(mask: Mask3D, opts: DvhOptions = {}): CumulativeDvh {
    const method = opts.method ?? DEFAULT_INTERPOLATION;
    const bins = opts.bins ?? DEFAULT_DVH_BINS;
    if (!Number.isInteger(bins) || bins <= 0) {
      throw new RangeError(`bins must be a positive integer, got ${bins}`);
    }
    const { field, resampled } = this.fieldOn(mask.geometry, method);
    const s = this.samplesOver(mask, method);
    if (s.values.length === 0) {
      throw new RangeError("cannot compute a DVH over a mask with no occupied voxels");
    }

    let maxDose = 0;
    let weighted = 0;
    for (let i = 0; i < s.values.length; i++) {
      const v = s.values[i] as number;
      if (v > maxDose) maxDose = v;
      weighted += v * (s.volumes[i] as number);
    }

    const h = histogram(field, mask, { bins, min: 0, max: maxDose > 0 ? maxDose : 1 });
    const suffix = new Array<number>(bins + 1).fill(0);
    for (let i = bins - 1; i >= 0; i--) suffix[i] = (suffix[i + 1] as number) + (h.volumesMm3[i] ?? 0);
    const total = s.totalVolumeMm3;

    const points: DvhPoint[] = [];
    for (let i = 0; i <= bins; i++) {
      const volumeMm3 = suffix[i] as number;
      points.push({
        doseGy: h.binEdges[i] as number,
        volumeMm3,
        volumeFraction: total > 0 ? volumeMm3 / total : 0,
      });
    }

    return {
      kind: "cumulative",
      structureVolumeMm3: total,
      maxDoseGy: maxDose,
      meanDoseGy: weighted / total,
      bins,
      points,
      method: this.methodInfo(method, resampled),
    };
  }

  /**
   * `Dx%` — the dose covering `percent`% of the structure volume. `getD(95, ptv)` is D95.
   * `percent` is in [0, 100]; `0` gives the max dose in the mask, `100` the min. Throws
   * `RangeError` for an empty mask or out-of-range `percent`.
   */
  getD(percent: number, mask: Mask3D, opts: DoseQueryOptions = {}): DoseAtVolume {
    if (!(percent >= 0 && percent <= 100)) {
      throw new RangeError(`percent must be in [0, 100], got ${percent}`);
    }
    const method = opts.method ?? DEFAULT_INTERPOLATION;
    const { field, resampled } = this.fieldOn(mask.geometry, method);
    const fraction = percent / 100;
    return {
      doseGy: valueAtVolumeFraction(field, mask, fraction),
      volumeFraction: fraction,
      method: this.methodInfo(method, resampled),
    };
  }

  /**
   * `V(d)` — the structure volume receiving at least `doseGy`. `getV(20, lung)` is V20.
   * Returns absolute volume and the fraction of the structure. Throws `RangeError` for an
   * empty mask.
   */
  getV(doseGy: number, mask: Mask3D, opts: DoseQueryOptions = {}): VolumeAtDose {
    const method = opts.method ?? DEFAULT_INTERPOLATION;
    const { field, resampled } = this.fieldOn(mask.geometry, method);
    const totalMm3 = mask.volume({ method: "voxel" }).valueMm3;
    if (totalMm3 <= 0) {
      throw new RangeError("cannot compute a volume-at-dose for a mask with no occupied voxels");
    }
    const volumeMm3 = volumeAboveThreshold(field, mask, doseGy);
    return {
      doseGy,
      volumeMm3,
      volumeFraction: volumeMm3 / totalMm3,
      method: this.methodInfo(method, resampled),
    };
  }

  // -- internals ------------------------------------------------------------

  private methodInfo(interpolation: InterpMethod, resampled: boolean): DoseMethod {
    return {
      resampling: "dose-sampled-at-structure-voxel-centres",
      interpolation,
      volumePolicy: "whole-voxel-binary",
      resampledToMaskGrid: resampled,
    };
  }

  /**
   * The dose field on `target`'s grid: the field itself when the grids already coincide,
   * otherwise a memoised resample. Propagates `FrameOfReferenceMismatchError` when the two
   * grids declare different frames of reference.
   */
  private fieldOn(target: GridGeometry, method: InterpMethod): { field: ScalarField3D; resampled: boolean } {
    if (this.geometry.equals(target)) return { field: this.field, resampled: false };
    let byMethod = this.resampleCache.get(target);
    if (!byMethod) {
      byMethod = new Map();
      this.resampleCache.set(target, byMethod);
    }
    let resampledField = byMethod.get(method);
    if (!resampledField) {
      resampledField = resampleField(this.field, target, { method, outOfBounds: 0 });
      byMethod.set(method, resampledField);
    }
    return { field: resampledField, resampled: true };
  }

  /** Every occupied voxel of `mask`, paired with its dose value and physical volume. */
  private samplesOver(
    mask: Mask3D,
    method: InterpMethod,
  ): { field: ScalarField3D; resampled: boolean; values: number[]; volumes: number[]; totalVolumeMm3: number } {
    const { field, resampled } = this.fieldOn(mask.geometry, method);
    const g = mask.geometry;
    const areaMm2 = g.pixelSpacing[0] * g.pixelSpacing[1];
    const values: number[] = [];
    const volumes: number[] = [];
    let totalVolumeMm3 = 0;
    for (let k = 0; k < g.planes.length; k++) {
      const voxelVolumeMm3 = areaMm2 * g.planeThicknessMm(k);
      const maskSlice = mask.getSliceBuffer(k);
      const fieldSlice = field.getSliceBuffer(k);
      for (let i = 0; i < maskSlice.length; i++) {
        if (maskSlice[i] !== 0) {
          values.push(fieldSlice[i] as number);
          volumes.push(voxelVolumeMm3);
          totalVolumeMm3 += voxelVolumeMm3;
        }
      }
    }
    return { field, resampled, values, volumes, totalVolumeMm3 };
  }
}
