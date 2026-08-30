import {
  add,
  createScalarField,
  FrameOfReferenceMismatchError,
  histogram,
  resampleField,
  sampleFieldAt,
  scale,
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
const DEFAULT_SUPERSAMPLING = 2;

/** `k` for `volumePolicy: "supersample"`, validated. `undefined` for the whole-voxel path. */
function resolveSupersampling(opts: DoseQueryOptions): number | undefined {
  if (opts.volumePolicy !== "supersample") return undefined;
  const k = opts.supersampling ?? DEFAULT_SUPERSAMPLING;
  if (!Number.isInteger(k) || k < 2 || k > 4) {
    throw new RangeError(`supersampling must be an integer in [2, 4], got ${k}`);
  }
  return k;
}

/** `V(d)` over pre-collected samples — total volume with `value >= threshold`. */
function vAtDose(values: readonly number[], volumes: readonly number[], threshold: number): number {
  let volume = 0;
  for (let i = 0; i < values.length; i++) {
    if ((values[i] as number) >= threshold) volume += volumes[i] as number;
  }
  return volume;
}

/**
 * `D(x)` over pre-collected samples — mirrors `rt-geometry-js`'s `valueAtVolumeFraction`
 * (sort by value descending, accumulate volume, return the value where the running total
 * first reaches `fraction` of the whole). Step function, no interpolation.
 */
function dAtVolumeFraction(values: readonly number[], volumes: readonly number[], fraction: number): number {
  const order = values.map((_, i) => i).sort((a, b) => (values[b] as number) - (values[a] as number));
  let total = 0;
  for (const v of volumes) total += v;
  const target = fraction * total;
  let cumulative = 0;
  let last = values[order[0] as number] as number;
  for (const i of order) {
    cumulative += volumes[i] as number;
    last = values[i] as number;
    if (cumulative >= target) return last;
  }
  return last;
}

/** Cumulative DVH points from pre-collected samples — same bin layout as `histogram()`. */
function dvhFromSamples(
  values: readonly number[],
  volumes: readonly number[],
  bins: number,
  maxDose: number,
  totalVolumeMm3: number,
): DvhPoint[] {
  const max = maxDose > 0 ? maxDose : 1;
  const width = max / bins;
  const perBin = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    let b = Math.floor((values[i] as number) / width);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    perBin[b] = (perBin[b] as number) + (volumes[i] as number);
  }
  const suffix = new Array<number>(bins + 1).fill(0);
  for (let i = bins - 1; i >= 0; i--) suffix[i] = (suffix[i + 1] as number) + (perBin[i] as number);

  const points: DvhPoint[] = [];
  for (let i = 0; i <= bins; i++) {
    const volumeMm3 = suffix[i] as number;
    points.push({
      doseGy: i * width,
      volumeMm3,
      volumeFraction: totalVolumeMm3 > 0 ? volumeMm3 / totalVolumeMm3 : 0,
    });
  }
  return points;
}

/**
 * A parsed RT Dose grid and the dose-volume queries over it.
 *
 * **Not a treatment planning system and not clinically validated.** D95 and V20 gate plan
 * approval in a TPS; the numbers here are for research and QA. Every metric carries its
 * `method` (roadmap §6.4) and `docs/DVH-METHOD.md` states the resampling, interpolation,
 * and partial-volume choices so a TPS disagreement is explicable.
 *
 * By default every mask-based query resamples the dose field **onto the structure mask's
 * grid** (roadmap §6.1 default — sample dose at structure voxel centres), trilinear by
 * default, then runs `rt-geometry-js`'s histogram engine; the resample per
 * `(maskGeometry, method)` is memoised. Passing `volumePolicy: "supersample"` instead
 * splits each structure voxel `k³` ways and samples the raw dose field at every sub-voxel
 * centre — no resample, `k³`× the sampling work, and it moves D95/V20 on small structures
 * sitting in a steep gradient (see `docs/DVH-METHOD.md`).
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
    const k = resolveSupersampling(opts);
    const s = this.samplesOver(mask, method, k);
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
      voxelCount: s.voxelCount,
      method: this.methodInfo(method, s.resampled, k),
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
    const k = resolveSupersampling(opts);
    const s = this.samplesOver(mask, method, k);
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
    const total = s.totalVolumeMm3;

    let points: DvhPoint[];
    if (k === undefined) {
      // Whole-voxel path: byte-identical to pre-0.2.0 — histogram the resampled field.
      const { field } = this.fieldOn(mask.geometry, method);
      const h = histogram(field, mask, { bins, min: 0, max: maxDose > 0 ? maxDose : 1 });
      const suffix = new Array<number>(bins + 1).fill(0);
      for (let i = bins - 1; i >= 0; i--) suffix[i] = (suffix[i + 1] as number) + (h.volumesMm3[i] ?? 0);
      points = [];
      for (let i = 0; i <= bins; i++) {
        const volumeMm3 = suffix[i] as number;
        points.push({
          doseGy: h.binEdges[i] as number,
          volumeMm3,
          volumeFraction: total > 0 ? volumeMm3 / total : 0,
        });
      }
    } else {
      points = dvhFromSamples(s.values, s.volumes, bins, maxDose, total);
    }

    return {
      kind: "cumulative",
      structureVolumeMm3: total,
      maxDoseGy: maxDose,
      meanDoseGy: weighted / total,
      bins,
      points,
      method: this.methodInfo(method, s.resampled, k),
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
    const fraction = percent / 100;
    const k = resolveSupersampling(opts);

    let doseGy: number;
    let resampled: boolean;
    if (k === undefined) {
      const on = this.fieldOn(mask.geometry, method);
      doseGy = valueAtVolumeFraction(on.field, mask, fraction);
      resampled = on.resampled;
    } else {
      const s = this.samplesOver(mask, method, k);
      if (s.values.length === 0) {
        throw new RangeError("cannot compute a dose-at-volume for a mask with no occupied voxels");
      }
      doseGy = dAtVolumeFraction(s.values, s.volumes, fraction);
      resampled = s.resampled;
    }
    return { doseGy, volumeFraction: fraction, method: this.methodInfo(method, resampled, k) };
  }

  /**
   * `V(d)` — the structure volume receiving at least `doseGy`. `getV(20, lung)` is V20.
   * Returns absolute volume and the fraction of the structure. Throws `RangeError` for an
   * empty mask.
   */
  getV(doseGy: number, mask: Mask3D, opts: DoseQueryOptions = {}): VolumeAtDose {
    const method = opts.method ?? DEFAULT_INTERPOLATION;
    const k = resolveSupersampling(opts);

    let volumeMm3: number;
    let totalMm3: number;
    let resampled: boolean;
    if (k === undefined) {
      const on = this.fieldOn(mask.geometry, method);
      totalMm3 = mask.volume({ method: "voxel" }).valueMm3;
      if (totalMm3 <= 0) {
        throw new RangeError("cannot compute a volume-at-dose for a mask with no occupied voxels");
      }
      volumeMm3 = volumeAboveThreshold(on.field, mask, doseGy);
      resampled = on.resampled;
    } else {
      const s = this.samplesOver(mask, method, k);
      if (s.values.length === 0) {
        throw new RangeError("cannot compute a volume-at-dose for a mask with no occupied voxels");
      }
      totalMm3 = s.totalVolumeMm3;
      volumeMm3 = vAtDose(s.values, s.volumes, doseGy);
      resampled = s.resampled;
    }
    return {
      doseGy,
      volumeMm3,
      volumeFraction: volumeMm3 / totalMm3,
      method: this.methodInfo(method, resampled, k),
    };
  }

  // -- internals ------------------------------------------------------------

  private methodInfo(interpolation: InterpMethod, resampled: boolean, k?: number): DoseMethod {
    if (k === undefined) {
      return {
        resampling: "dose-sampled-at-structure-voxel-centres",
        interpolation,
        volumePolicy: "whole-voxel-binary",
        resampledToMaskGrid: resampled,
      };
    }
    return {
      resampling: "dose-sampled-at-structure-subvoxel-centres",
      interpolation,
      volumePolicy: "supersampled",
      supersampling: k,
      resampledToMaskGrid: false,
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

  /**
   * Every occupied voxel of `mask`, paired with its dose value(s) and physical volume(s).
   *
   * `k` undefined — one sample per voxel, the dose field resampled onto the mask grid.
   * `k` set — `k³` sub-voxel samples per voxel, each `voxelVolume / k³`, the raw dose field
   * point-sampled at every sub-voxel centre (no resample; `resampled` is always `false`).
   * A cross-frame-of-reference mask throws `FrameOfReferenceMismatchError`, matching the
   * whole-voxel path (which throws it via `resampleField`).
   */
  private samplesOver(
    mask: Mask3D,
    method: InterpMethod,
    k?: number,
  ): {
    resampled: boolean;
    values: number[];
    volumes: number[];
    totalVolumeMm3: number;
    voxelCount: number;
  } {
    const g = mask.geometry;
    const areaMm2 = g.pixelSpacing[0] * g.pixelSpacing[1];
    const values: number[] = [];
    const volumes: number[] = [];
    let totalVolumeMm3 = 0;
    let voxelCount = 0;

    if (k === undefined) {
      const { field, resampled } = this.fieldOn(g, method);
      for (let plane = 0; plane < g.planes.length; plane++) {
        const voxelVolumeMm3 = areaMm2 * g.planeThicknessMm(plane);
        const maskSlice = mask.getSliceBuffer(plane);
        const fieldSlice = field.getSliceBuffer(plane);
        for (let i = 0; i < maskSlice.length; i++) {
          if (maskSlice[i] !== 0) {
            values.push(fieldSlice[i] as number);
            volumes.push(voxelVolumeMm3);
            totalVolumeMm3 += voxelVolumeMm3;
            voxelCount++;
          }
        }
      }
      return { resampled, values, volumes, totalVolumeMm3, voxelCount };
    }

    // Supersample: sample the raw dose field at k³ sub-voxel centres.
    const fa = this.geometry.frameOfReferenceUID;
    const fb = g.frameOfReferenceUID;
    if (fa !== undefined && fb !== undefined && fa !== fb) {
      throw new FrameOfReferenceMismatchError(
        `cannot supersample dose from frame of reference "${fa}" into structure frame "${fb}" — ` +
          "the coordinate systems are not physically comparable",
      );
    }
    const rowDir = g.rowDirection;
    const colDir = g.columnDirection;
    const normal = g.normal();
    const psCol = g.pixelSpacing[1]; // step per column, along rowDirection
    const psRow = g.pixelSpacing[0]; // step per row, along columnDirection
    const columns = g.columns;
    const rows = g.rows;
    const subVol = 1 / (k * k * k);
    // Fractional offsets of the k sub-centres within a unit voxel, in [-0.5, 0.5).
    const frac: number[] = [];
    for (let i = 0; i < k; i++) frac.push((i + 0.5) / k - 0.5);

    for (let plane = 0; plane < g.planes.length; plane++) {
      const thick = g.planeThicknessMm(plane);
      const voxelVolumeMm3 = areaMm2 * thick;
      const subVolumeMm3 = voxelVolumeMm3 * subVol;
      const maskSlice = mask.getSliceBuffer(plane);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if (maskSlice[row * columns + column] === 0) continue;
          voxelCount++;
          const centre = g.indexToPatient(column, row, plane);
          for (const dz of frac) {
            for (const dy of frac) {
              for (const dx of frac) {
                let p: Vec3 = add(centre, scale(rowDir, dx * psCol));
                p = add(p, scale(colDir, dy * psRow));
                p = add(p, scale(normal, dz * thick));
                values.push(sampleFieldAt(this.field, p, { method, outOfBounds: 0 }));
                volumes.push(subVolumeMm3);
                totalVolumeMm3 += subVolumeMm3;
              }
            }
          }
        }
      }
    }
    return { resampled: false, values, volumes, totalVolumeMm3, voxelCount };
  }
}
