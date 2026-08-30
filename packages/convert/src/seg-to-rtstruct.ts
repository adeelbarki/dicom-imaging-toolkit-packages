import { dice, voxelDisagreement } from "rt-geometry-js";
import type { Segmentation } from "dicom-seg-js";
import { RTStruct } from "rtstruct-js";
import { MissingThresholdError, SegmentNotFoundError } from "./errors.js";
import { buildProvenance, gridSummary } from "./provenance.js";
import type { ConversionResult, MaskVectorizationStep } from "./provenance.js";

export interface SegToRtstructOptions {
  /** `ROIName` for the written structure. Default: the segment's `SegmentLabel`, else
   *  `"Segment <n>"`. */
  readonly roiName?: string;
  /** `RTROIInterpretedType` (`"ORGAN"`, `"GTV"`, `"CTV"`, `"PTV"`, `"EXTERNAL"`, …).
   *  Default: the writer's `"ORGAN"`. The SEG's coded
   *  `SegmentedPropertyCategory`/`Type` is **not** auto-translated — the vocabularies do
   *  not line up, and guessing would fabricate a clinical claim the file never made. */
  readonly interpretedType?: string;
  /** `ReferencedFrameOfReferenceUID` for the written ROI. Default: the SEG's frame of
   *  reference (`Segmentation.frameOfReferenceUID`). */
  readonly referencedFrameOfReferenceUID?: string;
}

/**
 * Convert one **BINARY** SEG segment to a single-ROI RTSTRUCT.
 *
 * The mask is traced to polygon contours (`rtstruct-js`'s vectorizer) and written as one
 * ROI on the SEG's own grid. That trace is the inverse of rasterization and is not exact;
 * the returned `provenance.lossySteps` contains a `mask-vectorization` step with the
 * measured round trip (voxel counts, disagreement, Dice) for *this* structure.
 *
 * A `FRACTIONAL` SEG throws {@link MissingThresholdError}: RTSTRUCT has no per-voxel value,
 * so the field must first be cut to a mask at a threshold. That path arrives in a later
 * release; until then, threshold `field(n)` yourself and pass the resulting SEG.
 */
export async function segToRtstruct(
  seg: Segmentation,
  segmentNumber: number,
  options: SegToRtstructOptions = {},
): Promise<ConversionResult> {
  if (!seg.hasSegment(segmentNumber)) {
    throw new SegmentNotFoundError(
      `SEG has no segment ${segmentNumber} (present: ${seg.segments().map((s) => s.number).join(", ") || "none"})`,
    );
  }
  if (seg.type !== "BINARY") {
    throw new MissingThresholdError(
      `segToRtstruct cannot convert a ${seg.type} segmentation directly — RTSTRUCT has no ` +
        "per-voxel value. Cut the field to a mask at a chosen threshold first " +
        "(field(n) + your own cut), then convert the resulting BINARY SEG.",
    );
  }

  const info = seg.segments().find((s) => s.number === segmentNumber)!;
  const geometry = seg.geometry;
  const sourceMask = seg.mask(segmentNumber);
  const voxelsBefore = sourceMask.count();

  const roiName = options.roiName ?? (info.label && info.label.length > 0 ? info.label : `Segment ${segmentNumber}`);
  const referencedFrameOfReferenceUID =
    options.referencedFrameOfReferenceUID ?? seg.frameOfReferenceUID;

  const bytes = await RTStruct.createFromMask({
    mask: sourceMask,
    name: roiName,
    ...(options.interpretedType !== undefined ? { interpretedType: options.interpretedType } : {}),
    ...(referencedFrameOfReferenceUID !== undefined ? { referencedFrameOfReferenceUID } : {}),
  });

  // Measure the vectorize -> rasterize round trip for this structure, on the same grid.
  const reloaded = await RTStruct.load({ rtstruct: bytes, geometry });
  const reMask = reloaded.getMask(roiName);
  const voxelsAfter = reMask.count();
  const disagreement = voxelDisagreement(sourceMask, reMask);
  const overlap = dice(sourceMask, reMask);

  const vectorization: MaskVectorizationStep = {
    kind: "mask-vectorization",
    voxelsBefore,
    voxelsAfter,
    voxelDisagreement: disagreement,
    dice: overlap,
    detail:
      disagreement === 0
        ? "mask traced to contours and back with no voxel change"
        : `re-rasterizing the written contours differs from the source mask by ${disagreement} voxel(s) ` +
          `(${voxelsBefore} -> ${voxelsAfter}, Dice ${overlap.toFixed(4)}) — boundary quantization`,
  };

  const notes: string[] = [];
  if (voxelsBefore === 0) {
    notes.push(
      `segment ${segmentNumber} ${JSON.stringify(info.label)} is empty — the RTSTRUCT ROI has no ContourSequence`,
    );
  }
  for (const d of seg.diagnostics) {
    notes.push(`source SEG diagnostic [${d.severity}] ${d.code}: ${d.message}`);
  }

  return {
    bytes,
    provenance: buildProvenance({
      direction: "seg-to-rtstruct",
      source: `SEG segment ${segmentNumber} ${JSON.stringify(info.label)} (BINARY)`,
      grid: gridSummary(geometry),
      voxelCount: voxelsBefore,
      lossySteps: [vectorization],
      notes,
    }),
  };
}
