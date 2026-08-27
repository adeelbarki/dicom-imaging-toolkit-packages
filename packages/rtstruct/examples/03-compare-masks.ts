/**
 * Comparing two masks on the same grid — e.g. an AI-generated contour
 * against a reference/ground-truth one. Run with: npx tsx examples/03-compare-masks.ts
 */
import { createUniformGrid } from "../src/geometry/grid-geometry.js";
import { spherePhantom } from "../src/phantom/index.js";
import { maskFromDense } from "../src/mask/mask3d.js";
import { distance } from "../src/geometry/vec3.js";
import { dice, voxelDisagreement, centroidDisplacementMm } from "../src/metrics.js";
import type { GridGeometry, Mask3D, Vec3 } from "../src/types.js";

const grid = createUniformGrid({ rows: 64, columns: 64, planeCount: 32, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

/**
 * dice()/voxelDisagreement() require both masks on the same GridGeometry — comparing
 * masks built from two different grid objects, even with identical dimensions, is exactly
 * the METRIC-001 bug (same array indices can represent different physical locations).
 * To demonstrate a spatial offset without violating that, paint a sphere at an arbitrary
 * physical center directly onto the shared grid, rather than shifting the grid itself.
 */
function spherePhantomAt(g: GridGeometry, center: Vec3, radiusMm: number): Mask3D {
  const sliceSize = g.columns * g.rows;
  const data = new Uint8Array(sliceSize * g.planes.length);
  for (let k = 0; k < g.planes.length; k++) {
    for (let row = 0; row < g.rows; row++) {
      for (let column = 0; column < g.columns; column++) {
        if (distance(g.indexToPatient(column, row, k), center) <= radiusMm) {
          data[k * sliceSize + row * g.columns + column] = 1;
        }
      }
    }
  }
  return maskFromDense(g, data);
}

// Two spheres, slightly different size and position, standing in for e.g.
// "ground truth" vs. "AI prediction" on the same patient grid.
const reference = spherePhantom(grid, 10);
const center = grid.indexToPatient((grid.columns - 1) / 2, (grid.rows - 1) / 2, Math.floor(grid.planes.length / 2));
const predicted = spherePhantomAt(grid, [center[0] + 1, center[1], center[2]], 9.5);

console.log("Dice:", dice(reference, predicted).toFixed(4));
console.log("voxel disagreement (count):", voxelDisagreement(reference, predicted));
console.log("centroid displacement (mm):", centroidDisplacementMm(reference, predicted).toFixed(3));

// The plan's tiering: large structures gate on Dice + volume error, tiny structures
// (< ~100 voxels) gate on absolute voxel disagreement and centroid displacement instead,
// since Dice is unstable at small voxel counts.
