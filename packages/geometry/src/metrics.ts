import { GridMismatchError, FrameOfReferenceMismatchError, IndeterminateCentroidError } from "./errors.js";
import { distance } from "./vec3.js";
import { planeThicknessMm } from "./grid-geometry.js";
import type { GridTolerance, Mask3D, Vec3 } from "./types.js";

/** Throws unless both masks share a GridGeometry — index-by-index comparison is only
 *  meaningful on the same grid; matching array dimensions is not sufficient (two grids can
 *  have identical rows/columns/planeCount and still represent different physical spacing). */
function assertSameGrid(a: Mask3D, b: Mask3D, tolerance: GridTolerance | undefined): void {
  if (!a.geometry.equals(b.geometry, tolerance)) {
    throw new GridMismatchError(
      "masks are not on equivalent grids (dimensions, spacing, orientation, plane " +
        "positions, or frame of reference differ) — index-by-index comparison is not " +
        "meaningful across different grids",
    );
  }
}

/** Throws unless both masks are anchored to the same coordinate space. Unlike
 *  assertSameGrid, this doesn't require identical resolution — only that a patient-space
 *  coordinate means the same physical location on both sides. Either side missing a
 *  frameOfReferenceUID is not treated as a mismatch (the common case for synthetic grids). */
function assertCompatibleFrame(a: Mask3D, b: Mask3D): void {
  const forA = a.geometry.frameOfReferenceUID;
  const forB = b.geometry.frameOfReferenceUID;
  if (forA !== undefined && forB !== undefined && forA !== forB) {
    throw new FrameOfReferenceMismatchError(
      `cannot compare patient-space coordinates across different frames of reference ` +
        `("${forA}" vs "${forB}") — numeric agreement would be coincidental, not meaningful`,
    );
  }
}

/** Volume centroid, voxels weighted by the physical volume they represent. On a uniformly-
 *  spaced grid every plane has the same thickness, so this reduces to a simple mean; on an
 *  irregularly-spaced grid (a plane with 5mm of territory vs. a neighbor with 1mm) an
 *  unweighted mean would silently under/over-count each occupied voxel's true contribution. */
function centroidMm(mask: Mask3D): Vec3 {
  const grid = mask.geometry;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let totalWeight = 0;
  let n = 0;
  for (let planeIndex = 0; planeIndex < grid.planes.length; planeIndex++) {
    const weight = grid.planes.length === 1 ? 1 : planeThicknessMm(grid, planeIndex);
    const buffer = mask.getSliceBuffer(planeIndex);
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        if (buffer[row * grid.columns + column] === 0) continue;
        const p = grid.indexToPatient(column, row, planeIndex);
        sx += p[0] * weight;
        sy += p[1] * weight;
        sz += p[2] * weight;
        totalWeight += weight;
        n++;
      }
    }
  }
  if (n === 0) {
    throw new IndeterminateCentroidError(
      "cannot compute a centroid for an empty mask — there is no ROI to locate, and " +
        "[0,0,0] would be a fabricated patient coordinate indistinguishable from a real " +
        "ROI centered at the origin",
    );
  }
  return [sx / totalWeight, sy / totalWeight, sz / totalWeight];
}

export function dice(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): number {
  assertSameGrid(a, b, tolerance);
  let intersection = 0;
  let countA = 0;
  let countB = 0;
  const planeCount = a.dimensions[2];
  for (let planeIndex = 0; planeIndex < planeCount; planeIndex++) {
    const ba = a.getSliceBuffer(planeIndex);
    const bb = b.getSliceBuffer(planeIndex);
    for (let i = 0; i < ba.length; i++) {
      const va = ba[i] !== 0;
      const vb = bb[i] !== 0;
      if (va) countA++;
      if (vb) countB++;
      if (va && vb) intersection++;
    }
  }
  return countA + countB === 0 ? 1 : (2 * intersection) / (countA + countB);
}

export function voxelDisagreement(a: Mask3D, b: Mask3D, tolerance?: GridTolerance): number {
  assertSameGrid(a, b, tolerance);
  let disagreement = 0;
  const planeCount = a.dimensions[2];
  for (let planeIndex = 0; planeIndex < planeCount; planeIndex++) {
    const ba = a.getSliceBuffer(planeIndex);
    const bb = b.getSliceBuffer(planeIndex);
    for (let i = 0; i < ba.length; i++) {
      if ((ba[i] !== 0) !== (bb[i] !== 0)) disagreement++;
    }
  }
  return disagreement;
}

export function centroidDisplacementMm(a: Mask3D, b: Mask3D): number {
  assertCompatibleFrame(a, b);
  return distance(centroidMm(a), centroidMm(b));
}

export interface Centroid {
  /** Continuous `[column, row, planeIndex]` — the mean voxel index (plane axis weighted
   *  by plane thickness on an irregular grid, so it is not a plain index mean there). */
  readonly index: Vec3;
  /** The same point in patient space (mm). */
  readonly patientMm: Vec3;
}

/**
 * The volume centroid of a single mask, in both index and patient space. Voxels are
 * weighted by the physical volume they represent (see {@link centroidDisplacementMm}).
 * Throws {@link IndeterminateCentroidError} for an empty mask — `[0,0,0]` would be
 * indistinguishable from a real ROI at the origin.
 */
export function centroid(mask: Mask3D): Centroid {
  const grid = mask.geometry;
  let sc = 0;
  let sr = 0;
  let sk = 0;
  let totalWeight = 0;
  let n = 0;
  for (let planeIndex = 0; planeIndex < grid.planes.length; planeIndex++) {
    const weight = grid.planes.length === 1 ? 1 : planeThicknessMm(grid, planeIndex);
    const buffer = mask.getSliceBuffer(planeIndex);
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        if (buffer[row * grid.columns + column] === 0) continue;
        sc += column * weight;
        sr += row * weight;
        sk += planeIndex * weight;
        totalWeight += weight;
        n++;
      }
    }
  }
  if (n === 0) {
    throw new IndeterminateCentroidError(
      "cannot compute a centroid for an empty mask — there is no ROI to locate",
    );
  }
  const index: Vec3 = [sc / totalWeight, sr / totalWeight, sk / totalWeight];
  return { index, patientMm: centroidMm(mask) };
}
