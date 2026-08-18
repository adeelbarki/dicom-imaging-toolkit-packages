import type { Contour } from "./contour/types.js";
import { rasterize } from "./contour/rasterize.js";
import { vectorize } from "./contour/vectorize.js";
import { NotImplementedError } from "./errors.js";
import type {
  Diagnostic,
  DicomVolumeResult,
  GridGeometry,
  LoadOptions,
  Mask3D,
  Provenance,
  RoiHandle,
} from "./types.js";

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
}

/**
 * Phase 4 wire format: `vectorize()` output serialized as JSON, not DICOM.
 * It exists only to drive the mask -> RTSTRUCT -> mask gate (RT-01..05)
 * before real DICOM I/O exists. Phase 5 replaces load()/createFromMask()
 * with dicom/port.ts; vectorize()/rasterize() themselves do not change.
 */
interface WireRoi {
  readonly name: string;
  readonly contours: readonly Contour[];
}
interface WireFormat {
  readonly rois: readonly WireRoi[];
}

/** The public entry point (IMPLEMENTATION_PLAN.md section 1). Phase 5 wires this to dicom/port.ts. */
export class RTStructImpl {
  private readonly rois: ReadonlyMap<string, StoredRoi>;

  private constructor(rois: ReadonlyMap<string, StoredRoi>) {
    this.rois = rois;
  }

  static async load(params: LoadParams): Promise<RTStructImpl> {
    const wire = JSON.parse(new TextDecoder().decode(params.rtstruct)) as WireFormat;
    const rois = new Map<string, StoredRoi>();
    wire.rois.forEach((entry, i) => {
      const result = rasterize(entry.contours, params.geometry);
      rois.set(entry.name, {
        name: entry.name,
        roiNumber: i + 1,
        interpretedType: "ORGAN",
        mask: result.mask,
        provenance: result.provenance,
        diagnostics: result.diagnostics,
      });
    });
    return new RTStructImpl(rois);
  }

  static async createFromMask(params: CreateFromMaskParams): Promise<ArrayBuffer> {
    const wire: WireFormat = { rois: [{ name: params.name, contours: vectorize(params.mask) }] };
    return new TextEncoder().encode(JSON.stringify(wire)).buffer as ArrayBuffer;
  }

  private getRoi(name: string): StoredRoi {
    const roi = this.rois.get(name);
    if (!roi) throw new RangeError(`no ROI named ${JSON.stringify(name)}`);
    return roi;
  }

  get diagnostics(): readonly Diagnostic[] {
    return [...this.rois.values()].flatMap((roi) => roi.diagnostics);
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

  dicomVolume(_name: string): DicomVolumeResult | undefined {
    throw new NotImplementedError("dicomVolume is not implemented yet (Phase 5)");
  }
}
