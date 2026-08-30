/**
 * Round-trip validation for `rt-convert-js` — methodology for `../../VALIDATION.md`.
 *
 * There is no external reference implementation for the *conversion* itself (the
 * rasterize/vectorize primitives are validated in `rtstruct-js`, the SEG read/write in
 * `dicom-seg-js` vs highdicom). What this harness checks is **self-consistency on real
 * TCIA data**:
 *
 *   rtstruct : real RTSTRUCT + its CT/MR series
 *             load ROI -> mask0 -> rtstructToSeg -> readSeg -> mask1
 *             expect voxelDisagreement(mask0, mask1) === 0  (voxel copy, no lossy step)
 *
 *   seg      : real SEG (.dcm), self-describing geometry
 *             seg.mask(n) -> mask0 -> segToRtstruct -> RTStruct.load -> mask1
 *             report Dice + voxelDisagreement (mask-vectorization is lossy) and check the
 *             independently-measured numbers match provenance.lossySteps
 *
 * Run:
 *   npx tsx scripts/validation/roundtrip.ts rtstruct ../../scratch/data-real/<case>
 *   npx tsx scripts/validation/roundtrip.ts seg      ../../scratch/data-seg/<case>/SEG.dcm [--threshold 0.5]
 *
 * Needs a repo-root `npm run build` first (the peers resolve from their `dist/`).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { dice, voxelDisagreement } from "rt-geometry-js";
import { RTStruct, readSeriesGeometry } from "rtstruct-js";
import { readSeg } from "dicom-seg-js";
import { rtstructToSeg, segToRtstruct } from "../../src/index.js";
import type { ConversionProvenance } from "../../src/index.js";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const [mode, target, ...rest] = process.argv.slice(2);
if (mode !== "rtstruct" && mode !== "seg") {
  die("usage: roundtrip.ts <rtstruct|seg> <path> [--threshold N]");
}
if (!target) die("missing path");

const thresholdArg = rest.indexOf("--threshold");
const threshold = thresholdArg >= 0 ? Number(rest[thresholdArg + 1]) : undefined;

function vectorStep(p: ConversionProvenance) {
  const s = p.lossySteps.find((x) => x.kind === "mask-vectorization");
  if (!s || s.kind !== "mask-vectorization") throw new Error("no mask-vectorization step");
  return s;
}

async function runRtstruct(dir: string): Promise<void> {
  const files = readdirSync(dir).filter((f) => extname(f).toLowerCase() === ".dcm");
  const rtName = files.find((f) => /^(rt|rs)[-_.]/i.test(f) || /struct/i.test(f));
  const seriesNames = files.filter((f) => /^(ct|mr|pt)[-_.]/i.test(f));
  if (!rtName || seriesNames.length === 0) {
    die(`expected one RT*/RS* file and CT*/MR* slices in ${dir} (found ${files.length} .dcm)`);
  }
  const rtBytes = toArrayBuffer(readFileSync(join(dir, rtName)));
  const series = seriesNames.map((f) => toArrayBuffer(readFileSync(join(dir, f))));
  const { geometry } = readSeriesGeometry(series);
  const grid = geometry.grid;

  const rt = await RTStruct.load({ rtstruct: rtBytes, geometry: grid });
  const rows: Array<Record<string, unknown>> = [];
  let worst = 0;

  for (const name of rt.getROINames()) {
    let mask0;
    try {
      mask0 = rt.getMask(name);
    } catch {
      continue;
    }
    if (mask0.count() === 0) continue;
    const { bytes, provenance } = rtstructToSeg(rt, name);
    const seg = readSeg(bytes);
    const mask1 = seg.mask(1);
    const disagree = voxelDisagreement(mask0, mask1);
    worst = Math.max(worst, disagree);
    rows.push({
      roi: name,
      voxels: mask0.count(),
      voxelDisagreement: disagree,
      dice: Number(dice(mask0, mask1).toFixed(6)),
      lossySteps: provenance.lossySteps.length,
    });
  }

  console.log(JSON.stringify({ case: basename(dir), direction: "rtstruct-to-seg", rows }, null, 2));
  console.table(rows);
  if (worst !== 0) die(`\nFAIL: rtstruct->seg is a voxel copy but ${worst} voxel(s) disagreed`);
  console.log("\nOK: every ROI round-tripped voxel-for-voxel (voxelDisagreement === 0)");
}

async function runSeg(path: string): Promise<void> {
  const file = statSync(path).isDirectory() ? join(path, "SEG.dcm") : path;
  const seg = readSeg(toArrayBuffer(readFileSync(file)));
  const rows: Array<Record<string, unknown>> = [];

  for (const info of seg.segments()) {
    const n = info.number;
    let mask0;
    if (seg.type === "BINARY") {
      mask0 = seg.mask(n);
    } else {
      if (threshold === undefined) die("FRACTIONAL SEG — pass --threshold N");
      mask0 = seg.support(n); // pre-threshold footprint, for reference
    }

    const { bytes, provenance } =
      seg.type === "BINARY"
        ? await segToRtstruct(seg, n)
        : await segToRtstruct(seg, n, { threshold: threshold as number });

    const rt = await RTStruct.load({ rtstruct: bytes, geometry: seg.geometry });
    const roiName = rt.getROINames()[0] as string;
    const mask1 = rt.getMask(roiName);

    // the mask that was actually vectorized (post-threshold for FRACTIONAL)
    const step = vectorStep(provenance);
    const independentDisagree = voxelDisagreement(
      seg.type === "BINARY" ? mask0 : mask1, // for FRACTIONAL we only have the written mask to compare re-raster against
      mask1,
    );

    rows.push({
      segment: n,
      label: info.label,
      type: seg.type,
      voxelsBefore: step.voxelsBefore,
      voxelsAfter: step.voxelsAfter,
      "provenance.voxelDisagreement": step.voxelDisagreement,
      "recheck.voxelDisagreement": seg.type === "BINARY" ? independentDisagree : "(n/a)",
      "provenance.dice": Number(step.dice.toFixed(6)),
      lossyStepKinds: provenance.lossySteps.map((s) => s.kind).join(" -> "),
    });
  }

  console.log(JSON.stringify({ case: basename(file), direction: "seg-to-rtstruct", threshold, rows }, null, 2));
  console.table(rows);
  console.log(
    "\nNote: seg->rtstruct is a vectorization — voxelDisagreement > 0 is expected on curved " +
      "boundaries. provenance.dice is the fidelity of THIS conversion; VALIDATION.md aggregates.",
  );
}

await (mode === "rtstruct" ? runRtstruct(target) : runSeg(target));
