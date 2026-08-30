import { bench, describe } from "vitest";
import { createUniformGrid, spherePhantom } from "rt-geometry-js";
import { rasterize } from "../src/contour/rasterize.js";
import { vectorize } from "../src/contour/vectorize.js";

// A structure-set-sized grid with a realistic ROI: a sphere traces one closed contour on
// each of ~60 planes. 256 × 256 × 64 ≈ 4.2M voxels; both paths are O(voxels) for the fill
// and O(boundary) for the trace, so a 512 × 512 × 200 volume scales roughly linearly —
// see docs/PERFORMANCE.md.
const grid = createUniformGrid({
  rows: 256,
  columns: 256,
  planeCount: 64,
  pixelSpacing: [1.5, 1.5],
  sliceSpacingMm: 2,
});

const sphereMask = spherePhantom(grid, 60);
const sphereContours = vectorize(sphereMask);

describe("contour ⇄ mask on a 256²×64 grid", () => {
  bench("vectorize: mask → contours (sphere, ~60 planes)", () => {
    vectorize(sphereMask);
  });
  bench("rasterize: contours → mask (sphere, ~60 planes)", () => {
    rasterize(sphereContours, grid);
  });
});
