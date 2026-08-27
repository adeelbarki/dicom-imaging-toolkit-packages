import { IndeterminateVolumeError, NotImplementedError, ResourceLimitError } from "../errors.js";
import { dot } from "../geometry/vec3.js";
import type { GridGeometry, Mask3D, VolumeMethod, VolumeResult } from "../types.js";

/** ~268M voxels (1 byte/voxel) — a sane default until callers supply ParserLimits.maxVoxels.
 *  Exported: vectorize.ts reuses the same threshold, since it guards the same underlying
 *  resource (a Mask3D's voxel count) at a second choke point (maskFromDense-built masks
 *  never pass through createEmptyMask's check). */
export const DEFAULT_MAX_VOXELS = 256 * 1024 * 1024;

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`plane index ${index} out of range (length ${arr.length})`);
  return value;
}

/**
 * A Uint8Array silently returns `undefined` for an out-of-range index, and
 * `undefined !== 0` is `true` — so an unvalidated index doesn't just return a wrong voxel,
 * it can fabricate a false "set" result past the end of the buffer entirely.
 */
function validateIndex(name: string, value: number, exclusiveMax: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= exclusiveMax) {
    throw new RangeError(`${name} ${value} out of range [0, ${exclusiveMax - 1}]`);
  }
}

/** Total voxel count as a safe integer, or throws — the multiplication itself can silently
 *  overflow Number.MAX_SAFE_INTEGER for large-but-otherwise-valid dimensions before it's
 *  ever compared against a voxel limit or used to size an allocation. */
function safeVoxelCount(geometry: GridGeometry): number {
  const voxelCount = geometry.columns * geometry.rows * geometry.planes.length;
  if (!Number.isSafeInteger(voxelCount)) {
    throw new ResourceLimitError(
      `grid dimensions ${geometry.columns}x${geometry.rows}x${geometry.planes.length} ` +
        `overflow a safe integer voxel count`,
    );
  }
  return voxelCount;
}

/**
 * Physical thickness attributed to one plane: the average of the distances
 * to its neighbors, or the single neighbor distance at the ends of the
 * stack. For uniformly-spaced grids this is exactly the slice spacing.
 * Callers must ensure planes.length > 1 — the metrics.ts and computeVoxelVolumeMm3
 * call sites both guard the single-plane case before calling this.
 */
export function planeThicknessMm(geometry: GridGeometry, planeIndex: number): number {
  const normal = geometry.normal();
  const planes = geometry.planes;
  const n = planes.length;
  const proj = (i: number) => dot(at(planes, i).position, normal);
  if (planeIndex === 0) return proj(1) - proj(0);
  if (planeIndex === n - 1) return proj(n - 1) - proj(n - 2);
  return (proj(planeIndex + 1) - proj(planeIndex - 1)) / 2;
}

function computeVoxelVolumeMm3(geometry: GridGeometry, buffer: Uint8Array, sliceSize: number): number {
  if (geometry.planes.length === 1) {
    throw new IndeterminateVolumeError(
      "cannot compute voxel volume for a single-plane grid — slice thickness cannot be " +
        "inferred without a second plane to measure spacing from",
    );
  }
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
      validateIndex("column", column, columns);
      validateIndex("row", row, rows);
      validateIndex("plane index", planeIndex, planeCount);
      return buffer[planeIndex * sliceSize + row * columns + column] !== 0;
    },

    getSliceBuffer(planeIndex: number): Uint8Array {
      validateIndex("plane index", planeIndex, planeCount);
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

/** Validates a grid's voxel count against a budget without allocating — the same check
 *  createEmptyMask uses, exposed so other allocation sites (phantom builders) can bound
 *  their own `new Uint8Array(...)` calls BEFORE allocating instead of duplicating this
 *  logic — see SEC-01. */
export function checkVoxelBudget(geometry: GridGeometry, maxVoxels: number = DEFAULT_MAX_VOXELS): number {
  const voxelCount = safeVoxelCount(geometry);
  if (voxelCount > maxVoxels) {
    throw new ResourceLimitError(`grid of ${voxelCount} voxels exceeds the limit of ${maxVoxels}`);
  }
  return voxelCount;
}

/** Bounds allocation BEFORE any buffer is created — see SEC-01. */
export function createEmptyMask(geometry: GridGeometry, maxVoxels: number = DEFAULT_MAX_VOXELS): Mask3D {
  const voxelCount = checkVoxelBudget(geometry, maxVoxels);
  return wrapMask(geometry, new Uint8Array(voxelCount));
}

export function maskFromDense(geometry: GridGeometry, data: Uint8Array): Mask3D {
  const voxelCount = safeVoxelCount(geometry);
  if (data.length !== voxelCount) {
    throw new RangeError(`dense mask data length ${data.length} does not match grid voxel count ${voxelCount}`);
  }
  return wrapMask(geometry, data);
}
