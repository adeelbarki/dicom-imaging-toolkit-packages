import { createDiagnostic, FrameOfReferenceMismatchError } from "rt-geometry-js";
import type { Diagnostic, GridGeometry, Mask3D, Provenance } from "rt-geometry-js";
import { rasterize } from "./contour/rasterize.js";
import { vectorize } from "./contour/vectorize.js";
import { readRTStruct, writeRTStruct } from "./dicom/port.js";
import { AmbiguousRoiNameError } from "./errors.js";
import type {
  DicomVolumeResult,
  LoadOptions,
  RoiHandle,
  SeriesGeometry,
  SliceAssociationDetail,
} from "./types.js";

// Public building blocks. The entire rt-geometry-js surface (GridGeometry, Mask3D,
// ScalarField3D, phantoms, metrics, histograms, geometry errors) is re-exported so
// existing `import { ... } from "rtstruct-js"` paths keep resolving after the geometry
// extraction. dicom/port.ts's ROI read/write internals are deliberately NOT re-exported:
// RTStruct.load/createFromMask is the intended RTSTRUCT I/O surface
// (IMPLEMENTATION_PLAN.md section 1). readSeriesGeometry is a separate, standalone
// capability (build a GridGeometry from real CT/MR slice files) with no equivalent
// higher-level wrapper, so it is exported.
export * from "rt-geometry-js";
export * from "./types.js";
export * from "./errors.js";
export * from "./contour/types.js";
export * from "./contour/rasterize.js";
export * from "./contour/vectorize.js";
export * from "./dicom/series-geometry.js";

export interface LoadParams extends LoadOptions {
  readonly rtstruct: ArrayBuffer;
  /**
   * The target grid. Pass a bare {@link GridGeometry} and every contour is placed by
   * nearest-plane geometry. Pass a {@link SeriesGeometry} (e.g. `readSeriesGeometry(...)
   * .geometry`) and a contour whose `ContourImageSequence` names one of the series' slices
   * is placed on *that* slice — the authoritative association DICOM intends — with geometry
   * used only where a reference is missing or unresolvable. `roi(...).sliceAssociation` /
   * `.sliceAssociationDetail` report which path each ROI took.
   */
  readonly geometry: GridGeometry | SeriesGeometry;
}

function isSeriesGeometry(g: GridGeometry | SeriesGeometry): g is SeriesGeometry {
  return "grid" in g && "slices" in g;
}

export interface CreateFromMaskParams {
  readonly mask: Mask3D;
  readonly name: string;
  /** RTROIInterpretedType (3006,00A4) for the written ROI. Omitted → `writeRTStruct`
   *  defaults it to `"ORGAN"` (IO-08). Pass this to carry a known type across a
   *  conversion (e.g. a SEG segment's anatomical category). */
  readonly interpretedType?: string;
  /** ReferencedFrameOfReferenceUID (3006,0024) for the written ROI. Omitted → the file
   *  declares no frame of reference, and a later `load()` cannot associate it with an
   *  image series. Pass the source object's frame of reference to keep that link. */
  readonly referencedFrameOfReferenceUID?: string;
}

interface StoredRoi {
  readonly name: string;
  readonly roiNumber: number;
  readonly interpretedType: string;
  readonly mask: Mask3D;
  readonly provenance: Provenance;
  readonly sliceAssociationDetail: SliceAssociationDetail;
  readonly diagnostics: readonly Diagnostic[];
  readonly volumeCm3: number | undefined;
}

/** The public entry point (IMPLEMENTATION_PLAN.md section 1). Wired to dicom/port.ts. */
export class RTStruct {
  /** Keyed by ROINumber, not name — ROIName is a label (PS3.3 permits duplicates across
   *  ROIs), ROINumber is the actual Type 1 unique identifier. Keying by name would silently
   *  drop every ROI but the last one sharing a name. */
  private readonly rois: ReadonlyMap<number, StoredRoi>;
  private readonly documentDiagnostics: readonly Diagnostic[];

  private constructor(rois: ReadonlyMap<number, StoredRoi>, documentDiagnostics: readonly Diagnostic[]) {
    this.rois = rois;
    this.documentDiagnostics = documentDiagnostics;
  }

  static async load(params: LoadParams): Promise<RTStruct> {
    const parsed = readRTStruct(params.rtstruct);

    const grid: GridGeometry = isSeriesGeometry(params.geometry) ? params.geometry.grid : params.geometry;

    // A SeriesGeometry lets contours associate to a slice by SOPInstanceUID. Map each
    // slice to its plane index in `grid` by nearest-plane (they were built from the same
    // positions, so the distance is ~0).
    let sopInstanceUIDToPlaneIndex: Map<string, number> | undefined;
    if (isSeriesGeometry(params.geometry)) {
      sopInstanceUIDToPlaneIndex = new Map();
      for (const slice of params.geometry.slices) {
        sopInstanceUIDToPlaneIndex.set(slice.sopInstanceUID, grid.findNearestPlane(slice.imagePositionPatient).planeIndex);
      }
    }
    const rasterizeOptions = sopInstanceUIDToPlaneIndex ? { sopInstanceUIDToPlaneIndex } : {};

    const documentDiagnostics: Diagnostic[] = [];
    if (parsed.missingRTROIObservations) {
      documentDiagnostics.push(
        createDiagnostic(
          "MISSING_RT_ROI_OBSERVATIONS",
          "info",
          "RTROIObservationsSequence is absent (Type 3 in PS3.3 2026c); RTROIInterpretedType defaults to ORGAN",
        ),
      );
    }
    if (
      sopInstanceUIDToPlaneIndex !== undefined &&
      !parsed.rois.some((roi) => roi.contours.some((c) => (c.referencedSOPInstanceUIDs?.length ?? 0) > 0))
    ) {
      documentDiagnostics.push(
        createDiagnostic(
          "MISSING_CONTOUR_IMAGE_SEQUENCE",
          "info",
          "a series was supplied for authoritative slice association, but no contour carries a " +
            "ContourImageSequence — every ROI used nearest-plane geometry",
        ),
      );
    }

    const strictness = params.strictness ?? "warn";
    const rois = new Map<number, StoredRoi>();
    for (const roi of parsed.rois) {
      const result = rasterize(roi.contours, grid, rasterizeOptions);
      const diagnostics = [...result.diagnostics];
      if (roi.contours.length === 0) {
        diagnostics.push(
          createDiagnostic("EMPTY_ROI", "warning", `ROI ${JSON.stringify(roi.name)} has no ContourSequence`, {
            roiNumber: roi.roiNumber,
          }),
        );
      }
      if (
        roi.referencedFrameOfReferenceUID !== undefined &&
        grid.frameOfReferenceUID !== undefined &&
        roi.referencedFrameOfReferenceUID !== grid.frameOfReferenceUID &&
        strictness !== "silent"
      ) {
        const message =
          `ROI ${JSON.stringify(roi.name)} references frame of reference ` +
          `${roi.referencedFrameOfReferenceUID}, but the supplied geometry is in ` +
          `${grid.frameOfReferenceUID}`;
        if (strictness === "strict") throw new FrameOfReferenceMismatchError(message);
        diagnostics.push(
          createDiagnostic("FRAME_OF_REFERENCE_MISMATCH", "warning", message, { roiNumber: roi.roiNumber }),
        );
      }
      rois.set(roi.roiNumber, {
        name: roi.name,
        roiNumber: roi.roiNumber,
        interpretedType: roi.interpretedType,
        mask: result.mask,
        provenance: result.provenance,
        sliceAssociationDetail: result.sliceAssociationDetail,
        diagnostics,
        volumeCm3: roi.volumeCm3,
      });
    }

    return new RTStruct(rois, documentDiagnostics);
  }

  static async createFromMask(params: CreateFromMaskParams): Promise<ArrayBuffer> {
    return writeRTStruct({
      rois: [
        {
          name: params.name,
          contours: vectorize(params.mask),
          ...(params.interpretedType !== undefined ? { interpretedType: params.interpretedType } : {}),
          ...(params.referencedFrameOfReferenceUID !== undefined
            ? { referencedFrameOfReferenceUID: params.referencedFrameOfReferenceUID }
            : {}),
        },
      ],
    });
  }

  /** Resolves either identifier: a number looks up ROINumber directly (unambiguous by
   *  construction — DICOM requires it unique). A string looks up by name, and throws
   *  AmbiguousRoiNameError if more than one ROI shares that name rather than silently
   *  picking one — use the ROINumber or findROIsByName() to disambiguate. */
  private getRoi(identifier: string | number): StoredRoi {
    if (typeof identifier === "number") {
      const roi = this.rois.get(identifier);
      if (!roi) throw new RangeError(`no ROI with ROINumber ${identifier}`);
      return roi;
    }
    const matches = [...this.rois.values()].filter((r) => r.name === identifier);
    if (matches.length === 0) throw new RangeError(`no ROI named ${JSON.stringify(identifier)}`);
    if (matches.length > 1) {
      throw new AmbiguousRoiNameError(
        `${matches.length} ROIs are named ${JSON.stringify(identifier)} (ROINumbers ` +
          `${matches.map((r) => r.roiNumber).join(", ")}) — use the ROINumber or findROIsByName() instead`,
      );
    }
    return matches[0] as StoredRoi;
  }

  private toHandle(roi: StoredRoi): RoiHandle {
    return {
      name: roi.name,
      roiNumber: roi.roiNumber,
      interpretedType: roi.interpretedType,
      provenance: roi.provenance,
      sliceAssociation: roi.provenance.sliceAssociation,
      sliceAssociationDetail: roi.sliceAssociationDetail,
      diagnostics: roi.diagnostics,
    };
  }

  get diagnostics(): readonly Diagnostic[] {
    return [...this.documentDiagnostics, ...[...this.rois.values()].flatMap((roi) => roi.diagnostics)];
  }

  /** May contain duplicates — ROIName is a label, not an identifier. Use getROINumbers()
   *  for a listing guaranteed to have one entry per ROI. */
  getROINames(): readonly string[] {
    return [...this.rois.values()].map((r) => r.name);
  }

  getROINumbers(): readonly number[] {
    return [...this.rois.keys()];
  }

  /** All ROIs with the given name — DICOM permits duplicate ROIName across distinct
   *  ROINumbers, so this can legitimately return more than one handle. */
  findROIsByName(name: string): readonly RoiHandle[] {
    return [...this.rois.values()].filter((r) => r.name === name).map((r) => this.toHandle(r));
  }

  /** Accepts either the ROINumber (unambiguous) or the ROIName (throws AmbiguousRoiNameError
   *  if more than one ROI shares it). */
  roi(identifier: string | number): RoiHandle {
    return this.toHandle(this.getRoi(identifier));
  }

  getMask(identifier: string | number): Mask3D {
    return this.getRoi(identifier).mask;
  }

  getMaskSlice(identifier: string | number, planeIndex: number): Uint8Array {
    return this.getRoi(identifier).mask.getSliceBuffer(planeIndex);
  }

  /** Never computed from the mask — absent unless the file itself declared ROI Volume (3006,002C). */
  dicomVolume(identifier: string | number): DicomVolumeResult | undefined {
    const volumeCm3 = this.getRoi(identifier).volumeCm3;
    return volumeCm3 === undefined ? undefined : { value: volumeCm3, unit: "cm3", source: "DICOM ROI Volume (3006,002C)" };
  }
}

/**
 * @deprecated `RTStructImpl` was the name used during scaffolding, before this became the
 * public entry point. Use {@link RTStruct} instead. This alias covers both type and value
 * position and will be removed in a future major version.
 */
export type RTStructImpl = RTStruct;
/** @deprecated Use {@link RTStruct} instead — see the type alias above. */
export const RTStructImpl = RTStruct;
