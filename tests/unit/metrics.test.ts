import { describe, expect, it } from "vitest";
import { dice, voxelDisagreement, centroidDisplacementMm } from "../../src/metrics.js";
import { createGridGeometry, createUniformGrid } from "../../src/geometry/grid-geometry.js";
import { maskFromDense } from "../../src/mask/mask3d.js";
import { GridMismatchError, FrameOfReferenceMismatchError, IndeterminateCentroidError } from "../../src/errors.js";
import { axialGrid } from "../helpers.js";
import type { Vec3 } from "../../src/types.js";

const emptyMask = (g = axialGrid([0])) => maskFromDense(g, new Uint8Array(g.columns * g.rows * g.planes.length));

function oneVoxelMask(g: ReturnType<typeof axialGrid>, planeIndex = 0) {
  const data = new Uint8Array(g.columns * g.rows * g.planes.length);
  data[planeIndex * g.columns * g.rows] = 1;
  return maskFromDense(g, data);
}

describe("METRIC-001/002: dice() and voxelDisagreement() require equivalent grids", () => {
  it("different pixel spacing (same array dimensions) is rejected, not silently compared", () => {
    const a = createUniformGrid({ rows: 16, columns: 16, planeCount: 4, pixelSpacing: [0.7, 0.7], sliceSpacingMm: 3 });
    const b = createUniformGrid({ rows: 16, columns: 16, planeCount: 4, pixelSpacing: [1.4, 1.4], sliceSpacingMm: 3 });
    expect(() => dice(emptyMask(a), emptyMask(b))).toThrow(GridMismatchError);
    expect(() => voxelDisagreement(emptyMask(a), emptyMask(b))).toThrow(GridMismatchError);
  });

  it("different dimensions is rejected", () => {
    const a = createUniformGrid({ rows: 32, columns: 32, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    const b = createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => dice(emptyMask(a), emptyMask(b))).toThrow(GridMismatchError);
  });

  it("equivalent grids (built independently but geometrically identical) are accepted", () => {
    const a = axialGrid([0, 3, 6]);
    const b = axialGrid([0, 3, 6]);
    expect(() => dice(emptyMask(a), emptyMask(b))).not.toThrow();
  });
});

describe("METRIC-004: centroidDisplacementMm requires a compatible frame of reference", () => {
  const withFor = (frameOfReferenceUID: string): ReturnType<typeof axialGrid> =>
    createGridGeometry({
      rows: 16, columns: 16,
      rowDirection: [1, 0, 0] as Vec3, columnDirection: [0, 1, 0] as Vec3,
      pixelSpacing: [1, 1], planePositions: [[0, 0, 0] as Vec3],
      frameOfReferenceUID,
    });

  it("differing frameOfReferenceUID is rejected even if the numeric coordinates agree", () => {
    const a = oneVoxelMask(withFor("1.2.3"));
    const b = oneVoxelMask(withFor("1.2.4"));
    expect(() => centroidDisplacementMm(a, b)).toThrow(FrameOfReferenceMismatchError);
  });

  it("matching or missing frameOfReferenceUID is not treated as a mismatch", () => {
    const a = oneVoxelMask(withFor("1.2.3"));
    const b = oneVoxelMask(withFor("1.2.3"));
    const c = oneVoxelMask(axialGrid([0]));
    expect(() => centroidDisplacementMm(a, b)).not.toThrow();
    expect(() => centroidDisplacementMm(a, c)).not.toThrow();
  });
});

describe("METRIC-005: an empty mask has no centroid — it must not fabricate [0,0,0]", () => {
  it("comparing an empty mask against a real ROI throws instead of reporting perfect agreement", () => {
    const empty = emptyMask();
    const real = oneVoxelMask(axialGrid([0]));
    expect(() => centroidDisplacementMm(empty, real)).toThrow(IndeterminateCentroidError);
  });

  it("comparing two empty masks also throws, not 0mm displacement", () => {
    expect(() => centroidDisplacementMm(emptyMask(), emptyMask())).toThrow(IndeterminateCentroidError);
  });
});

describe("METRIC-006: centroid weights occupied voxels by physical volume on irregular spacing", () => {
  it("a voxel on a thicker plane pulls the centroid further than an unweighted mean would", () => {
    // plane0 (z=0, end) thickness = 1; plane1 (z=1, middle) thickness = (6-0)/2 = 3.
    // Unweighted mean z of one voxel on each = 0.5. Volume-weighted mean = (0*1+1*3)/4 = 0.75.
    const g = axialGrid([0, 1, 6]);
    const data = new Uint8Array(g.columns * g.rows * g.planes.length);
    data[0 * g.columns * g.rows] = 1; // plane 0, row0 col0 -> patient [0,0,0]
    data[1 * g.columns * g.rows] = 1; // plane 1, row0 col0 -> patient [0,0,1]
    const mask = maskFromDense(g, data);

    const refGrid = axialGrid([0.75]);
    const refData = new Uint8Array(refGrid.columns * refGrid.rows);
    refData[0] = 1; // patient [0,0,0.75] — the expected volume-weighted centroid
    const ref = maskFromDense(refGrid, refData);

    expect(centroidDisplacementMm(mask, ref)).toBeLessThan(1e-9);
  });

  it("on uniform spacing, weighting has no effect (matches the plain count-based mean)", () => {
    const g = axialGrid([0, 1, 2]);
    const data = new Uint8Array(g.columns * g.rows * g.planes.length);
    data[0 * g.columns * g.rows] = 1;
    data[2 * g.columns * g.rows] = 1;
    const mask = maskFromDense(g, data);

    const refGrid = axialGrid([1]);
    const refData = new Uint8Array(refGrid.columns * refGrid.rows);
    refData[0] = 1; // patient [0,0,1] — the simple midpoint
    const ref = maskFromDense(refGrid, refData);

    expect(centroidDisplacementMm(mask, ref)).toBeLessThan(1e-9);
  });
});
