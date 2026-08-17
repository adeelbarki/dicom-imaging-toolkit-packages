import { NotImplementedError } from "../errors.js";
import type { GridGeometry, Mask3D } from "../types.js";

export function cubePhantom(_grid: GridGeometry, _sideMm: number): Mask3D {
  throw new NotImplementedError("cubePhantom is not implemented yet (Phase 2)");
}

export function spherePhantom(_grid: GridGeometry, _radiusMm: number): Mask3D {
  throw new NotImplementedError("spherePhantom is not implemented yet (Phase 2)");
}

/** Encoded three ways (keyhole, XOR, nested) in the contour phase; this is the voxelized ground truth. */
export function torusPhantom(_grid: GridGeometry, _majorRadiusMm: number, _minorRadiusMm: number): Mask3D {
  throw new NotImplementedError("torusPhantom is not implemented yet (Phase 2)");
}

/** Closed-form volumes, checkable independent of any voxelization. */
export const analyticVolumeMm3 = {
  cube(sideMm: number): number {
    return sideMm ** 3;
  },
  sphere(radiusMm: number): number {
    return (4 / 3) * Math.PI * radiusMm ** 3;
  },
  torus(majorRadiusMm: number, minorRadiusMm: number): number {
    return 2 * Math.PI ** 2 * majorRadiusMm * minorRadiusMm ** 2;
  },
};
