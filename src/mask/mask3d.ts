import { NotImplementedError } from "../errors.js";
import type { GridGeometry, Mask3D } from "../types.js";

/** Bounds allocation BEFORE any buffer is created — see SEC-01. */
export function createEmptyMask(_geometry: GridGeometry, _maxVoxels?: number): Mask3D {
  throw new NotImplementedError("createEmptyMask is not implemented yet (Phase 2)");
}

export function maskFromDense(_geometry: GridGeometry, _data: Uint8Array): Mask3D {
  throw new NotImplementedError("maskFromDense is not implemented yet (Phase 2)");
}
