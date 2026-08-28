/**
 * rtdose-js side of the RTDOSE validation harness (roadmap §9, Phase E PR 3).
 *
 * Point it at a folder holding ONE RTDOSE, ONE RTSTRUCT, and the CT/MR series the
 * RTSTRUCT was drawn on. For every ROI it computes mean/min/max dose, D2/D50/D95, and
 * V5Gy/V20Gy/V30Gy through rtdose-js and writes them to a JSON file. `metrics-dicompyler.py`
 * produces the same shape from dicompyler-core; `compare.mjs` diffs the two.
 *
 *   npx tsx scripts/validation/metrics-rtdose-js.ts <folder> [--method trilinear|nearest] [--out file.json]
 *
 * Requires a repo-root `npm install` and `npm run build` first: this resolves
 * `rt-geometry-js` and `rtstruct-js` from their built `dist/` via the workspace symlinks.
 * Nothing here ships — `files` in package.json is `dist/` only.
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { InterpMethod, Mask3D } from "rt-geometry-js";
import { RTStruct, readSeriesGeometry } from "rtstruct-js";
import { DoseGrid } from "../../src/index.js";

const dcmjs = createRequire(import.meta.url)("dcmjs");
const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

const argv = process.argv.slice(2);
const dir = argv[0];
if (!dir || dir.startsWith("--")) {
  console.error(
    "usage: npx tsx scripts/validation/metrics-rtdose-js.ts <folder> [--method trilinear|nearest] [--out file.json]",
  );
  process.exit(1);
}
const method = (argOf("--method") ?? "trilinear") as InterpMethod;
if (method !== "trilinear" && method !== "nearest") {
  console.error(`--method must be "trilinear" or "nearest", got ${JSON.stringify(method)}`);
  process.exit(1);
}
const outPath = argOf("--out") ?? join(dir, `dvh-rtdose-js.${method}.json`);

function argOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const D_PERCENTS = [2, 50, 95] as const;
const V_GYS = [5, 20, 30] as const;

// ---- classify the folder ----------------------------------------------------

const files = readdirSync(dir).filter((f) => extname(f).toLowerCase() === ".dcm" || !f.includes("."));
const ctSlices: ArrayBuffer[] = [];
let rtstructBytes: ArrayBuffer | undefined;
let rtstructName = "";
let doseBytes: ArrayBuffer | undefined;
let doseName = "";

for (const file of files) {
  const bytes = toArrayBuffer(readFileSync(join(dir, file)));
  let ds: Record<string, unknown>;
  try {
    ds = DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(bytes).dict) as Record<string, unknown>;
  } catch {
    continue;
  }
  const modality = ds["Modality"] as string | undefined;
  if (ds["StructureSetROISequence"] !== undefined) {
    rtstructBytes = bytes;
    rtstructName = file;
  } else if (modality === "RTDOSE" || ds["GridFrameOffsetVector"] !== undefined) {
    doseBytes = bytes;
    doseName = file;
  } else if (ds["Rows"] !== undefined && ds["ImagePositionPatient"] !== undefined && ds["PixelData"] !== undefined) {
    ctSlices.push(bytes);
  }
}

if (!doseBytes) fail("no RTDOSE (Modality RTDOSE / GridFrameOffsetVector) found in the folder");
if (!rtstructBytes) fail("no RTSTRUCT (StructureSetROISequence) found in the folder");
if (ctSlices.length === 0) fail("no CT/MR image series found — rtdose-js rasterizes the RTSTRUCT onto that grid");

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  return process.exit(1);
}

// ---- build masks + dose ---------------------------------------------------

const { geometry, diagnostics: seriesDiag } = readSeriesGeometry(ctSlices);
const grid = geometry.grid;
const dose = DoseGrid.fromDicom(doseBytes!);
const rt = await RTStruct.load({ rtstruct: rtstructBytes!, geometry: grid, strictness: "warn" });

const rois: unknown[] = [];
for (const roiNumber of rt.getROINumbers()) {
  const roi = rt.roi(roiNumber);
  let mask: Mask3D;
  try {
    mask = rt.getMask(roiNumber);
  } catch (err) {
    console.error(`  skip ROI ${roiNumber} "${roi.name}": ${(err as Error).message}`);
    continue;
  }
  if (mask.count() === 0) {
    console.error(`  skip ROI ${roiNumber} "${roi.name}": empty mask`);
    continue;
  }

  let stats;
  try {
    stats = dose.statistics(mask, { method });
  } catch (err) {
    console.error(`  skip ROI ${roiNumber} "${roi.name}": ${(err as Error).message}`);
    continue;
  }

  const dGy: Record<string, number> = {};
  for (const p of D_PERCENTS) dGy[p] = dose.getD(p, mask, { method }).doseGy;
  const vCm3: Record<string, number> = {};
  const vPct: Record<string, number> = {};
  for (const g of V_GYS) {
    const v = dose.getV(g, mask, { method });
    vCm3[g] = v.volumeMm3 / 1000;
    vPct[g] = v.volumeFraction * 100;
  }

  rois.push({
    name: roi.name,
    roiNumber,
    interpretedType: roi.interpretedType,
    volumeCm3: stats.volumeMm3 / 1000,
    voxelCount: mask.count(),
    meanGy: stats.meanGy,
    minGy: stats.minGy,
    maxGy: stats.maxGy,
    dGy,
    vCm3,
    vPct,
  });
  console.error(`  ROI ${roiNumber} "${roi.name}": mean ${stats.meanGy.toFixed(3)} Gy, D95 ${dGy[95]!.toFixed(3)} Gy`);
}

const pkgVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

const report = {
  source: "rtdose-js",
  toolVersion: pkgVersion,
  generatedAt: new Date().toISOString(),
  method: {
    resampling: "dose-sampled-at-structure-voxel-centres",
    interpolation: method,
    volumePolicy: "whole-voxel-binary",
  },
  inputs: {
    folder: dir,
    rtdose: doseName,
    rtstruct: rtstructName,
    ctSlices: ctSlices.length,
  },
  dose: {
    units: dose.units,
    summationType: dose.doseSummationType ?? null,
    gridScaling: dose.doseGridScaling,
    grid: {
      rows: dose.geometry.rows,
      columns: dose.geometry.columns,
      planes: dose.geometry.planes.length,
      pixelSpacing: dose.geometry.pixelSpacing,
    },
    diagnostics: dose.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
  },
  structureGrid: {
    rows: grid.rows,
    columns: grid.columns,
    planes: grid.planes.length,
    pixelSpacing: grid.pixelSpacing,
    diagnostics: seriesDiag.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
  },
  rois,
};

writeFileSync(outPath, JSON.stringify(report, null, 2));
console.error(`\nwrote ${outPath} (${rois.length} ROIs, method=${method})`);
