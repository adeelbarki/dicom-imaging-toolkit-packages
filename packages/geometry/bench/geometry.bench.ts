import { bench, describe } from "vitest";
import { createUniformGrid } from "../src/grid-geometry.js";
import { createScalarField } from "../src/scalar-field.js";
import { resampleField } from "../src/resample.js";
import { histogram, valueAtVolumeFraction, volumeAboveThreshold } from "../src/histogram.js";
import { dice, voxelDisagreement } from "../src/metrics.js";
import { distanceTransformMm, dilateMm } from "../src/morphology.js";
import { union } from "../src/mask-ops.js";
import { connectedComponents } from "../src/connected-components.js";
import { spherePhantom } from "../src/phantom.js";

// A mid-size structure grid: 256 × 256 × 64 ≈ 4.2M voxels. Every per-voxel operation
// below is O(voxels), so a 512 × 512 × 200 volume (≈ 52M, 12.5×) scales the numbers
// roughly linearly — see docs/PERFORMANCE.md. A dense Uint8Array mask over this grid is
// ~4 MB; a Float32Array scalar field is ~17 MB.
const structureGrid = createUniformGrid({
  rows: 256,
  columns: 256,
  planeCount: 64,
  pixelSpacing: [1.5, 1.5],
  sliceSpacingMm: 2,
});

// A coarser "dose" grid over the same extent (offset origin, different spacing) so every
// resampled voxel actually interpolates rather than hitting a source voxel centre.
const doseGrid = createUniformGrid({
  rows: 110,
  columns: 110,
  planeCount: 44,
  pixelSpacing: [3.5, 3.5],
  sliceSpacingMm: 3,
  origin: [0.3, -0.4, 1.1],
});
const doseField = createScalarField(
  doseGrid,
  (c, r, k) => 60 * Math.exp(-((c - 55) ** 2 + (r - 55) ** 2) / 1200) - k * 0.1,
);

const sphereA = spherePhantom(structureGrid, 60);
const sphereB = spherePhantom(structureGrid, 58);
const structureField = resampleField(doseField, structureGrid, { outOfBounds: 0 });

describe("resampling (dose → structure grid, trilinear)", () => {
  bench("resampleField dose(110²×44) → structure(256²×64)", () => {
    resampleField(doseField, structureGrid, { outOfBounds: 0 });
  });
});

describe("histogram / DVH engine over a 4.2M-voxel field", () => {
  bench("histogram(field, sphereMask, 256 bins)", () => {
    histogram(structureField, sphereA, { bins: 256 });
  });
  bench("valueAtVolumeFraction (D95-style)", () => {
    valueAtVolumeFraction(structureField, sphereA, 0.95);
  });
  bench("volumeAboveThreshold (V20-style)", () => {
    volumeAboveThreshold(structureField, sphereA, 20);
  });
});

describe("comparison metrics (256²×64 masks)", () => {
  bench("dice(sphereA, sphereB)", () => {
    dice(sphereA, sphereB);
  });
  bench("voxelDisagreement(sphereA, sphereB)", () => {
    voxelDisagreement(sphereA, sphereB);
  });
});

describe("phantom rasterization", () => {
  bench("spherePhantom r=60 on 256²×64", () => {
    spherePhantom(structureGrid, 60);
  });
});

describe("mask operations (256²×64)", () => {
  bench("union(sphereA, sphereB)", () => {
    union(sphereA, sphereB);
  });
  bench("distanceTransformMm(sphereA) — exact anisotropic EDT", () => {
    distanceTransformMm(sphereA);
  });
  bench("dilateMm(sphereA, 5)", () => {
    dilateMm(sphereA, 5);
  });
  bench("connectedComponents(sphereA, 26)", () => {
    connectedComponents(sphereA, { connectivity: 26 });
  });
});
