/**
 * Build a sampling grid, generate a phantom on it, and inspect the mask
 * directly — no DICOM involved yet. Run with: npx tsx examples/01-build-and-inspect-mask.ts
 */
import { createUniformGrid } from "rt-geometry-js";
import { spherePhantom, analyticVolumeMm3 } from "rt-geometry-js";

const grid = createUniformGrid({
  rows: 64,
  columns: 64,
  planeCount: 32,
  pixelSpacing: [1, 1], // [row spacing mm, column spacing mm]
  sliceSpacingMm: 1,
});

const radiusMm = 10;
const mask = spherePhantom(grid, radiusMm);

console.log("dimensions [columns, rows, planes]:", mask.dimensions);
console.log("filled voxels:", mask.count());

const voxelVolume = mask.volume(); // { valueMm3, method: "voxel" }
const analyticVolume = analyticVolumeMm3.sphere(radiusMm);
const errorPct = (Math.abs(voxelVolume.valueMm3 - analyticVolume) / analyticVolume) * 100;

console.log(`voxel volume:    ${voxelVolume.valueMm3.toFixed(1)} mm3 (method: ${voxelVolume.method})`);
console.log(`analytic volume: ${analyticVolume.toFixed(1)} mm3`);
console.log(`error:           ${errorPct.toFixed(2)}%`);

// Per-slice access, e.g. for rendering: a flat Uint8Array, length rows * columns.
const midPlane = mask.getSliceBuffer(16);
console.log("mid-plane buffer length:", midPlane.length, "nonzero:", midPlane.filter((v) => v !== 0).length);
