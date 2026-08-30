import { GridMismatchError } from "./errors.js";
import { createGridGeometry } from "./grid-geometry.js";
import { maskFromDense } from "./mask3d.js";
import type { GridTolerance, Mask3D } from "./types.js";

/** Index-by-index combination is only meaningful when both masks are on the same grid. */
function assertSameGrid(a: Mask3D, b: Mask3D, tolerance: GridTolerance | undefined): void {
  if (!a.geometry.equals(b.geometry, tolerance)) {
    throw new GridMismatchError(
      "mask operation requires both masks on equivalent grids (dimensions, spacing, " +
        "orientation, plane positions, or frame of reference differ)",
    );
  }
}

type Combine = (av: number, bv: number) => number;

function combine(a: Mask3D, b: Mask3D, tolerance: GridTolerance | undefined, fn: Combine): Mask3D {
  assertSameGrid(a, b, tolerance);
  const [columns, rows, planes] = a.dimensions;
  const out = new Uint8Array(columns * rows * planes);
  for (let k = 0; k < planes; k++) {
    const sa = a.getSliceBuffer(k);
    const sb = b.getSliceBuffer(k);
    const base = k * columns * rows;
    for (let i = 0; i < sa.length; i++) {
      out[base + i] = fn(sa[i] as number, sb[i] as number);
    }
  }
  return maskFromDense(a.geometry, out);
}

/** Voxels set in `a` **or** `b`. */
export function union(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): Mask3D {
  return combine(a, b, tolerance, (av, bv) => (av !== 0 || bv !== 0 ? 1 : 0));
}

/** Voxels set in `a` **and** `b`. */
export function intersection(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): Mask3D {
  return combine(a, b, tolerance, (av, bv) => (av !== 0 && bv !== 0 ? 1 : 0));
}

/** Voxels set in `a` but **not** `b` (`a \ b`). */
export function subtract(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): Mask3D {
  return combine(a, b, tolerance, (av, bv) => (av !== 0 && bv === 0 ? 1 : 0));
}

/** Voxels set in exactly one of `a`, `b` (symmetric difference). */
export function xor(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): Mask3D {
  return combine(a, b, tolerance, (av, bv) => ((av !== 0) !== (bv !== 0) ? 1 : 0));
}

/** Voxels **not** set in `a`, on the same grid. */
export function complement(a: Mask3D): Mask3D {
  const [columns, rows, planes] = a.dimensions;
  const out = new Uint8Array(columns * rows * planes);
  for (let k = 0; k < planes; k++) {
    const sa = a.getSliceBuffer(k);
    const base = k * columns * rows;
    for (let i = 0; i < sa.length; i++) out[base + i] = sa[i] === 0 ? 1 : 0;
  }
  return maskFromDense(a.geometry, out);
}

/** Inclusive index box `[min, max]` in `[column, row, planeIndex]`. */
export interface IndexBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The tight index-space bounding box of the set voxels, or `null` for an empty mask. */
export function boundingBox(mask: Mask3D): IndexBox | null {
  const [columns, rows, planes] = mask.dimensions;
  let minC = Infinity;
  let minR = Infinity;
  let minK = Infinity;
  let maxC = -Infinity;
  let maxR = -Infinity;
  let maxK = -Infinity;
  for (let k = 0; k < planes; k++) {
    const s = mask.getSliceBuffer(k);
    for (let r = 0; r < rows; r++) {
      const rowBase = r * columns;
      for (let c = 0; c < columns; c++) {
        if (s[rowBase + c] === 0) continue;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (k < minK) minK = k;
        if (k > maxK) maxK = k;
      }
    }
  }
  if (maxK < 0) return null;
  return { min: [minC, minR, minK], max: [maxC, maxR, maxK] };
}

/**
 * A new `Mask3D` restricted to `box`, on a sub-grid whose origin and plane subset match.
 * The physical location of every kept voxel is unchanged (row/column directions, pixel
 * spacing, and the plane positions are all preserved). `box` defaults to the mask's own
 * `boundingBox()`; cropping an empty mask with no `box` throws.
 */
export function crop(mask: Mask3D, box?: IndexBox): Mask3D {
  const [columns, rows, planes] = mask.dimensions;
  const b = box ?? boundingBox(mask);
  if (b === null) {
    throw new RangeError("cannot crop an empty mask to its bounding box — there is nothing to bound");
  }
  const [minC, minR, minK] = b.min;
  const [maxC, maxR, maxK] = b.max;
  if (
    !Number.isInteger(minC) || !Number.isInteger(minR) || !Number.isInteger(minK) ||
    !Number.isInteger(maxC) || !Number.isInteger(maxR) || !Number.isInteger(maxK) ||
    minC < 0 || minR < 0 || minK < 0 ||
    maxC >= columns || maxR >= rows || maxK >= planes ||
    maxC < minC || maxR < minR || maxK < minK
  ) {
    throw new RangeError(
      `crop box [${b.min}]..[${b.max}] is out of range or inverted for a ${columns}x${rows}x${planes} mask`,
    );
  }

  const g = mask.geometry;
  const newColumns = maxC - minC + 1;
  const newRows = maxR - minR + 1;
  const planePositions = [];
  for (let k = minK; k <= maxK; k++) planePositions.push(g.indexToPatient(minC, minR, k));

  const subGrid = createGridGeometry({
    rows: newRows,
    columns: newColumns,
    rowDirection: g.rowDirection,
    columnDirection: g.columnDirection,
    pixelSpacing: g.pixelSpacing,
    planePositions,
    ...(g.frameOfReferenceUID !== undefined ? { frameOfReferenceUID: g.frameOfReferenceUID } : {}),
  });

  const out = new Uint8Array(newColumns * newRows * planePositions.length);
  for (let k = minK; k <= maxK; k++) {
    const src = mask.getSliceBuffer(k);
    const dstBase = (k - minK) * newColumns * newRows;
    for (let r = minR; r <= maxR; r++) {
      const srcRow = r * columns;
      const dstRow = dstBase + (r - minR) * newColumns;
      for (let c = minC; c <= maxC; c++) {
        if (src[srcRow + c] !== 0) out[dstRow + (c - minC)] = 1;
      }
    }
  }
  return maskFromDense(subGrid, out);
}

/** Per-axis margins in voxels, `[column, row, plane]`. A single number applies to all three. */
export type Margin = number | readonly [number, number, number];

/**
 * A new `Mask3D` on a grid grown by `margin` voxels on every side, the original mask
 * placed in the centre and the border zero-filled. Column/row padding shifts the in-plane
 * origin; **plane** padding requires a uniformly-spaced grid (new plane positions are
 * extrapolated at the stack's spacing) — a non-uniform grid throws.
 */
export function pad(mask: Mask3D, margin: Margin): Mask3D {
  const [mc, mr, mk] = typeof margin === "number" ? [margin, margin, margin] : margin;
  for (const [name, v] of [["column", mc], ["row", mr], ["plane", mk]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} margin must be a non-negative integer, got ${v}`);
  }

  const g = mask.geometry;
  const [columns, rows, planes] = mask.dimensions;

  if (mk > 0 && (planes < 2 || !g.isUniformlySpaced())) {
    throw new RangeError(
      "plane-axis padding requires a uniformly-spaced grid with at least two planes — " +
        "extrapolating plane positions otherwise would fabricate geometry. Pad only " +
        "column/row, or resample first.",
    );
  }

  const newColumns = columns + 2 * mc;
  const newRows = rows + 2 * mr;
  const newPlaneCount = planes + 2 * mk;

  // Origin of the padded grid: the physical point that becomes its (0,0) on plane 0.
  // Move -mc columns and -mr rows in-plane from the source plane-0 origin, and -mk planes
  // along the normal at the (uniform) spacing.
  const spacingAlongNormal = planes >= 2 ? g.planeThicknessMm(0) : 0;
  const n = g.normal();
  const planePositions = [];
  for (let k = 0; k < newPlaneCount; k++) {
    const srcK = k - mk; // may be negative or >= planes
    const inPlane = g.indexToPatient(-mc, -mr, Math.min(Math.max(srcK, 0), planes - 1));
    const deltaPlanes = srcK - Math.min(Math.max(srcK, 0), planes - 1);
    planePositions.push([
      inPlane[0] + n[0] * deltaPlanes * spacingAlongNormal,
      inPlane[1] + n[1] * deltaPlanes * spacingAlongNormal,
      inPlane[2] + n[2] * deltaPlanes * spacingAlongNormal,
    ] as const);
  }

  const grownGrid = createGridGeometry({
    rows: newRows,
    columns: newColumns,
    rowDirection: g.rowDirection,
    columnDirection: g.columnDirection,
    pixelSpacing: g.pixelSpacing,
    planePositions: planePositions.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
    ...(g.frameOfReferenceUID !== undefined ? { frameOfReferenceUID: g.frameOfReferenceUID } : {}),
  });

  const out = new Uint8Array(newColumns * newRows * newPlaneCount);
  for (let k = 0; k < planes; k++) {
    const src = mask.getSliceBuffer(k);
    const dstBase = (k + mk) * newColumns * newRows;
    for (let r = 0; r < rows; r++) {
      const srcRow = r * columns;
      const dstRow = dstBase + (r + mr) * newColumns + mc;
      for (let c = 0; c < columns; c++) if (src[srcRow + c] !== 0) out[dstRow + c] = 1;
    }
  }
  return maskFromDense(grownGrid, out);
}
