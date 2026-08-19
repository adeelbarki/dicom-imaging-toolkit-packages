/**
 * Comparing two masks on the same grid — e.g. an AI-generated contour
 * against a reference/ground-truth one. Run with: npx tsx examples/03-compare-masks.ts
 */
import { createUniformGrid } from "../src/geometry/grid-geometry.js";
import { spherePhantom } from "../src/phantom/index.js";
import { dice, voxelDisagreement, centroidDisplacementMm } from "../src/metrics.js";

const grid = createUniformGrid({ rows: 64, columns: 64, planeCount: 32, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

// Two spheres, slightly different size and position, standing in for e.g.
// "ground truth" vs. "AI prediction" on the same patient grid.
const reference = spherePhantom(grid, 10);
const predicted = spherePhantom(
  createUniformGrid({ rows: 64, columns: 64, planeCount: 32, pixelSpacing: [1, 1], sliceSpacingMm: 1, origin: [1, 0, 0] }),
  9.5,
);

console.log("Dice:", dice(reference, predicted).toFixed(4));
console.log("voxel disagreement (count):", voxelDisagreement(reference, predicted));
console.log("centroid displacement (mm):", centroidDisplacementMm(reference, predicted).toFixed(3));

// The plan's tiering: large structures gate on Dice + volume error, tiny structures
// (< ~100 voxels) gate on absolute voxel disagreement and centroid displacement instead,
// since Dice is unstable at small voxel counts.
