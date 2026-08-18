import { NotImplementedError, ResourceLimitError } from "../errors.js";
import { dot } from "../geometry/vec3.js";
import type { GridGeometry, Mask3D, VolumeMethod, VolumeResult } from "../types.js";

/** ~268M voxels (1 byte/voxel) — a sane default until callers supply ParserLimits.maxVoxels. */
const DEFAULT_MAX_VOXELS = 256 * 1024 * 1024;

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`plane index ${index} out of range (length ${arr.length})`);
  return value;
}

/**
 * Physical thickness attributed to one plane: the average of the distances
 * to its neighbors, or the single neighbor distance at the ends of the
 * stack. For uniformly-spaced grids this is exactly the slice spacing.
 */
function planeThicknessMm(geometry: GridGeometry, planeIndex: number): number {
  const normal = geometry.normal();
  const planes = geometry.planes;
  const n = planes.length;
  const proj = (i: number) => dot(at(planes, i).position, normal);
  if (n === 1) return 0;
  if (planeIndex === 0) return proj(1) - proj(0);
  if (planeIndex === n - 1) return proj(n - 1) - proj(n - 2);
  return (proj(planeIndex + 1) - proj(planeIndex - 1)) / 2;
}

function computeVoxelVolumeMm3(geometry: GridGeometry, buffer: Uint8Array, sliceSize: number): number {
  const areaMm2 = geometry.pixelSpacing[0] * geometry.pixelSpacing[1];
  let total = 0;
  for (let k = 0; k < geometry.planes.length; k++) {
    const offset = k * sliceSize;
    let n = 0;
    for (let i = 0; i < sliceSize; i++) if (buffer[offset + i] !== 0) n++;
    total += n * areaMm2 * planeThicknessMm(geometry, k);
  }
  return total;
}

function wrapMask(geometry: GridGeometry, buffer: Uint8Array): Mask3D {
  const columns = geometry.columns;
  const rows = geometry.rows;
  const planeCount = geometry.planes.length;
  const sliceSize = columns * rows;

  return {
    geometry,
    dimensions: [columns, rows, planeCount],

    get(column: number, row: number, planeIndex: number): boolean {
      return buffer[planeIndex * sliceSize + row * columns + column] !== 0;
    },

    getSliceBuffer(planeIndex: number): Uint8Array {
      const offset = planeIndex * sliceSize;
      return buffer.subarray(offset, offset + sliceSize);
    },

    count(): number {
      let n = 0;
      for (let i = 0; i < buffer.length; i++) if (buffer[i] !== 0) n++;
      return n;
    },

    volume(opts?: { method?: VolumeMethod }): VolumeResult {
      const method = opts?.method ?? "voxel";
      if (method === "contour") {
        throw new NotImplementedError("contour volume method is not implemented yet (Phase 4)");
      }
      return { valueMm3: computeVoxelVolumeMm3(geometry, buffer, sliceSize), method: "voxel" };
    },
  };
}

/** Bounds allocation BEFORE any buffer is created — see SEC-01. */
export function createEmptyMask(geometry: GridGeometry, maxVoxels: number = DEFAULT_MAX_VOXELS): Mask3D {
  const voxelCount = geometry.columns * geometry.rows * geometry.planes.length;
  if (voxelCount > maxVoxels) {
    throw new ResourceLimitError(`grid of ${voxelCount} voxels exceeds the limit of ${maxVoxels}`);
  }
  return wrapMask(geometry, new Uint8Array(voxelCount));
}

export function maskFromDense(geometry: GridGeometry, data: Uint8Array): Mask3D {
  const voxelCount = geometry.columns * geometry.rows * geometry.planes.length;
  if (data.length !== voxelCount) {
    throw new RangeError(`dense mask data length ${data.length} does not match grid voxel count ${voxelCount}`);
  }
  return wrapMask(geometry, data);
}
