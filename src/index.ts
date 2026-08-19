import { rasterize } from "./contour/rasterize.js";
import { vectorize } from "./contour/vectorize.js";
import { createDiagnostic } from "./diagnostics/index.js";
import { readRTStruct, writeRTStruct } from "./dicom/port.js";
import type { Diagnostic, DicomVolumeResult, GridGeometry, LoadOptions, Mask3D, Provenance, RoiHandle } from "./types.js";

// Public building blocks — everything needed to construct a GridGeometry or Mask3D
// from scratch, not just to read/write RTStructImpl. dicom/port.ts is deliberately
// NOT re-exported here: RTStructImpl.load/createFromMask is the intended DICOM I/O
// surface (IMPLEMENTATION_PLAN.md section 1).
export * from "./types.js";
export * from "./errors.js";
export * from "./contour/types.js";
export * from "./contour/rasterize.js";
export * from "./contour/vectorize.js";
export * from "./geometry/grid-geometry.js";
export * from "./geometry/tolerance.js";
export * from "./geometry/vec3.js";
export * from "./geometry/plane-sort.js";
export * from "./mask/mask3d.js";
export * from "./phantom/index.js";
export * from "./metrics.js";

export interface LoadParams extends LoadOptions {
  readonly rtstruct: ArrayBuffer;
  readonly geometry: GridGeometry;
}

export interface CreateFromMaskParams {
  readonly mask: Mask3D;
  readonly name: string;
}

interface StoredRoi {
  readonly name: string;
  readonly roiNumber: number;
  readonly interpretedType: string;
  readonly mask: Mask3D;
  readonly provenance: Provenance;
  readonly diagnostics: readonly Diagnostic[];
  readonly volumeCm3: number | undefined;
}

/** The public entry point (IMPLEMENTATION_PLAN.md section 1). Wired to dicom/port.ts. */
export class RTStructImpl {
  private readonly rois: ReadonlyMap<string, StoredRoi>;
  private readonly documentDiagnostics: readonly Diagnostic[];

  private constructor(rois: ReadonlyMap<string, StoredRoi>, documentDiagnostics: readonly Diagnostic[]) {
    this.rois = rois;
    this.documentDiagnostics = documentDiagnostics;
  }

  static async load(params: LoadParams): Promise<RTStructImpl> {
    const parsed = readRTStruct(params.rtstruct);

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

    const rois = new Map<string, StoredRoi>();
    for (const roi of parsed.rois) {
      const result = rasterize(roi.contours, params.geometry);
      const diagnostics = [...result.diagnostics];
      if (roi.contours.length === 0) {
        diagnostics.push(
          createDiagnostic("EMPTY_ROI", "warning", `ROI ${JSON.stringify(roi.name)} has no ContourSequence`, {
            roiNumber: roi.roiNumber,
          }),
        );
      }
      rois.set(roi.name, {
        name: roi.name,
        roiNumber: roi.roiNumber,
        interpretedType: roi.interpretedType,
        mask: result.mask,
        provenance: result.provenance,
        diagnostics,
        volumeCm3: roi.volumeCm3,
      });
    }

    return new RTStructImpl(rois, documentDiagnostics);
  }

  static async createFromMask(params: CreateFromMaskParams): Promise<ArrayBuffer> {
    return writeRTStruct({ rois: [{ name: params.name, contours: vectorize(params.mask) }] });
  }

  private getRoi(name: string): StoredRoi {
    const roi = this.rois.get(name);
    if (!roi) throw new RangeError(`no ROI named ${JSON.stringify(name)}`);
    return roi;
  }

  get diagnostics(): readonly Diagnostic[] {
    return [...this.documentDiagnostics, ...[...this.rois.values()].flatMap((roi) => roi.diagnostics)];
  }

  getROINames(): readonly string[] {
    return [...this.rois.keys()];
  }

  roi(name: string): RoiHandle {
    const roi = this.getRoi(name);
    return {
      name: roi.name,
      roiNumber: roi.roiNumber,
      interpretedType: roi.interpretedType,
      provenance: roi.provenance,
      diagnostics: roi.diagnostics,
    };
  }

  getMask(name: string): Mask3D {
    return this.getRoi(name).mask;
  }

  getMaskSlice(name: string, planeIndex: number): Uint8Array {
    return this.getRoi(name).mask.getSliceBuffer(planeIndex);
  }

  /** Never computed from the mask — absent unless the file itself declared ROI Volume (3006,002C). */
  dicomVolume(name: string): DicomVolumeResult | undefined {
    const volumeCm3 = this.getRoi(name).volumeCm3;
    return volumeCm3 === undefined ? undefined : { value: volumeCm3, unit: "cm3", source: "DICOM ROI Volume (3006,002C)" };
  }
}
