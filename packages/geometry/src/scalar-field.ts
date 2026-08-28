import { checkVoxelBudget, DEFAULT_MAX_VOXELS } from "./mask3d.js";
import type { GridGeometry } from "./types.js";

/**
 * A scalar value per voxel on a {@link GridGeometry} — the numeric counterpart of a
 * boolean {@link Mask3D}. RTDOSE (dose in Gy) and FRACTIONAL DICOM SEG (probability or
 * occupancy in 0..1) are both scalar fields; the histogram machinery in `histogram.ts`
 * treats them identically. Interface, never a class: the storage representation stays
 * internal so a future backing other than a dense `Float32Array` doesn't break callers.
 */
export interface ScalarField3D {
  readonly geometry: GridGeometry;
  /** [columns, rows, planes] */
  readonly dimensions: readonly [number, number, number];
  /** Convenience. NOT the fast path. */
  get(column: number, row: number, planeIndex: number): number;
  /** Bulk access. Length === rows * columns. */
  getSliceBuffer(planeIndex: number): Float32Array;
}

function validateIndex(name: string, value: number, exclusiveMax: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= exclusiveMax) {
    throw new RangeError(`${name} ${value} out of range [0, ${exclusiveMax - 1}]`);
  }
}

function wrapField(geometry: GridGeometry, buffer: Float32Array): ScalarField3D {
  const columns = geometry.columns;
  const rows = geometry.rows;
  const planeCount = geometry.planes.length;
  const sliceSize = columns * rows;

  return {
    geometry,
    dimensions: [columns, rows, planeCount],

    get(column: number, row: number, planeIndex: number): number {
      validateIndex("column", column, columns);
      validateIndex("row", row, rows);
      validateIndex("plane index", planeIndex, planeCount);
      return buffer[planeIndex * sliceSize + row * columns + column] as number;
    },

    getSliceBuffer(planeIndex: number): Float32Array {
      validateIndex("plane index", planeIndex, planeCount);
      const offset = planeIndex * sliceSize;
      return buffer.subarray(offset, offset + sliceSize);
    },
  };
}

/**
 * Builds a `ScalarField3D` on `geometry`. `values` is either a dense `Float32Array` laid
 * out exactly as `getSliceBuffer` expects (plane-major, then row-major within a plane —
 * `planeIndex * rows * columns + row * columns + column`), or a generator called once per
 * voxel. Allocation is bounded by `maxVoxels` BEFORE any buffer is created, the same guard
 * `createEmptyMask` uses (SEC-01).
 */
export function createScalarField(
  geometry: GridGeometry,
  values: Float32Array | ((column: number, row: number, planeIndex: number) => number),
  maxVoxels: number = DEFAULT_MAX_VOXELS,
): ScalarField3D {
  const voxelCount = checkVoxelBudget(geometry, maxVoxels);
  const columns = geometry.columns;
  const rows = geometry.rows;
  const planeCount = geometry.planes.length;
  const sliceSize = columns * rows;

  if (values instanceof Float32Array) {
    if (values.length !== voxelCount) {
      throw new RangeError(
        `scalar field data length ${values.length} does not match grid voxel count ${voxelCount}`,
      );
    }
    return wrapField(geometry, values);
  }

  const buffer = new Float32Array(voxelCount);
  for (let k = 0; k < planeCount; k++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        buffer[k * sliceSize + row * columns + column] = values(column, row, k);
      }
    }
  }
  return wrapField(geometry, buffer);
}
