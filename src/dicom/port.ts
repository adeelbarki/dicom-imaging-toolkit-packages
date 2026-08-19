import { createRequire } from "node:module";
import type { Contour, ContourGeometricType } from "../contour/types.js";
import type { Vec3 } from "../types.js";

// THE ONLY dcmjs importer — see IMPLEMENTATION_PLAN.md section 3.
//
// dcmjs's package.json maps the ESM "import" condition to build/dcmjs.es.js,
// a file containing `export` syntax but with no "type": "module" of its own
// and no .mjs extension — so Node's own resolver parses it as CommonJS and
// throws a SyntaxError. `require()` correctly hits the "require" condition
// (build/dcmjs.js, genuinely CJS) instead, so we go through createRequire
// rather than a static `import`.
const dcmjs = createRequire(import.meta.url)("dcmjs");
const { DicomMetaDictionary, DicomMessage, DicomDict } = dcmjs.data;

const RT_STRUCTURE_SET_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.481.3";
const CT_IMAGE_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.2";
const TRANSFER_SYNTAX_UID = "1.2.840.10008.1.2.1"; // Explicit VR Little Endian

// Denaturalized (tag-keyed) constants, used only where the naturalized/formatted
// value would be lossy — see readRoiNamesAndVolumes() / writeRTStruct() below.
const TAG_STRUCTURE_SET_ROI_SEQUENCE = "30060020";
const TAG_ROI_NUMBER = "30060022";
const TAG_ROI_NAME = "30060026";
const TAG_ROI_VOLUME = "3006002C";
const TAG_REFERENCED_FRAME_OF_REFERENCE_UID = "30060024";
/**
 * Private tag (odd group, unregistered): carries ROIName's exact character
 * count. DICOM's LO VR pads odd-length values with one trailing space to
 * reach even byte length, and that padding is indistinguishable from a
 * genuine trailing space once written — "gtv_p " (already even) round-trips
 * fine, but "PHANTOM" (odd) comes back as "PHANTOM ". Comparing the raw
 * value's length against this companion tag tells padding apart from
 * content, which is what "never normalize ROI names" requires in general.
 */
const TAG_ROI_NAME_LENGTH = "00091001";

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range (length ${arr.length})`);
  return value;
}

function asArray<T>(value: readonly T[] | undefined): readonly T[] {
  return value ?? [];
}

function chunkPoints(flat: readonly number[]): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    points.push([at(flat, i), at(flat, i + 1), at(flat, i + 2)]);
  }
  return points;
}

export interface WriteRoi {
  readonly name: string;
  readonly contours: readonly Contour[];
  readonly interpretedType?: string;
  readonly referencedFrameOfReferenceUID?: string;
}

export interface WriteRTStructOptions {
  readonly rois: readonly WriteRoi[];
  /** Test-only knob: writes ROIContourSequence/RTROIObservationsSequence in reverse ROI order, to prove joins happen by number, not position. */
  readonly shuffleSequences?: boolean;
  /** Test-only knob: omits RTROIObservationsSequence entirely (legal, Type 3 in PS3.3 2026c). */
  readonly omitRTROIObservations?: boolean;
}

/** DS (Decimal String) has a 16-character limit; full float precision would get silently truncated. */
function roundForDS(n: number): number {
  return Number(n.toFixed(6));
}

export function writeRTStruct(options: WriteRTStructOptions): ArrayBuffer {
  const numbered = options.rois.map((roi, i) => ({ ...roi, roiNumber: i + 1 }));
  const contourOrder = options.shuffleSequences ? [...numbered].reverse() : numbered;

  const structureSetROISequence = numbered.map((roi) => ({
    ROINumber: roi.roiNumber,
    ROIName: roi.name,
    ROIGenerationAlgorithm: "AUTOMATIC",
    ...(roi.referencedFrameOfReferenceUID !== undefined
      ? { ReferencedFrameOfReferenceUID: roi.referencedFrameOfReferenceUID }
      : {}),
  }));

  const roiContourSequence = contourOrder.map((roi) => {
    const item: Record<string, unknown> = { ReferencedROINumber: roi.roiNumber };
    if (roi.contours.length > 0) {
      item["ContourSequence"] = roi.contours.map((c) => ({
        ContourGeometricType: c.geometricType,
        NumberOfContourPoints: c.points.length,
        ContourData: c.points.flatMap((p) => [roundForDS(p[0]), roundForDS(p[1]), roundForDS(p[2])]),
      }));
    }
    return item;
  });

  const dataset: Record<string, unknown> = {
    _meta: {},
    SOPClassUID: RT_STRUCTURE_SET_STORAGE_SOP_CLASS_UID,
    SOPInstanceUID: DicomMetaDictionary.uid(),
    StructureSetLabel: "RTSTRUCT-JS",
    StructureSetROISequence: structureSetROISequence,
    ROIContourSequence: roiContourSequence,
  };

  if (!options.omitRTROIObservations) {
    dataset["RTROIObservationsSequence"] = contourOrder.map((roi) => ({
      ObservationNumber: roi.roiNumber,
      ReferencedROINumber: roi.roiNumber,
      RTROIInterpretedType: roi.interpretedType ?? "ORGAN",
    }));
  }

  const meta = {
    MediaStorageSOPClassUID: dataset["SOPClassUID"],
    MediaStorageSOPInstanceUID: dataset["SOPInstanceUID"],
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: "rtstruct-js",
    TransferSyntaxUID: TRANSFER_SYNTAX_UID,
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset) as Record<string, unknown>;

  const roiSequenceItems = (dicomDict.dict[TAG_STRUCTURE_SET_ROI_SEQUENCE] as { Value: Record<string, unknown>[] }).Value;
  numbered.forEach((roi, i) => {
    at(roiSequenceItems, i)[TAG_ROI_NAME_LENGTH] = { vr: "LO", Value: [String(roi.name.length)] };
  });

  return dicomDict.write() as ArrayBuffer;
}

export interface WriteCTSliceOptions {
  readonly sopInstanceUID?: string;
  readonly seriesInstanceUID?: string;
  readonly frameOfReferenceUID?: string;
  readonly rows: number;
  readonly columns: number;
  readonly pixelSpacing: readonly [number, number];
  readonly rowDirection: Vec3;
  readonly columnDirection: Vec3;
  readonly imagePositionPatient: Vec3;
}

/** Fixture builder — no production code path writes a CT image, only tests need one. */
export function writeCTSlice(options: WriteCTSliceOptions): ArrayBuffer {
  const dataset: Record<string, unknown> = {
    _meta: {},
    SOPClassUID: CT_IMAGE_STORAGE_SOP_CLASS_UID,
    SOPInstanceUID: options.sopInstanceUID ?? DicomMetaDictionary.uid(),
    SeriesInstanceUID: options.seriesInstanceUID ?? DicomMetaDictionary.uid(),
    FrameOfReferenceUID: options.frameOfReferenceUID ?? DicomMetaDictionary.uid(),
    Rows: options.rows,
    Columns: options.columns,
    PixelSpacing: [...options.pixelSpacing],
    ImageOrientationPatient: [...options.rowDirection, ...options.columnDirection],
    ImagePositionPatient: [...options.imagePositionPatient],
  };

  const meta = {
    MediaStorageSOPClassUID: dataset["SOPClassUID"],
    MediaStorageSOPInstanceUID: dataset["SOPInstanceUID"],
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: "rtstruct-js",
    TransferSyntaxUID: TRANSFER_SYNTAX_UID,
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset) as Record<string, unknown>;

  return dicomDict.write() as ArrayBuffer;
}

/** Both the naturalized (formatted) dataset and the raw denaturalized dict (for `_rawValue` access). */
export interface DicomDataset {
  readonly naturalized: Record<string, unknown>;
  readonly raw: Record<string, unknown>;
}

export function readDicomDataset(bytes: ArrayBuffer): DicomDataset {
  const dicomData = DicomMessage.readFile(bytes, { forceStoreRaw: true });
  return {
    raw: dicomData.dict as Record<string, unknown>,
    naturalized: DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<string, unknown>,
  };
}

export interface ParsedRoi {
  readonly roiNumber: number;
  readonly name: string;
  readonly contours: readonly Contour[];
  readonly interpretedType: string;
  readonly volumeCm3: number | undefined;
  readonly referencedFrameOfReferenceUID: string | undefined;
}

export interface ParsedRTStruct {
  readonly rois: readonly ParsedRoi[];
  readonly missingRTROIObservations: boolean;
}

/**
 * ROIName (VR LO) is right-trimmed by dcmjs's naturalized read path — DICOM
 * PS3.5 treats trailing space as padding, but the plan's "never normalize
 * ROI names" invariant means we must not apply that trim ourselves either.
 * forceStoreRaw keeps the pre-formatting bytes available as `_rawValue`; the
 * companion length tag (see TAG_ROI_NAME_LENGTH) tells genuine content apart
 * from a single byte of DICOM padding.
 */
function readRoiNamesAndVolumes(
  rawDict: Record<string, unknown>,
): Map<number, { name: string; volumeCm3: number | undefined; referencedFrameOfReferenceUID: string | undefined }> {
  const out = new Map<number, { name: string; volumeCm3: number | undefined; referencedFrameOfReferenceUID: string | undefined }>();
  const sequence = rawDict[TAG_STRUCTURE_SET_ROI_SEQUENCE] as { Value?: readonly Record<string, unknown>[] } | undefined;
  for (const item of sequence?.Value ?? []) {
    const numberEl = item[TAG_ROI_NUMBER] as { Value?: readonly number[] } | undefined;
    const nameEl = item[TAG_ROI_NAME] as { Value?: readonly string[]; _rawValue?: readonly string[] } | undefined;
    const lengthEl = item[TAG_ROI_NAME_LENGTH] as { Value?: readonly string[] } | undefined;
    const volumeEl = item[TAG_ROI_VOLUME] as { Value?: readonly number[] } | undefined;
    const forEl = item[TAG_REFERENCED_FRAME_OF_REFERENCE_UID] as { Value?: readonly string[] } | undefined;
    const roiNumber = numberEl?.Value?.[0];
    if (roiNumber === undefined) continue;
    const raw = nameEl?._rawValue?.[0] ?? nameEl?.Value?.[0] ?? "";
    const expectedLength = lengthEl?.Value?.[0] === undefined ? undefined : Number(lengthEl.Value[0]);
    const name = expectedLength !== undefined && raw.length > expectedLength ? raw.slice(0, expectedLength) : raw;
    out.set(roiNumber, { name, volumeCm3: volumeEl?.Value?.[0], referencedFrameOfReferenceUID: forEl?.Value?.[0] });
  }
  return out;
}

export function readRTStruct(bytes: ArrayBuffer): ParsedRTStruct {
  const { raw: rawDict, naturalized } = readDicomDataset(bytes);

  const namesAndVolumes = readRoiNamesAndVolumes(rawDict);

  const contoursByNumber = new Map<number, Contour[]>();
  for (const item of asArray(naturalized["ROIContourSequence"] as readonly Record<string, unknown>[] | undefined)) {
    const refNumber = item["ReferencedROINumber"] as number;
    const contourSequence = asArray(item["ContourSequence"] as readonly Record<string, unknown>[] | undefined);
    const contours: Contour[] = contourSequence.map((c) => ({
      geometricType: c["ContourGeometricType"] as ContourGeometricType,
      points: chunkPoints((c["ContourData"] as readonly number[] | undefined) ?? []),
    }));
    contoursByNumber.set(refNumber, contours);
  }

  const rtROIObservationsSequence = naturalized["RTROIObservationsSequence"] as readonly Record<string, unknown>[] | undefined;
  const interpretedTypeByNumber = new Map<number, string>();
  for (const item of asArray(rtROIObservationsSequence)) {
    const refNumber = item["ReferencedROINumber"] as number;
    interpretedTypeByNumber.set(refNumber, (item["RTROIInterpretedType"] as string | undefined) ?? "ORGAN");
  }

  const rois: ParsedRoi[] = [...namesAndVolumes.entries()].map(([roiNumber, { name, volumeCm3, referencedFrameOfReferenceUID }]) => ({
    roiNumber,
    name,
    contours: contoursByNumber.get(roiNumber) ?? [],
    interpretedType: interpretedTypeByNumber.get(roiNumber) ?? "ORGAN",
    volumeCm3,
    referencedFrameOfReferenceUID,
  }));

  return { rois, missingRTROIObservations: rtROIObservationsSequence === undefined };
}
