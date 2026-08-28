/**
 * The core workflow: mask -> real DICOM RTSTRUCT bytes -> mask.
 * Run with: npx tsx examples/02-dicom-roundtrip.ts
 */
import { createUniformGrid } from "rt-geometry-js";
import { spherePhantom } from "rt-geometry-js";
import { RTStruct } from "../src/index.js";
import { dice } from "rt-geometry-js";

const grid = createUniformGrid({ rows: 64, columns: 64, planeCount: 32, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
const original = spherePhantom(grid, 10);

// Write: mask -> DICOM Part10 bytes (an ArrayBuffer you could write to a .dcm file).
const bytes = await RTStruct.createFromMask({ mask: original, name: "Sphere" });
console.log(`wrote ${bytes.byteLength} bytes of DICOM`);

// Read: DICOM bytes -> RTStruct. `geometry` is the grid to rasterize contours onto —
// normally the geometry of the image series the RTSTRUCT references.
const rt = await RTStruct.load({ rtstruct: bytes, geometry: grid });

console.log("ROI names:", rt.getROINames());
console.log("all diagnostics (document + per-ROI):", rt.diagnostics);

const roi = rt.roi("Sphere");
console.log("ROI number:", roi.roiNumber, "interpretedType:", roi.interpretedType);
console.log("provenance:", roi.provenance);

const roundTripped = rt.getMask("Sphere");
console.log("round-trip Dice score:", dice(original, roundTripped).toFixed(4));

// Rasterization is lossy (sub-pixel vertices get quantized away), so this is the
// gate the whole library is validated against: mask -> RTSTRUCT -> mask, never the reverse.
