import type { CodedConcept } from "dicom-seg-js";
import { writeSeg } from "dicom-seg-js";
import type { RTStruct } from "rtstruct-js";
import { buildProvenance, gridSummary } from "./provenance.js";
import type { ConversionResult } from "./provenance.js";

export interface RtstructToSegOptions {
  /** `SegmentNumber` for the written segment. Default `1`. */
  readonly segmentNumber?: number;
  /** `SegmentLabel`. Default: the ROI name. */
  readonly segmentLabel?: string;
  /** `SegmentAlgorithmType`. Default `"SEMIAUTOMATIC"` — RT contours are typically
   *  clinician-drawn or semi-automated, then rasterized here; `"AUTOMATIC"` would
   *  overclaim. Override if you know the true provenance. */
  readonly algorithmType?: "AUTOMATIC" | "SEMIAUTOMATIC" | "MANUAL";
  /** Coded anatomical category (0062,0003). Omitted if not supplied — RTSTRUCT's
   *  `RTROIInterpretedType` is a plain string, not a coded concept, so it is not
   *  auto-translated. */
  readonly category?: CodedConcept;
  /** Coded segmented property type (0062,000F). Omitted if not supplied. */
  readonly propertyType?: CodedConcept;
  /** `FrameOfReferenceUID` for the SEG. Default: the shared geometry's frame of
   *  reference. */
  readonly frameOfReferenceUID?: string;
  /** SEG `ContentLabel`. */
  readonly contentLabel?: string;
}

/**
 * Convert one RTSTRUCT ROI to a single-segment `BINARY` DICOM SEG.
 *
 * `rt` must already be loaded onto a `GridGeometry` (`RTStruct.load`). The ROI's contours
 * were rasterized to that grid at load time; this function writes exactly those voxels, so
 * the direction has **no lossy step** — `provenance.lossySteps` is empty. (Any precision
 * lost turning the original contours into voxels was lost by `RTStruct.load`, before this
 * call.)
 */
export function rtstructToSeg(
  rt: RTStruct,
  roi: string | number,
  options: RtstructToSegOptions = {},
): ConversionResult {
  const handle = rt.roi(roi); // RangeError (unknown) / AmbiguousRoiNameError (duplicate name) propagate
  const mask = rt.getMask(roi);
  const geometry = mask.geometry;

  const segmentNumber = options.segmentNumber ?? 1;
  const label = options.segmentLabel ?? handle.name;
  const voxelCount = mask.count();

  const notes: string[] = [];
  if (voxelCount === 0) {
    notes.push(
      `ROI ${JSON.stringify(handle.name)} (ROINumber ${handle.roiNumber}) rasterized to zero voxels — ` +
        `the SEG declares segment ${segmentNumber} with no set frames`,
    );
  }
  for (const d of handle.diagnostics) {
    notes.push(`source ROI diagnostic [${d.severity}] ${d.code}: ${d.message}`);
  }

  const bytes = writeSeg({
    segmentationType: "BINARY",
    ...(options.frameOfReferenceUID !== undefined
      ? { frameOfReferenceUID: options.frameOfReferenceUID }
      : {}),
    ...(options.contentLabel !== undefined ? { contentLabel: options.contentLabel } : {}),
    segments: [
      {
        number: segmentNumber,
        label,
        algorithmType: options.algorithmType ?? "SEMIAUTOMATIC",
        algorithmName: "rt-convert-js",
        ...(options.category ? { category: options.category } : {}),
        ...(options.propertyType ? { propertyType: options.propertyType } : {}),
        mask,
      },
    ],
  });

  return {
    bytes,
    provenance: buildProvenance({
      direction: "rtstruct-to-seg",
      source:
        `RTSTRUCT ROI ${JSON.stringify(handle.name)} ` +
        `(ROINumber ${handle.roiNumber}, RTROIInterpretedType ${JSON.stringify(handle.interpretedType)})`,
      grid: gridSummary(geometry),
      voxelCount,
      lossySteps: [],
      notes,
    }),
  };
}
