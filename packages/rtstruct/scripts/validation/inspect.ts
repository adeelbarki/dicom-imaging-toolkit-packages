/**
 * Point this at a folder of real .dcm files (a CT/MR series, optionally with one or
 * more RTSTRUCT files mixed in) and it reports what the library sees. Methodology
 * script for VALIDATION.md — see that file for the findings this produced.
 *
 * Run with: npx tsx scripts/validation/inspect.ts /path/to/folder
 *
 * Not library example code — nothing here is re-exported or part of the public API.
 * It imports from src/dicom/port.ts directly (the way tests/fixtures.ts does), which
 * index.ts deliberately never re-exports.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { readDicomDataset } from "../../src/dicom/port.js";
import { readSeriesGeometry } from "../../src/dicom/series-geometry.js";
import { RTStruct } from "../../src/index.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/validation/inspect.ts /path/to/folder-of-dcm-files");
  process.exit(1);
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const files = readdirSync(dir).filter((f) => extname(f).toLowerCase() === ".dcm" || !f.includes("."));
console.log(`found ${files.length} candidate files in ${dir}\n`);

const imageBytes: ArrayBuffer[] = [];
const rtstructFiles: { name: string; bytes: ArrayBuffer }[] = [];

for (const file of files) {
  const bytes = toArrayBuffer(readFileSync(join(dir, file)));
  let naturalized: Record<string, unknown>;
  try {
    ({ naturalized } = readDicomDataset(bytes));
  } catch (err) {
    console.log(`  SKIP ${file}: not readable as DICOM (${(err as Error).message})`);
    continue;
  }
  // RTSTRUCT-specific tag, not present on any image instance — more robust than
  // hardcoding every possible image SOPClassUID (CT/MR/PET/...).
  if (naturalized["StructureSetROISequence"] !== undefined) {
    rtstructFiles.push({ name: file, bytes });
  } else if (naturalized["Rows"] !== undefined && naturalized["ImagePositionPatient"] !== undefined) {
    imageBytes.push(bytes);
  } else {
    console.log(`  SKIP ${file}: neither an RTSTRUCT nor an oriented image instance`);
  }
}

console.log(`\n${imageBytes.length} image slice(s), ${rtstructFiles.length} RTSTRUCT file(s)\n`);

if (imageBytes.length === 0) {
  console.log("No image series found — nothing to build a GridGeometry from. Stopping here.");
  process.exit(0);
}

console.log("=== Building GridGeometry from the image series (readSeriesGeometry) ===");
const { geometry, diagnostics: seriesDiagnostics } = readSeriesGeometry(imageBytes);
console.log("rows x columns:", geometry.grid.rows, "x", geometry.grid.columns);
console.log("pixelSpacing:", geometry.grid.pixelSpacing);
console.log("plane count:", geometry.grid.planes.length);
console.log("frameOfReferenceUID:", geometry.frameOfReferenceUID);
console.log("series-level diagnostics:", seriesDiagnostics);

if (rtstructFiles.length === 0) {
  console.log("\nNo RTSTRUCT file found in this folder — geometry only.");
  process.exit(0);
}

for (const { name, bytes } of rtstructFiles) {
  console.log(`\n=== Loading RTSTRUCT: ${name} ===`);
  const rt = await RTStruct.load({ rtstruct: bytes, geometry: geometry.grid, strictness: "warn" });

  console.log("ROI numbers:", rt.getROINumbers());
  console.log("ROI names:", rt.getROINames());
  console.log("document + per-ROI diagnostics:");
  for (const d of rt.diagnostics) console.log(`  [${d.severity}] ${d.code}: ${d.message}`);

  for (const roiNumber of rt.getROINumbers()) {
    const roi = rt.roi(roiNumber);
    const mask = rt.getMask(roiNumber);
    console.log(`\n  ROI ${roiNumber} "${roi.name}" (${roi.interpretedType}):`);
    console.log("    voxel count:", mask.count());
    try {
      console.log("    volume:", mask.volume());
    } catch (err) {
      console.log("    volume: threw —", (err as Error).message);
    }
    console.log("    provenance:", roi.provenance);
    console.log("    dicomVolume (from file, if declared):", rt.dicomVolume(roiNumber));
  }
}
