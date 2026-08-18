import { NotImplementedError } from "../errors.js";
import { add, dot, scale, sub } from "../geometry/vec3.js";
import { maskFromDense } from "../mask/mask3d.js";
import type { GridGeometry, Mask3D, Vec3 } from "../types.js";

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`plane index ${index} out of range (length ${arr.length})`);
  return value;
}

/** The physical center of the grid: mid-extent along rows, columns, and the normal. */
function gridCenter(grid: GridGeometry): Vec3 {
  const normal = grid.normal();
  const planeCount = grid.planes.length;
  const zFirst = dot(at(grid.planes, 0).position, normal);
  const zLast = dot(at(grid.planes, planeCount - 1).position, normal);
  const zCenter = (zFirst + zLast) / 2;

  const p0 = grid.indexToPatient((grid.columns - 1) / 2, (grid.rows - 1) / 2, 0);
  return add(p0, scale(normal, zCenter - dot(p0, normal)));
}

export function cubePhantom(grid: GridGeometry, sideMm: number): Mask3D {
  const half = sideMm / 2;
  const normal = grid.normal();
  const center = gridCenter(grid);
  const planeCount = grid.planes.length;
  const sliceSize = grid.columns * grid.rows;
  const data = new Uint8Array(sliceSize * planeCount);

  for (let k = 0; k < planeCount; k++) {
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const delta = sub(grid.indexToPatient(column, row, k), center);
        const inside =
          Math.abs(dot(delta, grid.rowDirection)) <= half &&
          Math.abs(dot(delta, grid.columnDirection)) <= half &&
          Math.abs(dot(delta, normal)) <= half;
        if (inside) data[k * sliceSize + row * grid.columns + column] = 1;
      }
    }
  }

  return maskFromDense(grid, data);
}

export function spherePhantom(_grid: GridGeometry, _radiusMm: number): Mask3D {
  throw new NotImplementedError("spherePhantom is not implemented yet (Phase 4)");
}

/** Encoded three ways (keyhole, XOR, nested) in the contour phase; this is the voxelized ground truth. */
export function torusPhantom(_grid: GridGeometry, _majorRadiusMm: number, _minorRadiusMm: number): Mask3D {
  throw new NotImplementedError("torusPhantom is not implemented yet (Phase 4)");
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
