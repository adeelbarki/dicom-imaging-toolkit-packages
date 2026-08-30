import { dice, maskFromDense, voxelDisagreement } from "rt-geometry-js";
import type { GridGeometry, Mask3D, ScalarField3D } from "rt-geometry-js";
import type { Segmentation } from "dicom-seg-js";
import { RTStruct } from "rtstruct-js";
import { MissingThresholdError, SegmentNotFoundError } from "./errors.js";
import { buildProvenance, gridSummary } from "./provenance.js";
import type { ConversionResult, LossyStep, MaskVectorizationStep } from "./provenance.js";

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
  /**
   * Cut a `FRACTIONAL` SEG field to a binary mask at this value — a voxel is kept when its
   * value is `>=` the threshold. **Required** for a `FRACTIONAL` SEG; there is no default
   * (`MissingThresholdError` otherwise). Ignored, with a note, for a `BINARY` SEG.
   */
  readonly threshold?: number;
  /**
   * How `threshold` is read. `"unit"` (default): against the field rescaled to `[0, 1]` by
   * `MaximumFractionalValue` — valid range `(0, 1]`. `"raw"`: against the stored integers
   * — valid range `(0, MaximumFractionalValue]`.
   */
  readonly thresholdScale?: "unit" | "raw";
}

function thresholdToMask(field: ScalarField3D, geometry: GridGeometry, threshold: number): Mask3D {
  const rc = geometry.rows * geometry.columns;
  const dense = new Uint8Array(geometry.planes.length * rc);
  for (let k = 0; k < geometry.planes.length; k++) {
    const slice = field.getSliceBuffer(k);
    const base = k * rc;
    for (let i = 0; i < rc; i++) if ((slice[i] as number) >= threshold) dense[base + i] = 1;
  }
  return maskFromDense(geometry, dense);
}

/**
 * Convert one SEG segment to a single-ROI RTSTRUCT.
 *
 * **BINARY** — the mask is traced straight to contours. **FRACTIONAL** — the field is
 * first cut to a mask at `options.threshold` (`MissingThresholdError` if none is given),
 * then traced. Both lossy steps land in `provenance.lossySteps`, in order:
 * `fractional-threshold` (FRACTIONAL only), then `mask-vectorization` (always, with the
 * round trip measured against the mask that was actually written).
 *
 * The ROI is written on the SEG's own grid (`Segmentation.geometry`) — no resampling.
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

  const info = seg.segments().find((s) => s.number === segmentNumber)!;
  const geometry = seg.geometry;
  const notes: string[] = [];
  const lossySteps: LossyStep[] = [];

  let sourceMask: Mask3D;
  let sourceDesc: string;

  if (seg.type === "BINARY") {
    if (options.threshold !== undefined) {
      notes.push("options.threshold was ignored — this is a BINARY SEG, there is nothing to cut");
    }
    sourceMask = seg.mask(segmentNumber);
    sourceDesc = `SEG segment ${segmentNumber} ${JSON.stringify(info.label)} (BINARY)`;
  } else {
    // FRACTIONAL
    if (options.threshold === undefined) {
      throw new MissingThresholdError(
        `segToRtstruct on a ${seg.type} segmentation requires options.threshold — RTSTRUCT has ` +
          "no per-voxel value, so the field must be cut to a mask. Pass a threshold " +
          `(default scale "unit", i.e. against the [0,1] field).`,
      );
    }
    const scale = options.thresholdScale ?? "unit";
    const max = seg.maximumFractionalValue ?? 255;
    const upper = scale === "unit" ? 1 : max;
    if (!Number.isFinite(options.threshold) || options.threshold <= 0 || options.threshold > upper) {
      throw new RangeError(
        `threshold ${options.threshold} out of range (0, ${upper}] for thresholdScale ${JSON.stringify(scale)}`,
      );
    }
    const field = scale === "unit" ? seg.field(segmentNumber) : seg.rawField(segmentNumber);
    sourceMask = thresholdToMask(field, geometry, options.threshold);

    const voxelsBefore = seg.support(segmentNumber).count();
    const voxelsAfter = sourceMask.count();
    if (seg.fractionalType === undefined) {
      notes.push(
        "the SEG did not declare SegmentationFractionalType — the threshold was applied to values " +
          "of unknown meaning (PROBABILITY vs OCCUPANCY)",
      );
    }
    if (voxelsAfter === 0) {
      notes.push(`threshold ${options.threshold} (${scale}) kept no voxels — the RTSTRUCT ROI is empty`);
    }
    lossySteps.push({
      kind: "fractional-threshold",
      threshold: options.threshold,
      thresholdScale: scale,
      fractionalType: seg.fractionalType,
      maximumFractionalValue: max,
      voxelsBefore,
      voxelsAfter,
      detail:
        `kept voxels with value >= ${options.threshold} (${scale}${scale === "raw" ? `, max ${max}` : ""}) — ` +
        `${voxelsAfter} of ${voxelsBefore} non-zero voxel(s)`,
    });
    sourceDesc =
      `SEG segment ${segmentNumber} ${JSON.stringify(info.label)} ` +
      `(FRACTIONAL${seg.fractionalType ? `/${seg.fractionalType}` : ""})`;
  }

  const roiName =
    options.roiName ?? (info.label && info.label.length > 0 ? info.label : `Segment ${segmentNumber}`);
  const referencedFrameOfReferenceUID =
    options.referencedFrameOfReferenceUID ?? seg.frameOfReferenceUID;

  const bytes = await RTStruct.createFromMask({
    mask: sourceMask,
    name: roiName,
    ...(options.interpretedType !== undefined ? { interpretedType: options.interpretedType } : {}),
    ...(referencedFrameOfReferenceUID !== undefined ? { referencedFrameOfReferenceUID } : {}),
  });

  // Measure the vectorize -> rasterize round trip against the mask that was written.
  const reloaded = await RTStruct.load({ rtstruct: bytes, geometry });
  const reMask = reloaded.getMask(roiName);
  const voxelsBefore = sourceMask.count();
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
  lossySteps.push(vectorization);

  if (voxelsBefore === 0) {
    notes.push(
      `segment ${segmentNumber} ${JSON.stringify(info.label)} produced no voxels — ` +
        "the RTSTRUCT ROI has no ContourSequence",
    );
  }
  for (const d of seg.diagnostics) {
    notes.push(`source SEG diagnostic [${d.severity}] ${d.code}: ${d.message}`);
  }

  return {
    bytes,
    provenance: buildProvenance({
      direction: "seg-to-rtstruct",
      source: sourceDesc,
      grid: gridSummary(geometry),
      voxelCount: voxelsBefore,
      lossySteps,
      notes,
    }),
  };
}
