import { NotImplementedError } from "./errors.js";
import type {
  Diagnostic,
  DicomVolumeResult,
  GridGeometry,
  LoadOptions,
  Mask3D,
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

/** The public entry point (IMPLEMENTATION_PLAN.md section 1). Phase 5 wires this to dicom/port.ts. */
export class RTStructImpl {
  private constructor() {}

  static async load(_params: LoadParams): Promise<RTStructImpl> {
    throw new NotImplementedError("RTStructImpl.load is not implemented yet (Phase 5)");
  }

  static async createFromMask(_params: CreateFromMaskParams): Promise<ArrayBuffer> {
    throw new NotImplementedError("RTStructImpl.createFromMask is not implemented yet (Phase 5)");
  }

  get diagnostics(): readonly Diagnostic[] {
    throw new NotImplementedError("diagnostics is not implemented yet (Phase 5)");
  }

  getROINames(): readonly string[] {
    throw new NotImplementedError("getROINames is not implemented yet (Phase 5)");
  }

  roi(_name: string): RoiHandle {
    throw new NotImplementedError("roi is not implemented yet (Phase 5)");
  }

  getMask(_name: string): Mask3D {
    throw new NotImplementedError("getMask is not implemented yet (Phase 5)");
  }

  getMaskSlice(_name: string, _planeIndex: number): Uint8Array {
    throw new NotImplementedError("getMaskSlice is not implemented yet (Phase 5)");
  }

  dicomVolume(_name: string): DicomVolumeResult | undefined {
    throw new NotImplementedError("dicomVolume is not implemented yet (Phase 5)");
  }
}
