import { NotImplementedError } from "./errors.js";
import type { Mask3D } from "./types.js";

export function dice(_a: Mask3D, _b: Mask3D): number {
  throw new NotImplementedError("dice is not implemented yet (Phase 4)");
}

export function voxelDisagreement(_a: Mask3D, _b: Mask3D): number {
  throw new NotImplementedError("voxelDisagreement is not implemented yet (Phase 4)");
}

export function centroidDisplacementMm(_a: Mask3D, _b: Mask3D): number {
  throw new NotImplementedError("centroidDisplacementMm is not implemented yet (Phase 4)");
}
