/**
 * dicom-seg-js — DICOM Segmentation (SEG) reading, built on rt-geometry-js.
 *
 * 0.1.0: BINARY masks and FRACTIONAL probability/occupancy fields. LABELMAP (PS3.3
 * Sup 243) is planned for 0.2.0. Writing arrives in a later PR.
 *
 * FRACTIONAL values are per-voxel model confidence, not accuracy — see
 * `docs/FRACTIONAL-SEG.md`. This library exposes honest quantities only
 * (`meanValue` / `volumeAboveThreshold` / `thresholdSensitivity` from rt-geometry-js) and
 * never an "accuracy" or "% correct" number.
 *
 * The whole rt-geometry-js surface (GridGeometry, Mask3D, ScalarField3D, resampling,
 * histogram/metrics, geometry errors) is re-exported so a caller can go straight from a
 * segment to a resample or a histogram from one import.
 */
import {
  createScalarField,
  maskFromDense,
  sampleFieldAt,
  type Diagnostic,
  type GridGeometry,
  type InterpMethod,
  type Mask3D,
  type ScalarField3D,
  type Vec3,
} from "rt-geometry-js";
import { binaryFrame, fractionalFrame, readSegDataset, type ParsedSeg } from "./dicom/port.js";
import { SegmentationTypeMismatchError } from "./errors.js";
import type { FractionalType, SegmentInfo, SegmentationType, SegmentsOverlap } from "./types.js";

export * from "rt-geometry-js";
export * from "./types.js";
export * from "./errors.js";

// Write a conformant SEG from a Mask3D per BINARY segment / a ScalarField3D per FRACTIONAL
// segment. The low-level frame encoder (encodeSegFrames) stays internal.
export { writeSeg } from "./dicom/port.js";
export type { WriteSegOptions, WriteSegSegment } from "./dicom/port.js";

/**
 * A parsed DICOM Segmentation and the per-segment masks / fields over it.
 *
 * BINARY → `mask(n)`; FRACTIONAL → `field(n)` (rescaled to 0..1) and `rawField(n)` (the
 * stored integers). The two are not interchangeable — calling the wrong one throws
 * {@link SegmentationTypeMismatchError} rather than guessing a threshold (roadmap §7.1).
 */
export class Segmentation {
  readonly type: SegmentationType;
  /** FRACTIONAL only — PROBABILITY vs OCCUPANCY, or undefined if the SEG didn't declare it. */
  readonly fractionalType: FractionalType | undefined;
  /** FRACTIONAL only — the stored value that means 1.0 (usually 255). */
  readonly maximumFractionalValue: number | undefined;
  readonly segmentsOverlap: SegmentsOverlap;
  /** The SEG's own sampling grid, built from the Per-Frame / Shared Functional Groups.
   *  Not required to match any source image series — resample to cross grids. */
  readonly geometry: GridGeometry;
  readonly frameOfReferenceUID: string | undefined;
  readonly contentLabel: string | undefined;
  readonly diagnostics: readonly Diagnostic[];

  private readonly parsed: ParsedSeg;
  private readonly maskCache = new Map<number, Mask3D>();
  private readonly fieldCache = new Map<number, ScalarField3D>();
  private readonly rawFieldCache = new Map<number, ScalarField3D>();

  private constructor(parsed: ParsedSeg) {
    this.parsed = parsed;
    this.type = parsed.segmentationType;
    this.fractionalType = parsed.fractionalType;
    this.maximumFractionalValue = parsed.maximumFractionalValue;
    this.segmentsOverlap = parsed.segmentsOverlap;
    this.geometry = parsed.geometry;
    this.frameOfReferenceUID = parsed.frameOfReferenceUID;
    this.contentLabel = parsed.contentLabel;
    this.diagnostics = parsed.diagnostics;
  }

  static fromDicom(bytes: ArrayBuffer): Segmentation {
    return new Segmentation(readSegDataset(bytes));
  }

  /** Every segment, in `SegmentSequence` order. */
  segments(): readonly SegmentInfo[] {
    return this.parsed.segments;
  }

  hasSegment(segmentNumber: number): boolean {
    return this.parsed.segments.some((s) => s.number === segmentNumber);
  }

  private assertSegment(segmentNumber: number): void {
    if (!this.hasSegment(segmentNumber)) {
      throw new RangeError(
        `no segment with SegmentNumber ${segmentNumber} (present: ${this.parsed.segments.map((s) => s.number).join(", ")})`,
      );
    }
  }

  private get sliceSize(): number {
    return this.parsed.rows * this.parsed.columns;
  }

  /**
   * The boolean mask for a **BINARY** segment. Throws {@link SegmentationTypeMismatchError}
   * on a FRACTIONAL SEG — threshold `field(n)` yourself, there is no safe default cut.
   */
  mask(segmentNumber: number): Mask3D {
    this.assertSegment(segmentNumber);
    if (this.type !== "BINARY") {
      throw new SegmentationTypeMismatchError(
        `mask() is for BINARY segmentations; this is FRACTIONAL — use field(${segmentNumber}) and apply your own threshold`,
      );
    }
    const cached = this.maskCache.get(segmentNumber);
    if (cached) return cached;

    const rc = this.sliceSize;
    const data = new Uint8Array(this.parsed.geometry.planes.length * rc);
    for (const fr of this.parsed.frames) {
      if (fr.segmentNumber !== segmentNumber) continue;
      const bits = binaryFrame(this.parsed, fr.frameIndex);
      const base = fr.planeIndex * rc;
      for (let i = 0; i < rc; i++) if (bits[i]) data[base + i] = 1;
    }
    const mask = maskFromDense(this.parsed.geometry, data);
    this.maskCache.set(segmentNumber, mask);
    return mask;
  }

  /**
   * The confidence/occupancy field for a **FRACTIONAL** segment, rescaled to `[0, 1]` by
   * `MaximumFractionalValue`. Throws {@link SegmentationTypeMismatchError} on a BINARY SEG
   * — use `mask(n)`.
   */
  field(segmentNumber: number): ScalarField3D {
    return this.fractionalField(segmentNumber, true, this.fieldCache);
  }

  /** The raw stored integers (0..`maximumFractionalValue`) for a FRACTIONAL segment, unscaled. */
  rawField(segmentNumber: number): ScalarField3D {
    return this.fractionalField(segmentNumber, false, this.rawFieldCache);
  }

  private fractionalField(segmentNumber: number, rescale: boolean, cache: Map<number, ScalarField3D>): ScalarField3D {
    this.assertSegment(segmentNumber);
    if (this.type !== "FRACTIONAL") {
      throw new SegmentationTypeMismatchError(
        `field() is for FRACTIONAL segmentations; this is BINARY — use mask(${segmentNumber})`,
      );
    }
    const cached = cache.get(segmentNumber);
    if (cached) return cached;

    const rc = this.sliceSize;
    const buffer = new Float32Array(this.parsed.geometry.planes.length * rc);
    const divisor = rescale ? (this.maximumFractionalValue ?? 255) : 1;
    for (const fr of this.parsed.frames) {
      if (fr.segmentNumber !== segmentNumber) continue;
      const bytes = fractionalFrame(this.parsed, fr.frameIndex);
      const base = fr.planeIndex * rc;
      for (let i = 0; i < rc; i++) buffer[base + i] = (bytes[i] as number) / divisor;
    }
    const field = createScalarField(this.parsed.geometry, buffer);
    cache.set(segmentNumber, field);
    return field;
  }

  /**
   * The footprint of a segment as a `Mask3D`: for BINARY, the mask itself; for FRACTIONAL,
   * the voxels with a non-zero stored value. Handy as the `mask` argument to
   * `meanValue` / `volumeAboveThreshold` / `thresholdSensitivity` — "confidence over the
   * region the model marked at all".
   */
  support(segmentNumber: number): Mask3D {
    if (this.type === "BINARY") return this.mask(segmentNumber);
    const raw = this.rawField(segmentNumber);
    const [columns, rows, planes] = raw.dimensions;
    const data = new Uint8Array(columns * rows * planes);
    for (let k = 0; k < planes; k++) {
      const slice = raw.getSliceBuffer(k);
      const base = k * columns * rows;
      for (let i = 0; i < slice.length; i++) if ((slice[i] as number) > 0) data[base + i] = 1;
    }
    return maskFromDense(this.geometry, data);
  }

  /**
   * Interpolated confidence at a physical point for a FRACTIONAL segment (0 outside the
   * grid). The confidence-under-cursor tooltip from §7.3 — the same call as
   * `dose.sample()` against a different field. Trilinear by default.
   */
  sampleConfidence(segmentNumber: number, point: Vec3, opts: { method?: InterpMethod } = {}): number {
    return sampleFieldAt(this.field(segmentNumber), point, {
      method: opts.method ?? "trilinear",
      outOfBounds: 0,
    });
  }
}

/** Parse one DICOM SEG object's bytes. Throws `NotSegmentationError` /
 *  `MalformedSegmentationError` / `UnsupportedSegmentationTypeError`. */
export function readSeg(bytes: ArrayBuffer): Segmentation {
  return Segmentation.fromDicom(bytes);
}

export type { ParsedSeg } from "./dicom/port.js";
