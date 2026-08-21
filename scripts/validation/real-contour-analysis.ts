/**
 * Methodology script for VALIDATION.md's round-trip and point-count findings. Against a
 * folder containing a real image series plus one real RTSTRUCT:
 * 1. Real-contour round trip: load real RTSTRUCT -> mask1 -> createFromMask -> reload ->
 *    mask2 -> compare. Exercises the write path on real, large, genuinely multi-hole
 *    anatomy, not just a phantom sphere.
 * 2. Point-count ratio: original ContourData point count vs. what vectorize() emits for
 *    the same mask. See VALIDATION.md for the caveat on what this ratio actually measures
 *    (post-quantization vs. pre-quantization geometry, not vectorizer "efficiency").
 *
 * Run with: npx tsx scripts/validation/real-contour-analysis.ts <folder>
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { readDicomDataset, readRTStruct } from "../../src/dicom/port.js";
import { readSeriesGeometry } from "../../src/dicom/series-geometry.js";
import { RTStruct } from "../../src/index.js";
import { vectorize } from "../../src/contour/vectorize.js";
import { dice, voxelDisagreement } from "../../src/metrics.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/validation/real-contour-analysis.ts /path/to/folder");
  process.exit(1);
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const files = readdirSync(dir).filter((f) => extname(f).toLowerCase() === ".dcm" || !f.includes("."));
const imageBytes: ArrayBuffer[] = [];
let rtstructBytes: ArrayBuffer | undefined;
for (const file of files) {
  const bytes = toArrayBuffer(readFileSync(join(dir, file)));
  try {
    const { naturalized } = readDicomDataset(bytes);
    if (naturalized["StructureSetROISequence"] !== undefined) rtstructBytes = bytes;
    else if (naturalized["Rows"] !== undefined && naturalized["ImagePositionPatient"] !== undefined) imageBytes.push(bytes);
  } catch {
    // skip
  }
}
if (!rtstructBytes || imageBytes.length === 0) {
  console.error("need both an image series and an RTSTRUCT in this folder");
  process.exit(1);
}

const { geometry } = readSeriesGeometry(imageBytes);
const grid = geometry.grid;

// Original, as-authored contour point counts (before our library touches them at all).
const parsed = readRTStruct(rtstructBytes);

console.log(`=== ${dir} ===`);
const rt = await RTStruct.load({ rtstruct: rtstructBytes, geometry: grid });

for (const roi of parsed.rois) {
  const originalPoints = roi.contours.reduce((sum, c) => sum + c.points.length, 0);
  if (originalPoints === 0) continue;

  const mask1 = rt.getMask(roi.roiNumber);

  // Point-count ratio: what would OUR vectorizer emit for this same mask?
  const ourContours = vectorize(mask1);
  const ourPoints = ourContours.reduce((sum, c) => sum + c.points.length, 0);
  const ratio = ourPoints / originalPoints;

  // Real-contour round trip: mask1 -> write -> reload -> mask2.
  const bytes2 = await RTStruct.createFromMask({ mask: mask1, name: roi.name });
  const rt2 = await RTStruct.load({ rtstruct: bytes2, geometry: grid });
  const mask2 = rt2.getMask(roi.name);

  console.log(`\nROI ${roi.roiNumber} "${roi.name}":`);
  console.log(`  original contour points (as authored):        ${originalPoints}`);
  console.log(`  our vectorize() points for the same mask:      ${ourPoints}  (${ratio.toFixed(2)}x)`);
  console.log(`  round-trip Dice (mask1 vs mask1->write->mask2): ${dice(mask1, mask2).toFixed(6)}`);
  console.log(`  round-trip voxel disagreement:                  ${voxelDisagreement(mask1, mask2)}`);
}
