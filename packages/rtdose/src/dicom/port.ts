import { createRequire } from "node:module";
import {
  add,
  createDiagnostic,
  createGridGeometry,
  cross,
  normalize,
  scale,
  type Diagnostic,
  type GridGeometry,
  type Vec3,
} from "rt-geometry-js";
import { MalformedDoseGridError, NotRTDoseError } from "../errors.js";

// THE ONLY dcmjs importer in rtdose-js — mirrors rtstruct-js/src/dicom/port.ts.
//
// dcmjs's package.json maps the ESM "import" condition to build/dcmjs.es.js, a file with
// `export` syntax but no "type": "module" and no .mjs extension — Node parses it as CJS
// and throws. `require()` hits the genuinely-CJS "require" condition instead.
const dcmjs = createRequire(import.meta.url)("dcmjs");
const { DicomMetaDictionary, DicomMessage, DicomDict } = dcmjs.data;

const RT_DOSE_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.481.2";
const TRANSFER_SYNTAX_UID = "1.2.840.10008.1.2.1"; // Explicit VR Little Endian
const TAG_PIXEL_DATA = "7FE00010";

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range (length ${arr.length})`);
  return value;
}

function naturalize(bytes: ArrayBuffer): Record<string, unknown> {
  const dicomData = DicomMessage.readFile(bytes, { forceStoreRaw: true });
  return DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<string, unknown>;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "number") return [value];
  if (typeof value === "string") {
    return value
      .split("\\")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  }
  return undefined;
}

/** Little-endian is assumed: every uncompressed transfer syntax a real RTDOSE uses is LE,
 *  and so is every host this runs on. Compressed dose pixel data is not supported. */
function readStoredSamples(
  pixelData: unknown,
  count: number,
  bitsAllocated: number,
  pixelRepresentation: number,
): Float64Array {
  const buffers = Array.isArray(pixelData) ? pixelData : pixelData === undefined ? [] : [pixelData];
  const first = buffers[0];
  if (!(first instanceof ArrayBuffer)) {
    throw new MalformedDoseGridError("PixelData (7FE0,0010) is absent or not decodable as raw bytes");
  }
  const bytesPerSample = bitsAllocated === 32 ? 4 : 2;
  if (first.byteLength < count * bytesPerSample) {
    throw new MalformedDoseGridError(
      `PixelData is ${first.byteLength} bytes, need at least ${count * bytesPerSample} for ` +
        `${count} samples at ${bitsAllocated}-bit`,
    );
  }
  const typed =
    bitsAllocated === 32
      ? pixelRepresentation === 1
        ? new Int32Array(first, 0, count)
        : new Uint32Array(first, 0, count)
      : pixelRepresentation === 1
        ? new Int16Array(first, 0, count)
        : new Uint16Array(first, 0, count);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = typed[i] as number;
  return out;
}

export interface RTDoseParse {
  /** Dose grid geometry — planes sorted ascending along the normal. */
  readonly geometry: GridGeometry;
  /**
   * Dose in `doseUnits` (Gy when `doseUnits === "GY"`), `DoseGridScaling` already applied,
   * laid out exactly as `createScalarField` / `getSliceBuffer` expect:
   * `planeIndex · rows · columns + row · columns + column`.
   */
  readonly doseValues: Float32Array;
  readonly doseUnits: string;
  readonly doseType: string | undefined;
  readonly doseSummationType: string | undefined;
  readonly doseGridScaling: number;
  readonly frameOfReferenceUID: string | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * A single RTDOSE object's bytes → dose grid + scaled values + diagnostics. Standalone,
 * the way `readSeriesGeometry` is in rtstruct-js; `DoseGrid.fromDicom` wraps this.
 *
 * Assumes the dose frames are stacked parallel to the grid normal and
 * `GridFrameOffsetVector` holds each frame's offset (mm) along that normal relative to
 * `ImagePositionPatient` — true for essentially every clinical RTDOSE. A non-zero first
 * offset is treated as relative all the same, with a diagnostic.
 */
export function readRTDose(bytes: ArrayBuffer): RTDoseParse {
  const ds = naturalize(bytes);

  const sopClassUID = ds["SOPClassUID"] as string | undefined;
  const modality = ds["Modality"] as string | undefined;
  if (sopClassUID !== undefined && sopClassUID !== RT_DOSE_STORAGE_SOP_CLASS_UID && modality !== "RTDOSE") {
    throw new NotRTDoseError(
      `SOPClassUID ${sopClassUID} is not RT Dose Storage (${RT_DOSE_STORAGE_SOP_CLASS_UID}) and ` +
        `Modality is ${modality ?? "absent"}`,
    );
  }

  const rows = ds["Rows"] as number | undefined;
  const columns = ds["Columns"] as number | undefined;
  const pixelSpacing = asNumberArray(ds["PixelSpacing"]);
  const orientation = asNumberArray(ds["ImageOrientationPatient"]);
  const position = asNumberArray(ds["ImagePositionPatient"]);
  const numberOfFrames = (ds["NumberOfFrames"] as number | undefined) ?? 1;

  if (!Number.isInteger(rows) || (rows as number) <= 0) throw new MalformedDoseGridError("missing or invalid Rows");
  if (!Number.isInteger(columns) || (columns as number) <= 0) {
    throw new MalformedDoseGridError("missing or invalid Columns");
  }
  if (!pixelSpacing || pixelSpacing.length !== 2) throw new MalformedDoseGridError("missing or malformed PixelSpacing");
  if (!orientation || orientation.length !== 6) {
    throw new MalformedDoseGridError("missing or malformed ImageOrientationPatient");
  }
  if (!position || position.length !== 3) throw new MalformedDoseGridError("missing or malformed ImagePositionPatient");
  if (!Number.isInteger(numberOfFrames) || numberOfFrames <= 0) {
    throw new MalformedDoseGridError(`invalid NumberOfFrames ${numberOfFrames}`);
  }

  let offsets = asNumberArray(ds["GridFrameOffsetVector"]);
  if (numberOfFrames > 1) {
    if (!offsets || offsets.length !== numberOfFrames) {
      throw new MalformedDoseGridError(
        `GridFrameOffsetVector has ${offsets?.length ?? 0} entries, expected ${numberOfFrames} ` +
          `(one per frame) — cannot place the dose planes`,
      );
    }
  } else if (!offsets || offsets.length === 0) {
    offsets = [0];
  }

  const diagnostics: Diagnostic[] = [];

  const scalingRaw = ds["DoseGridScaling"] as number | undefined;
  let doseGridScaling = scalingRaw;
  if (doseGridScaling === undefined || !Number.isFinite(doseGridScaling) || doseGridScaling <= 0) {
    diagnostics.push(
      createDiagnostic(
        "MISSING_DOSE_GRID_SCALING",
        "warning",
        `DoseGridScaling (3004,000E) is ${scalingRaw === undefined ? "absent" : `invalid (${scalingRaw})`}; ` +
          `treating stored values as already scaled (factor 1.0)`,
      ),
    );
    doseGridScaling = 1;
  }

  const doseUnits = ((ds["DoseUnits"] as string | undefined) ?? "").toUpperCase() || "UNKNOWN";
  if (doseUnits !== "GY") {
    diagnostics.push(
      createDiagnostic(
        "DOSE_UNITS_NOT_GY",
        "warning",
        `DoseUnits (3004,0002) is ${JSON.stringify(doseUnits)}, not "GY" — DVH values are in ` +
          `those units, and Gy-denominated thresholds (V20, D95 in Gy) are not meaningful`,
      ),
    );
  }

  const rowDirection: Vec3 = [at(orientation, 0), at(orientation, 1), at(orientation, 2)];
  const columnDirection: Vec3 = [at(orientation, 3), at(orientation, 4), at(orientation, 5)];
  const ipp: Vec3 = [at(position, 0), at(position, 1), at(position, 2)];
  const normal = normalize(cross(rowDirection, columnDirection));

  const rc = (rows as number) * (columns as number);
  const stored = readStoredSamples(
    ds["PixelData"],
    numberOfFrames * rc,
    (ds["BitsAllocated"] as number | undefined) ?? 16,
    (ds["PixelRepresentation"] as number | undefined) ?? 0,
  );

  // Sort frames ascending along the normal; createGridGeometry would sort the plane
  // positions anyway, so the value buffer has to be reordered to match.
  const order = [...Array(numberOfFrames).keys()].sort((a, b) => at(offsets!, a) - at(offsets!, b));
  const reordered = order.some((f, i) => f !== i);
  if (reordered) {
    diagnostics.push(
      createDiagnostic(
        "DOSE_FRAMES_REORDERED",
        "info",
        "GridFrameOffsetVector was not ascending; dose frames were sorted along the grid normal",
      ),
    );
  }
  if (Math.abs(at(offsets, 0)) > 1e-6) {
    diagnostics.push(
      createDiagnostic(
        "GRID_FRAME_OFFSET_NONZERO_ORIGIN",
        "info",
        `GridFrameOffsetVector starts at ${at(offsets, 0)} rather than 0; entries are treated ` +
          `as offsets (mm) from ImagePositionPatient along the grid normal`,
      ),
    );
  }
  if (numberOfFrames === 1) {
    diagnostics.push(
      createDiagnostic(
        "SINGLE_FRAME_DOSE_GRID",
        "info",
        "single-frame dose grid: sample() interpolates only in-plane, and volume queries " +
          "need a structure mask with at least two planes to define slice thickness",
      ),
    );
  }

  const doseValues = new Float32Array(numberOfFrames * rc);
  for (let p = 0; p < numberOfFrames; p++) {
    const f = at(order, p);
    const src = f * rc;
    const dst = p * rc;
    for (let i = 0; i < rc; i++) doseValues[dst + i] = (stored[src + i] as number) * doseGridScaling;
  }
  const planePositions: Vec3[] = order.map((f) => add(ipp, scale(normal, at(offsets!, f))));

  const geometry = createGridGeometry({
    rows: rows as number,
    columns: columns as number,
    rowDirection,
    columnDirection,
    pixelSpacing: [at(pixelSpacing, 0), at(pixelSpacing, 1)],
    planePositions,
    frameOfReferenceUID: ds["FrameOfReferenceUID"] as string | undefined,
  });

  return {
    geometry,
    doseValues,
    doseUnits,
    doseType: ds["DoseType"] as string | undefined,
    doseSummationType: ds["DoseSummationType"] as string | undefined,
    doseGridScaling,
    frameOfReferenceUID: ds["FrameOfReferenceUID"] as string | undefined,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Fixture builder. RTDOSE files are BUILT for tests, never checked in — same
// rule as rtstruct-js (IMPLEMENTATION_PLAN.md section 7).
// ---------------------------------------------------------------------------

export interface WriteRTDoseOptions {
  readonly rows: number;
  readonly columns: number;
  readonly pixelSpacing?: readonly [number, number];
  readonly rowDirection?: Vec3;
  readonly columnDirection?: Vec3;
  readonly imagePositionPatient?: Vec3;
  /** One offset (mm along the normal) per frame. Default `[0]` (single frame). */
  readonly frameOffsets?: readonly number[];
  readonly frameOfReferenceUID?: string;
  /** `null` omits the tag entirely (to exercise MISSING_DOSE_GRID_SCALING). Default `1`. */
  readonly doseGridScaling?: number | null;
  readonly doseUnits?: string;
  readonly doseType?: string;
  readonly doseSummationType?: string;
  readonly bitsAllocated?: 16 | 32;
  readonly pixelRepresentation?: 0 | 1;
  /** Override to exercise NotRTDoseError. Default RT Dose Storage. */
  readonly sopClassUID?: string;
  readonly modality?: string;
  /**
   * Raw stored integers (NOT scaled — the reader multiplies by DoseGridScaling), frame-major
   * `frame · rows · columns + row · columns + column`, or a generator.
   */
  readonly storedValues: ArrayLike<number> | ((column: number, row: number, frame: number) => number);
  /** Test-only: omit GridFrameOffsetVector even when there is more than one frame. */
  readonly omitGridFrameOffsetVector?: boolean;
  /** Test-only: write fewer PixelData bytes than `frames · rows · columns` implies. */
  readonly truncatePixelDataBytesTo?: number;
}

export function writeRTDose(options: WriteRTDoseOptions): ArrayBuffer {
  const rows = options.rows;
  const columns = options.columns;
  const offsets = options.frameOffsets ?? [0];
  const frames = offsets.length;
  const bitsAllocated = options.bitsAllocated ?? 16;
  const pixelRepresentation = options.pixelRepresentation ?? 0;
  const rc = rows * columns;
  const count = frames * rc;

  const Ctor =
    bitsAllocated === 32
      ? pixelRepresentation === 1
        ? Int32Array
        : Uint32Array
      : pixelRepresentation === 1
        ? Int16Array
        : Uint16Array;
  const samples = new Ctor(count);
  const gen = options.storedValues;
  if (typeof gen === "function") {
    for (let f = 0; f < frames; f++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) samples[f * rc + r * columns + c] = gen(c, r, f);
      }
    }
  } else {
    for (let i = 0; i < count; i++) samples[i] = gen[i] ?? 0;
  }
  let pixelBuffer = samples.buffer.slice(0) as ArrayBuffer;
  if (options.truncatePixelDataBytesTo !== undefined) {
    pixelBuffer = pixelBuffer.slice(0, options.truncatePixelDataBytesTo);
  }

  const rowDirection = options.rowDirection ?? ([1, 0, 0] as Vec3);
  const columnDirection = options.columnDirection ?? ([0, 1, 0] as Vec3);

  const dataset: Record<string, unknown> = {
    _meta: {},
    SOPClassUID: options.sopClassUID ?? RT_DOSE_STORAGE_SOP_CLASS_UID,
    SOPInstanceUID: DicomMetaDictionary.uid(),
    Modality: options.modality ?? "RTDOSE",
    SamplesPerPixel: 1,
    PhotometricInterpretation: "MONOCHROME2",
    Rows: rows,
    Columns: columns,
    NumberOfFrames: frames,
    BitsAllocated: bitsAllocated,
    BitsStored: bitsAllocated,
    HighBit: bitsAllocated - 1,
    PixelRepresentation: pixelRepresentation,
    PixelSpacing: [...(options.pixelSpacing ?? [2, 2])],
    ImageOrientationPatient: [...rowDirection, ...columnDirection],
    ImagePositionPatient: [...(options.imagePositionPatient ?? ([0, 0, 0] as Vec3))],
    FrameOfReferenceUID: options.frameOfReferenceUID ?? DicomMetaDictionary.uid(),
    DoseType: options.doseType ?? "PHYSICAL",
    DoseSummationType: options.doseSummationType ?? "PLAN",
    DoseUnits: options.doseUnits ?? "GY",
  };
  if (!options.omitGridFrameOffsetVector) dataset["GridFrameOffsetVector"] = [...offsets];
  if (options.doseGridScaling !== null) dataset["DoseGridScaling"] = options.doseGridScaling ?? 1;

  const meta = {
    MediaStorageSOPClassUID: dataset["SOPClassUID"],
    MediaStorageSOPInstanceUID: dataset["SOPInstanceUID"],
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: "rtdose-js",
    TransferSyntaxUID: TRANSFER_SYNTAX_UID,
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset) as Record<string, unknown>;
  // The data dictionary VR for PixelData is context-dependent ("ox"); force OW for
  // uncompressed 16/32-bit little-endian dose so dcmjs doesn't warn and guess.
  dicomDict.dict[TAG_PIXEL_DATA] = { vr: "OW", Value: [pixelBuffer] };

  return dicomDict.write() as ArrayBuffer;
}
