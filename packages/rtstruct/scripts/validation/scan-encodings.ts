/**
 * Methodology script for VALIDATION.md's encoding-distribution finding. Scans real
 * RTSTRUCT files for evidence of CLOSEDPLANAR_XOR and keyhole/self-touching CLOSED_PLANAR
 * encodings in the wild. Neither is discoverable via TCIA's series metadata (no "encoding
 * style" field), so this reads the raw ContourGeometricType tag and contour point
 * geometry directly.
 *
 * XOR detection is exact: literal ContourGeometricType == "CLOSEDPLANAR_XOR".
 *
 * Keyhole detection: a keyhole contour walks a channel out to an inner boundary and back
 * along the same path, so it revisits a coordinate it already visited earlier in the SAME
 * contour, non-adjacently. Flags an EXACT (bit-identical, distance == 0) coordinate
 * revisit as the strong signal — verified by hand against one real example (see
 * VALIDATION.md): two point-pairs bit-identical, with a complete separate inner loop
 * traced between them. A "near but not exact" revisit is reported separately and is much
 * weaker — easily produced by coincidence on any dense, near-circular contour.
 *
 * Run with: npx tsx scripts/validation/scan-encodings.ts <folder> [folder2] [folder3] ...
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { readDicomDataset } from "../../src/dicom/port.js";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function findRtstructFiles(dir: string): { path: string; bytes: ArrayBuffer }[] {
  const out: { path: string; bytes: ArrayBuffer }[] = [];
  for (const file of readdirSync(dir)) {
    if (extname(file).toLowerCase() !== ".dcm" && file.includes(".")) continue;
    const path = join(dir, file);
    const bytes = toArrayBuffer(readFileSync(path));
    try {
      const { naturalized } = readDicomDataset(bytes);
      if (naturalized["StructureSetROISequence"] !== undefined) out.push({ path, bytes });
    } catch {
      // not readable DICOM, skip
    }
  }
  return out;
}

function selfRevisitKind(
  points: readonly [number, number, number][],
  epsilonMm = 0.05,
): "exact" | "near" | "none" {
  let sawNear = false;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 3; j < points.length; j++) {
      const [ax, ay, az] = points[i]!;
      const [bx, by, bz] = points[j]!;
      const d = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
      if (d === 0) return "exact";
      if (d < epsilonMm) sawNear = true;
    }
  }
  return sawNear ? "near" : "none";
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: npx tsx scripts/validation/scan-encodings.ts <folder> [folder2] ...");
  process.exit(1);
}

let totalFiles = 0;
let totalContours = 0;
let xorCount = 0;
let exactRevisits = 0;
let nearRevisits = 0;

for (const dir of dirs) {
  const rtstructFiles = findRtstructFiles(dir);
  for (const { path, bytes } of rtstructFiles) {
    totalFiles++;
    const { naturalized } = readDicomDataset(bytes);
    const roiContourSequence = (naturalized["ROIContourSequence"] as readonly Record<string, unknown>[] | undefined) ?? [];
    for (const item of roiContourSequence) {
      const contourSequence = (item["ContourSequence"] as readonly Record<string, unknown>[] | undefined) ?? [];
      for (const c of contourSequence) {
        totalContours++;
        const type = c["ContourGeometricType"] as string | undefined;
        if (type === "CLOSEDPLANAR_XOR") {
          xorCount++;
          console.log(`XOR      ${path} (ReferencedROINumber ${item["ReferencedROINumber"]})`);
        }
        if (type === "CLOSED_PLANAR") {
          const flat = (c["ContourData"] as readonly number[] | undefined) ?? [];
          if (flat.length % 3 !== 0) continue;
          const points: [number, number, number][] = [];
          for (let i = 0; i + 2 < flat.length; i += 3) points.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
          if (points.length >= 6) {
            const kind = selfRevisitKind(points);
            if (kind === "exact") {
              exactRevisits++;
              console.log(`KEYHOLE-EXACT ${path} (ReferencedROINumber ${item["ReferencedROINumber"]}, ${points.length} points) — a coordinate is revisited exactly, non-adjacently`);
            } else if (kind === "near") {
              nearRevisits++;
            }
          }
        }
      }
    }
  }
}

console.log(`\n=== summary ===`);
console.log(`RTSTRUCT files scanned: ${totalFiles}`);
console.log(`total contours scanned: ${totalContours}`);
console.log(`CLOSEDPLANAR_XOR contours found: ${xorCount}`);
console.log(`keyhole candidates, EXACT self-revisit (strong signal): ${exactRevisits}`);
console.log(`keyhole candidates, near (<0.05mm) self-revisit only (weak, likely coincidental on dense contours): ${nearRevisits}`);
