import { bench, describe } from "vitest";
import { createUniformGrid, spherePhantom } from "rt-geometry-js";
import { readSeg, writeSeg } from "../src/index.js";

// A large multi-slice BINARY SEG: 256 × 256 over 200 frames (the frame count is what
// drives SEG cost — geometry reconstruction from Per-Frame Functional Groups is O(frames),
// and BitArray unpack is O(voxels)). ~13M voxels; the bitstream is ~1.6 MB.
const grid = createUniformGrid({
  rows: 256,
  columns: 256,
  planeCount: 200,
  pixelSpacing: [1.5, 1.5],
  sliceSpacingMm: 1.5,
});

const mask = spherePhantom(grid, 120);
const binaryBytes = writeSeg({
  segmentationType: "BINARY",
  segments: [{ number: 1, label: "sphere", mask }],
});

describe("SEG read path (256²×200 BINARY, 200 frames)", () => {
  bench("readSeg: bytes → Segmentation (geometry from Functional Groups)", () => {
    readSeg(binaryBytes);
  });
  bench("readSeg + seg.mask(1): full BitArray unpack to a dense Mask3D", () => {
    readSeg(binaryBytes).mask(1);
  });
});

describe("SEG write path", () => {
  bench("writeSeg: Mask3D → BINARY SEG bytes (200 frames)", () => {
    writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "sphere", mask }] });
  });
});
