import { createRequire } from "node:module";
import {
  createDiagnostic,
  createGridGeometry,
  cross,
  DEFAULT_TOLERANCE,
  dot,
  normalize,
  sub,
  GridMismatchError,
  type Diagnostic,
  type GridGeometry,
  type GridTolerance,
  type Mask3D,
  type ScalarField3D,
  type Vec3,
} from "rt-geometry-js";
import {
  MalformedSegmentationError,
  NotSegmentationError,
  UnsupportedSegmentationTypeError,
} from "../errors.js";
import type { CodedConcept, FractionalType, SegmentInfo, SegmentationType, SegmentsOverlap } from "../types.js";

// THE ONLY dcmjs importer in dicom-seg-js — mirrors rtstruct-js / rtdose-js port.ts.
// dcmjs's ESM build is CJS-with-export-syntax and trips Node's resolver; require() hits
// the genuinely-CJS condition instead.
const dcmjs = createRequire(import.meta.url)("dcmjs");
const { DicomMessage, DicomMetaDictionary, DicomDict, BitArray } = dcmjs.data;

const SEG_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.66.4";
const TRANSFER_SYNTAX_UID = "1.2.840.10008.1.2.1"; // Explicit VR Little Endian
const TAG_PIXEL_DATA = "7FE00010";

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range (length ${arr.length})`);
  return value;
}

function naturalize(bytes: ArrayBuffer): Record<string, unknown> {
  const dicomData = DicomMessage.readFile(bytes);
  return DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<string, unknown>;
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
}

function asNumberArray(value: unknown): number[] | undefined {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "number") return [value];
  if (typeof value === "string") {
    return value.split("\\").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return undefined;
}

function readCode(seq: unknown): CodedConcept | undefined {
  const item = asArray(seq)[0];
  if (!item) return undefined;
  const value = item["CodeValue"] as string | undefined;
  const scheme = item["CodingSchemeDesignator"] as string | undefined;
  const meaning = item["CodeMeaning"] as string | undefined;
  if (value === undefined && meaning === undefined) return undefined;
  return { value: value ?? "", scheme: scheme ?? "", meaning: meaning ?? "" };
}

export interface FrameRef {
  readonly segmentNumber: number;
  readonly planeIndex: number;
  /** Position of this frame in the PixelData frame stream. */
  readonly frameIndex: number;
}

export interface ParsedSeg {
  readonly segmentationType: SegmentationType;
  readonly fractionalType: FractionalType | undefined;
  readonly maximumFractionalValue: number | undefined;
  readonly segmentsOverlap: SegmentsOverlap;
  readonly geometry: GridGeometry;
  readonly frameOfReferenceUID: string | undefined;
  readonly contentLabel: string | undefined;
  readonly rows: number;
  readonly columns: number;
  readonly numberOfFrames: number;
  readonly segments: readonly SegmentInfo[];
  readonly frames: readonly FrameRef[];
  /** Raw PixelData bytes (bit-packed for BINARY, one byte per pixel for FRACTIONAL). */
  readonly pixelData: Uint8Array;
  /** True when BINARY frames are individually padded to a byte boundary rather than
   *  packed as one continuous bitstream (a non-conformant but real variant). */
  readonly binaryFramesByteAligned: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** Parse one SEG object's bytes. Throws NotSegmentationError / MalformedSegmentationError /
 *  UnsupportedSegmentationTypeError. */
export function readSegDataset(bytes: ArrayBuffer): ParsedSeg {
  const ds = naturalize(bytes);
  const diagnostics: Diagnostic[] = [];

  const sopClassUID = ds["SOPClassUID"] as string | undefined;
  const modality = ds["Modality"] as string | undefined;
  if (sopClassUID !== undefined && sopClassUID !== SEG_STORAGE_SOP_CLASS_UID && modality !== "SEG") {
    throw new NotSegmentationError(
      `SOPClassUID ${sopClassUID} is not Segmentation Storage (${SEG_STORAGE_SOP_CLASS_UID}) and Modality is ${modality ?? "absent"}`,
    );
  }

  const rawType = ((ds["SegmentationType"] as string | undefined) ?? "").toUpperCase();
  if (rawType === "LABELMAP") {
    throw new UnsupportedSegmentationTypeError(
      "LABELMAP segmentation (PS3.3 Sup 243) is not supported in dicom-seg-js 0.1.0 — planned for 0.2.0",
    );
  }
  if (rawType !== "BINARY" && rawType !== "FRACTIONAL") {
    throw new MalformedSegmentationError(`SegmentationType is ${JSON.stringify(rawType || "absent")}, expected BINARY or FRACTIONAL`);
  }
  const segmentationType = rawType as SegmentationType;

  const rows = ds["Rows"] as number | undefined;
  const columns = ds["Columns"] as number | undefined;
  const numberOfFrames = (ds["NumberOfFrames"] as number | undefined) ?? 0;
  if (!Number.isInteger(rows) || (rows as number) <= 0) throw new MalformedSegmentationError("missing or invalid Rows");
  if (!Number.isInteger(columns) || (columns as number) <= 0) throw new MalformedSegmentationError("missing or invalid Columns");
  if (!Number.isInteger(numberOfFrames) || numberOfFrames <= 0) {
    throw new MalformedSegmentationError(`missing or invalid NumberOfFrames (${numberOfFrames})`);
  }

  // --- shared functional groups: orientation + pixel spacing ---
  const shared = asArray(ds["SharedFunctionalGroupsSequence"])[0];
  const sharedOrientation = asNumberArray(asArray(shared?.["PlaneOrientationSequence"])[0]?.["ImageOrientationPatient"]);
  const pixelMeasures = asArray(shared?.["PixelMeasuresSequence"])[0];
  const pixelSpacing = asNumberArray(pixelMeasures?.["PixelSpacing"]);
  if (!sharedOrientation || sharedOrientation.length !== 6) {
    throw new MalformedSegmentationError("SharedFunctionalGroupsSequence is missing PlaneOrientationSequence/ImageOrientationPatient");
  }
  if (!pixelSpacing || pixelSpacing.length !== 2) {
    throw new MalformedSegmentationError("SharedFunctionalGroupsSequence is missing PixelMeasuresSequence/PixelSpacing");
  }
  const rowDirection: Vec3 = [at(sharedOrientation, 0), at(sharedOrientation, 1), at(sharedOrientation, 2)];
  const columnDirection: Vec3 = [at(sharedOrientation, 3), at(sharedOrientation, 4), at(sharedOrientation, 5)];
  const normal = normalize(cross(rowDirection, columnDirection));

  // --- per-frame functional groups ---
  const perFrame = asArray(ds["PerFrameFunctionalGroupsSequence"]);
  if (perFrame.length !== numberOfFrames) {
    throw new MalformedSegmentationError(
      `PerFrameFunctionalGroupsSequence has ${perFrame.length} items but NumberOfFrames is ${numberOfFrames}`,
    );
  }

  interface RawFrame {
    readonly segmentNumber: number;
    readonly position: Vec3;
    readonly frameIndex: number;
  }
  const rawFrames: RawFrame[] = perFrame.map((fg, frameIndex) => {
    const segId = asArray(fg["SegmentIdentificationSequence"])[0];
    const segmentNumber = Number(segId?.["ReferencedSegmentNumber"]);
    const ipp = asNumberArray(asArray(fg["PlanePositionSequence"])[0]?.["ImagePositionPatient"]);
    if (!Number.isInteger(segmentNumber) || segmentNumber <= 0) {
      throw new MalformedSegmentationError(`frame ${frameIndex}: missing SegmentIdentificationSequence/ReferencedSegmentNumber`);
    }
    if (!ipp || ipp.length !== 3) {
      throw new MalformedSegmentationError(`frame ${frameIndex}: missing PlanePositionSequence/ImagePositionPatient`);
    }
    const perFrameOrientation = asNumberArray(asArray(fg["PlaneOrientationSequence"])[0]?.["ImageOrientationPatient"]);
    if (perFrameOrientation && perFrameOrientation.some((v, i) => Math.abs(v - (sharedOrientation[i] as number)) > 1e-6)) {
      diagnostics.push(
        createDiagnostic("PER_FRAME_ORIENTATION_VARIES", "warning",
          `frame ${frameIndex} declares a PlaneOrientationSequence that differs from the shared one; the shared orientation is used`),
      );
    }
    return { segmentNumber, position: [at(ipp, 0), at(ipp, 1), at(ipp, 2)] as Vec3, frameIndex };
  });

  // --- segments ---
  const segSeq = asArray(ds["SegmentSequence"]);
  if (segSeq.length === 0) throw new MalformedSegmentationError("SegmentSequence is absent or empty");
  const declaredNumbers = new Set<number>();
  const framesBySegment = new Map<number, number>();
  for (const f of rawFrames) framesBySegment.set(f.segmentNumber, (framesBySegment.get(f.segmentNumber) ?? 0) + 1);
  const segments: SegmentInfo[] = segSeq.map((s) => {
    const number = Number(s["SegmentNumber"]);
    if (!Number.isInteger(number) || number <= 0) {
      throw new MalformedSegmentationError(`SegmentSequence item has an invalid SegmentNumber (${s["SegmentNumber"]})`);
    }
    declaredNumbers.add(number);
    return {
      number,
      label: (s["SegmentLabel"] as string | undefined) ?? "",
      algorithmType: (s["SegmentAlgorithmType"] as string | undefined) ?? "",
      algorithmName: (s["SegmentAlgorithmName"] as string | undefined) || undefined,
      category: readCode(s["SegmentedPropertyCategoryCodeSequence"]),
      propertyType: readCode(s["SegmentedPropertyTypeCodeSequence"]),
      propertyTypeModifier: readCode(s["SegmentedPropertyTypeModifierCodeSequence"]),
      trackingId: (s["TrackingID"] as string | undefined) || undefined,
      trackingUid: (s["TrackingUID"] as string | undefined) || undefined,
      frameCount: framesBySegment.get(number) ?? 0,
    };
  });
  for (const f of rawFrames) {
    if (!declaredNumbers.has(f.segmentNumber)) {
      throw new MalformedSegmentationError(
        `frame ${f.frameIndex} references SegmentNumber ${f.segmentNumber}, which has no SegmentSequence entry`,
      );
    }
  }

  // --- geometry: distinct plane positions across every frame ---
  const uniquePositions: Vec3[] = [];
  const tol = DEFAULT_TOLERANCE.positionMm;
  for (const f of rawFrames) {
    if (!uniquePositions.some((p) => Math.abs(dot(sub(p, f.position), normal)) <= tol
      && Math.hypot(...sub(p, f.position)) <= tol)) {
      uniquePositions.push(f.position);
    }
  }
  const geometry = createGridGeometry({
    rows: rows as number,
    columns: columns as number,
    rowDirection,
    columnDirection,
    pixelSpacing: [at(pixelSpacing, 0), at(pixelSpacing, 1)],
    planePositions: uniquePositions,
    frameOfReferenceUID: ds["FrameOfReferenceUID"] as string | undefined,
  });

  // map each frame's IPP -> the sorted plane index
  const planeProjections = geometry.planes.map((p) => dot(p.position, normal));
  const planeIndexOf = (position: Vec3): number => {
    const s = dot(position, normal);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < planeProjections.length; i++) {
      const d = Math.abs((planeProjections[i] as number) - s);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  };
  const frames: FrameRef[] = rawFrames.map((f) => ({
    segmentNumber: f.segmentNumber,
    planeIndex: planeIndexOf(f.position),
    frameIndex: f.frameIndex,
  }));

  // --- pixel data ---
  const pdBuffers = ds["PixelData"];
  const first = Array.isArray(pdBuffers) ? pdBuffers[0] : pdBuffers;
  if (!(first instanceof ArrayBuffer)) {
    throw new MalformedSegmentationError("PixelData (7FE0,0010) is absent or not decodable as raw bytes");
  }
  const pixelData = new Uint8Array(first);
  const rc = (rows as number) * (columns as number);

  let binaryFramesByteAligned = false;
  if (segmentationType === "BINARY") {
    const continuousBytes = Math.ceil((numberOfFrames * rc) / 8);
    const perFrameBytes = numberOfFrames * Math.ceil(rc / 8);
    if (pixelData.length >= continuousBytes) {
      binaryFramesByteAligned = false;
    } else if (pixelData.length >= perFrameBytes && perFrameBytes !== continuousBytes) {
      binaryFramesByteAligned = true;
      diagnostics.push(
        createDiagnostic("BINARY_FRAMES_BYTE_ALIGNED", "info",
          "BINARY frames are individually byte-padded rather than packed as one continuous bitstream"),
      );
    } else {
      throw new MalformedSegmentationError(
        `PixelData is ${pixelData.length} bytes; a BINARY SEG of ${numberOfFrames} frames × ${rc} px needs ${continuousBytes}`,
      );
    }
  } else {
    if (pixelData.length < numberOfFrames * rc) {
      throw new MalformedSegmentationError(
        `PixelData is ${pixelData.length} bytes; a FRACTIONAL SEG of ${numberOfFrames} frames × ${rc} px needs ${numberOfFrames * rc}`,
      );
    }
  }

  // --- fractional-specific ---
  let fractionalType: FractionalType | undefined;
  let maximumFractionalValue: number | undefined;
  if (segmentationType === "FRACTIONAL") {
    const rawFrac = ((ds["SegmentationFractionalType"] as string | undefined) ?? "").toUpperCase();
    if (rawFrac === "PROBABILITY" || rawFrac === "OCCUPANCY") {
      fractionalType = rawFrac;
    } else {
      diagnostics.push(
        createDiagnostic("FRACTIONAL_TYPE_ABSENT", "warning",
          "FRACTIONAL SEG did not declare SegmentationFractionalType (0062,0010); PROBABILITY vs OCCUPANCY is unknown"),
      );
    }
    const maxRaw = ds["MaximumFractionalValue"] as number | undefined;
    if (Number.isFinite(maxRaw) && (maxRaw as number) > 0) {
      maximumFractionalValue = maxRaw as number;
    } else {
      maximumFractionalValue = 255;
      diagnostics.push(
        createDiagnostic("MISSING_MAX_FRACTIONAL_VALUE", "warning",
          `MaximumFractionalValue (0062,000E) is ${maxRaw === undefined ? "absent" : `invalid (${maxRaw})`}; assuming 255`),
      );
    }
  }

  const segmentsOverlap = ((ds["SegmentsOverlap"] as string | undefined) ?? "UNDEFINED").toUpperCase() as SegmentsOverlap;
  if (segmentsOverlap === "YES") {
    diagnostics.push(
      createDiagnostic("SEGMENTS_OVERLAP", "info",
        "SegmentsOverlap is YES — segments may share voxels; do not assume a partition"),
    );
  }

  return {
    segmentationType,
    fractionalType,
    maximumFractionalValue,
    segmentsOverlap,
    geometry,
    frameOfReferenceUID: ds["FrameOfReferenceUID"] as string | undefined,
    contentLabel: (ds["ContentLabel"] as string | undefined) || undefined,
    rows: rows as number,
    columns: columns as number,
    numberOfFrames,
    segments,
    frames,
    pixelData,
    binaryFramesByteAligned,
    diagnostics,
  };
}

/** Unpacked 0/1 bits for BINARY frame `frameIndex` (length rows·columns). */
export function binaryFrame(parsed: ParsedSeg, frameIndex: number): Uint8Array {
  const rc = parsed.rows * parsed.columns;
  const out = new Uint8Array(rc);
  if (parsed.binaryFramesByteAligned) {
    const frameBytes = Math.ceil(rc / 8);
    const offset = frameIndex * frameBytes;
    const bits = BitArray.unpack(parsed.pixelData.subarray(offset, offset + frameBytes)) as Uint8Array;
    for (let i = 0; i < rc; i++) out[i] = bits[i] ? 1 : 0;
    return out;
  }
  // continuous bitstream: unpack the whole thing once per call is wasteful, but callers
  // (Segmentation.mask) unpack per segment, not per pixel — fine for v0.1.
  const allBits = BitArray.unpack(parsed.pixelData) as Uint8Array;
  const base = frameIndex * rc;
  for (let i = 0; i < rc; i++) out[i] = allBits[base + i] ? 1 : 0;
  return out;
}

/** Raw 8-bit values for FRACTIONAL frame `frameIndex` (length rows·columns). */
export function fractionalFrame(parsed: ParsedSeg, frameIndex: number): Uint8Array {
  const rc = parsed.rows * parsed.columns;
  const offset = frameIndex * rc;
  return parsed.pixelData.subarray(offset, offset + rc);
}

// ---------------------------------------------------------------------------
// Fixture builder. SEG files are BUILT for tests, never checked in (same rule
// as rtstruct-js / rtdose-js). Not re-exported from index.ts. PR 3 promotes a
// hardened public `writeSeg` (mask/field based) is defined below and
// delegates to this.
// ---------------------------------------------------------------------------

export interface EncodeSegSegment {
  readonly number: number;
  readonly label?: string;
  readonly algorithmType?: string;
  readonly algorithmName?: string;
  readonly category?: CodedConcept;
  readonly propertyType?: CodedConcept;
  readonly propertyTypeModifier?: CodedConcept;
  readonly trackingId?: string;
  readonly trackingUid?: string;
}

export interface WriteSegFrame {
  readonly segmentNumber: number;
  readonly position: Vec3;
  /** BINARY: 0/1 per pixel. FRACTIONAL: 0..maximumFractionalValue per pixel. Length rows·columns. */
  readonly pixels: ArrayLike<number>;
}

export interface EncodeSegOptions {
  readonly rows: number;
  readonly columns: number;
  readonly segmentationType: SegmentationType;
  readonly rowDirection?: Vec3;
  readonly columnDirection?: Vec3;
  readonly pixelSpacing?: readonly [number, number];
  readonly sliceThickness?: number;
  readonly frameOfReferenceUID?: string;
  readonly segmentsOverlap?: SegmentsOverlap;
  readonly fractionalType?: FractionalType;
  readonly maximumFractionalValue?: number;
  readonly segments: readonly EncodeSegSegment[];
  readonly frames: readonly WriteSegFrame[];
  /** Override to exercise NotSegmentationError. */
  readonly sopClassUID?: string;
  readonly modality?: string;
  /** Test-only: emit LABELMAP as the type. */
  readonly forceType?: string;
  /** Test-only: drop SegmentationFractionalType even for FRACTIONAL. */
  readonly omitFractionalType?: boolean;
  /** Test-only: drop MaximumFractionalValue even for FRACTIONAL. */
  readonly omitMaximumFractionalValue?: boolean;
}

export function encodeSegFrames(options: EncodeSegOptions): ArrayBuffer {
  const rows = options.rows;
  const columns = options.columns;
  const rc = rows * columns;
  const rowDirection = options.rowDirection ?? ([1, 0, 0] as Vec3);
  const columnDirection = options.columnDirection ?? ([0, 1, 0] as Vec3);
  const isBinary = options.segmentationType === "BINARY";

  const perFrameGroups = options.frames.map((f) => ({
    FrameContentSequence: [{ StackID: "1", InStackPositionNumber: 1, DimensionIndexValues: [f.segmentNumber, 1] }],
    PlanePositionSequence: [{ ImagePositionPatient: [...f.position] }],
    SegmentIdentificationSequence: [{ ReferencedSegmentNumber: f.segmentNumber }],
  }));

  let pixelBuffer: ArrayBuffer;
  if (isBinary) {
    const bits: number[] = [];
    for (const f of options.frames) for (let i = 0; i < rc; i++) bits.push(f.pixels[i] ? 1 : 0);
    pixelBuffer = (BitArray.pack(bits) as Uint8Array).buffer.slice(0) as ArrayBuffer;
  } else {
    const bytes = new Uint8Array(options.frames.length * rc);
    options.frames.forEach((f, fi) => {
      for (let i = 0; i < rc; i++) bytes[fi * rc + i] = Math.max(0, Math.min(255, Math.round(f.pixels[i] ?? 0)));
    });
    pixelBuffer = bytes.buffer.slice(0) as ArrayBuffer;
  }

  const dataset: Record<string, unknown> = {
    _meta: {},
    SOPClassUID: options.sopClassUID ?? SEG_STORAGE_SOP_CLASS_UID,
    SOPInstanceUID: DicomMetaDictionary.uid(),
    Modality: options.modality ?? "SEG",
    SamplesPerPixel: 1,
    PhotometricInterpretation: "MONOCHROME2",
    Rows: rows,
    Columns: columns,
    NumberOfFrames: options.frames.length,
    BitsAllocated: isBinary ? 1 : 8,
    BitsStored: isBinary ? 1 : 8,
    HighBit: isBinary ? 0 : 7,
    PixelRepresentation: 0,
    SegmentationType: options.forceType ?? options.segmentationType,
    SegmentsOverlap: options.segmentsOverlap ?? "NO",
    FrameOfReferenceUID: options.frameOfReferenceUID ?? DicomMetaDictionary.uid(),
    ContentLabel: "SEG",
    SegmentSequence: options.segments.map((s) => {
      const code = (c: CodedConcept) => ({
        CodeValue: c.value,
        CodingSchemeDesignator: c.scheme,
        CodeMeaning: c.meaning,
      });
      const item: Record<string, unknown> = {
        SegmentNumber: s.number,
        SegmentLabel: s.label ?? `segment-${s.number}`,
        SegmentAlgorithmType: s.algorithmType ?? "AUTOMATIC",
        SegmentAlgorithmName: s.algorithmName ?? "dicom-seg-js",
        SegmentedPropertyCategoryCodeSequence: [
          s.category ? code(s.category) : { CodeValue: "T-D0050", CodingSchemeDesignator: "SRT", CodeMeaning: "Tissue" },
        ],
        SegmentedPropertyTypeCodeSequence: [
          s.propertyType ? code(s.propertyType) : { CodeValue: "T-62000", CodingSchemeDesignator: "SRT", CodeMeaning: "Liver" },
        ],
      };
      if (s.propertyTypeModifier) item["SegmentedPropertyTypeModifierCodeSequence"] = [code(s.propertyTypeModifier)];
      if (s.trackingId !== undefined) item["TrackingID"] = s.trackingId;
      if (s.trackingUid !== undefined) item["TrackingUID"] = s.trackingUid;
      return item;
    }),
    SharedFunctionalGroupsSequence: [
      {
        PlaneOrientationSequence: [{ ImageOrientationPatient: [...rowDirection, ...columnDirection] }],
        PixelMeasuresSequence: [
          {
            PixelSpacing: [...(options.pixelSpacing ?? [1, 1])],
            SliceThickness: options.sliceThickness ?? 1,
            SpacingBetweenSlices: options.sliceThickness ?? 1,
          },
        ],
      },
    ],
    PerFrameFunctionalGroupsSequence: perFrameGroups,
  };

  if (!isBinary) {
    if (!options.omitFractionalType) dataset["SegmentationFractionalType"] = options.fractionalType ?? "PROBABILITY";
    if (!options.omitMaximumFractionalValue) dataset["MaximumFractionalValue"] = options.maximumFractionalValue ?? 255;
  }

  const meta = {
    MediaStorageSOPClassUID: dataset["SOPClassUID"],
    MediaStorageSOPInstanceUID: dataset["SOPInstanceUID"],
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: "dicom-seg-js",
    TransferSyntaxUID: TRANSFER_SYNTAX_UID,
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset) as Record<string, unknown>;
  dicomDict.dict[TAG_PIXEL_DATA] = { vr: "OB", Value: [pixelBuffer] };

  return dicomDict.write() as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Public writer. Takes a Mask3D per BINARY segment / a ScalarField3D per
// FRACTIONAL segment, all on one shared GridGeometry, and emits a conformant
// SEG. Sparse by default (planes a segment doesn't touch produce no frame).
// ---------------------------------------------------------------------------

export interface WriteSegSegment {
  readonly number: number;
  readonly label: string;
  readonly algorithmType?: string;
  readonly algorithmName?: string;
  readonly category?: CodedConcept;
  readonly propertyType?: CodedConcept;
  readonly propertyTypeModifier?: CodedConcept;
  readonly trackingId?: string;
  readonly trackingUid?: string;
  /** BINARY — the segment mask. */
  readonly mask?: Mask3D;
  /** FRACTIONAL — the segment field (0..1 unless `fieldScale: "raw"`). */
  readonly field?: ScalarField3D;
}

export interface WriteSegOptions {
  readonly segmentationType: SegmentationType;
  /**
   * FRACTIONAL only, and **required** — there is no default. PROBABILITY and OCCUPANCY are
   * different quantities (roadmap §7.1 / FRACTIONAL-SEG.md §1); the writer must be told
   * which one the values are.
   */
  readonly fractionalType?: FractionalType;
  /** FRACTIONAL only — the stored integer that means 1.0. Default 255 (8-bit ceiling). */
  readonly maximumFractionalValue?: number;
  /**
   * How `segment.field` values are read. `"unit"` (default): they are in `[0, 1]` and get
   * multiplied by `maximumFractionalValue`. `"raw"`: they are already integers in
   * `[0, maximumFractionalValue]`.
   */
  readonly fieldScale?: "unit" | "raw";
  readonly segments: readonly WriteSegSegment[];
  /** Default `"NO"` for one segment, `"UNDEFINED"` for more. */
  readonly segmentsOverlap?: SegmentsOverlap;
  /** Default: the shared geometry's `frameOfReferenceUID`, else a fresh UID. */
  readonly frameOfReferenceUID?: string;
  readonly contentLabel?: string;
  readonly tolerance?: GridTolerance;
}

export function writeSeg(options: WriteSegOptions): ArrayBuffer {
  const isBinary = options.segmentationType === "BINARY";
  if (options.segmentationType !== "BINARY" && options.segmentationType !== "FRACTIONAL") {
    throw new TypeError(`writeSeg: segmentationType must be "BINARY" or "FRACTIONAL", got ${JSON.stringify(options.segmentationType)}`);
  }
  if (!isBinary && options.fractionalType === undefined) {
    throw new TypeError(
      'writeSeg: a FRACTIONAL segmentation requires an explicit fractionalType ("PROBABILITY" or "OCCUPANCY") — ' +
        "there is no default (FRACTIONAL-SEG.md §1)",
    );
  }
  if (options.segments.length === 0) throw new RangeError("writeSeg: at least one segment is required");

  const numbers = new Set<number>();
  for (const s of options.segments) {
    if (!Number.isInteger(s.number) || s.number <= 0) {
      throw new RangeError(`writeSeg: segment number must be a positive integer, got ${s.number}`);
    }
    if (numbers.has(s.number)) throw new RangeError(`writeSeg: duplicate segment number ${s.number}`);
    numbers.add(s.number);
  }

  const maxFractional = options.maximumFractionalValue ?? 255;
  if (!isBinary && (!Number.isInteger(maxFractional) || maxFractional < 1 || maxFractional > 255)) {
    throw new RangeError(`writeSeg: maximumFractionalValue must be an integer in [1, 255], got ${maxFractional}`);
  }
  const rawScale = options.fieldScale === "raw";

  const structures = options.segments.map((s) => {
    const structure = isBinary ? s.mask : s.field;
    if (!structure) {
      throw new TypeError(`writeSeg: segment ${s.number} is missing its ${isBinary ? "mask" : "field"}`);
    }
    return structure;
  });
  const geometry = (structures[0] as Mask3D | ScalarField3D).geometry;
  for (let i = 1; i < structures.length; i++) {
    if (!(structures[i] as Mask3D | ScalarField3D).geometry.equals(geometry, options.tolerance)) {
      throw new GridMismatchError(
        `writeSeg: segment ${options.segments[i]!.number}'s ${isBinary ? "mask" : "field"} is on a different grid than segment ${options.segments[0]!.number}'s — every segment must share one GridGeometry`,
      );
    }
  }

  const columns = geometry.columns;
  const rows = geometry.rows;
  const rc = columns * rows;
  const planeCount = geometry.planes.length;
  const planePositions = geometry.planes.map((p) => p.position);
  const sliceThickness = planeCount >= 2 ? geometry.planeThicknessMm(0) : 1;

  // One frame per (segment, plane) across the whole shared geometry — so
  // writeSeg → readSeg is an exact identity on the grid, empty planes included.
  // (Real files usually omit all-zero frames; reading handles that, sparse
  // *writing* is a later feature.)
  const frames: WriteSegFrame[] = [];
  options.segments.forEach((s, si) => {
    const structure = structures[si]!;
    for (let k = 0; k < planeCount; k++) {
      const slice = (structure as Mask3D | ScalarField3D).getSliceBuffer(k);
      const pixels = new Uint8Array(rc);
      for (let i = 0; i < rc; i++) {
        const v = slice[i] as number;
        if (isBinary) {
          pixels[i] = v !== 0 ? 1 : 0;
        } else {
          let stored = Math.round(rawScale ? v : v * maxFractional);
          if (stored < 0) stored = 0;
          if (stored > maxFractional) stored = maxFractional;
          pixels[i] = stored;
        }
      }
      frames.push({ segmentNumber: s.number, position: planePositions[k] as Vec3, pixels });
    }
  });

  const segmentsOverlap: SegmentsOverlap =
    options.segmentsOverlap ?? (options.segments.length === 1 ? "NO" : "UNDEFINED");

  const encodeOptions: EncodeSegOptions = {
    rows,
    columns,
    segmentationType: options.segmentationType,
    rowDirection: geometry.rowDirection as Vec3,
    columnDirection: geometry.columnDirection as Vec3,
    pixelSpacing: geometry.pixelSpacing as readonly [number, number],
    sliceThickness,
    segmentsOverlap,
    segments: options.segments.map((s) => ({
      number: s.number,
      label: s.label,
      algorithmType: s.algorithmType ?? "AUTOMATIC",
      algorithmName: s.algorithmName ?? "dicom-seg-js",
      ...(s.category ? { category: s.category } : {}),
      ...(s.propertyType ? { propertyType: s.propertyType } : {}),
      ...(s.propertyTypeModifier ? { propertyTypeModifier: s.propertyTypeModifier } : {}),
      ...(s.trackingId !== undefined ? { trackingId: s.trackingId } : {}),
      ...(s.trackingUid !== undefined ? { trackingUid: s.trackingUid } : {}),
    })),
    frames,
    ...(options.frameOfReferenceUID ?? geometry.frameOfReferenceUID
      ? { frameOfReferenceUID: (options.frameOfReferenceUID ?? geometry.frameOfReferenceUID) as string }
      : {}),
    ...(isBinary ? {} : { fractionalType: options.fractionalType, maximumFractionalValue: maxFractional }),
  };

  return encodeSegFrames(encodeOptions);
}
