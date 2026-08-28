/**
 * Measures the real within-series / round-trip geometry noise that DEFAULT_TOLERANCE
 * (rt-geometry-js `src/tolerance.ts`) is meant to absorb, across the de-identified
 * multi-vendor series in a folder of subfolders.
 *
 * Run with: npx tsx scripts/validation/tolerance-derivation.ts scratch/data-real [scratch/data-lctsc/ct ...]
 *
 * DEFAULT_TOLERANCE governs exactly two comparisons:
 *   - GridGeometry.equals(a, b)          — are these two grids the same geometry?
 *   - readSeriesGeometry instance-check  — do these DICOM instances belong to one series?
 * so the noise floor it must sit above is: how much do the per-slice PixelSpacing /
 * ImageOrientationPatient / ImagePositionPatient of a single real series disagree with
 * each other, plus the quantisation of the DS-encoded coordinates (which bounds a
 * read -> build -> write -> read round trip).
 *
 * Methodology script for VALIDATION.md — not library code, imports src/dicom/port.ts
 * directly the way tests/fixtures.ts does.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, basename } from "node:path";
import { readDicomDataset } from "../../src/dicom/port.js";

type Vec3 = [number, number, number];

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: npx tsx scripts/validation/tolerance-derivation.ts <folder-of-series-subfolders> [more folders]");
  process.exit(1);
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const unit = (a: Vec3): Vec3 => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
/** Angle between two vectors in radians, clamped for float safety. */
function angleBetween(a: Vec3, b: Vec3): number {
  const c = dot(unit(a), unit(b));
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Fractional digits the vendor actually wrote in a fixed-notation DS string, e.g.
 *  "-158.599991" -> 6. The coordinate quantum is 10^-thatn, so a re-encode round trip
 *  can shift the value by at most 0.5 * 10^-thatn. Scientific-notation strings return -1
 *  (handled separately by roundTripDelta). */
function fractionalDigits(ds: string): number {
  if (/[eE]/.test(ds)) return -1;
  const dot = ds.indexOf(".");
  return dot === -1 ? 0 : ds.length - dot - 1;
}

/** Read -> JS number -> DS string (the way dcmjs writes it) -> parse again; the delta is
 *  the error a build/serialize/re-parse round trip introduces for this coordinate. */
function roundTripDelta(ds: string): number {
  const n = Number(ds);
  const reEncoded = String(n).slice(0, 16); // dcmjs DS write: String(value), max 16 chars
  return Math.abs(n - Number(reEncoded));
}

interface Slice {
  ipp: Vec3;
  iop: number[]; // 6
  pixelSpacing: [number, number];
  rows: number;
  columns: number;
  seriesUID: string;
  rawDs: string[]; // vendor DS strings for IPP + IOP + PixelSpacing, as written
}

function loadSlices(dir: string): Slice[] {
  const files = readdirSync(dir).filter(
    (f) => extname(f).toLowerCase() === ".dcm" || !f.includes("."),
  );
  const slices: Slice[] = [];
  for (const file of files) {
    const full = join(dir, file);
    if (statSync(full).isDirectory()) continue;
    let naturalized: Record<string, unknown>;
    let raw: Record<string, unknown>;
    try {
      ({ naturalized, raw } = readDicomDataset(toArrayBuffer(readFileSync(full))));
    } catch {
      continue;
    }
    const rawStrings = (tag: string): string[] => {
      const el = raw[tag] as { _rawValue?: unknown[]; Value?: unknown[] } | undefined;
      const v = el?._rawValue ?? el?.Value ?? [];
      return v.map((x) => String(x));
    };
    const ipp = naturalized["ImagePositionPatient"] as number[] | undefined;
    const iop = naturalized["ImageOrientationPatient"] as number[] | undefined;
    const ps = naturalized["PixelSpacing"] as number[] | undefined;
    if (!ipp || ipp.length !== 3 || !iop || iop.length !== 6 || !ps || ps.length !== 2) continue;
    if (naturalized["StructureSetROISequence"] !== undefined) continue; // RTSTRUCT, skip
    slices.push({
      ipp: [ipp[0]!, ipp[1]!, ipp[2]!],
      iop: iop.map(Number),
      pixelSpacing: [ps[0]!, ps[1]!],
      rows: Number(naturalized["Rows"]),
      columns: Number(naturalized["Columns"]),
      seriesUID: String(naturalized["SeriesInstanceUID"] ?? ""),
      rawDs: [...rawStrings("00200032"), ...rawStrings("00200037"), ...rawStrings("00280030")],
    });
  }
  return slices;
}

interface SeriesReport {
  label: string;
  nSlices: number;
  pixelSpacingSpreadMm: number;
  rowAngleSpreadRad: number;
  colAngleSpreadRad: number;
  offAxisMaxMm: number;
  sliceSpacingMm: { min: number; max: number; mean: number };
  minFractionalDigits: number;
  quantumMm: number;
  sampleDs: string;
  roundTripMaxDeltaMm: number;
}

function analyseSeries(label: string, slices: Slice[]): SeriesReport | undefined {
  if (slices.length < 2) return undefined;
  const first = slices[0]!;

  // PixelSpacing spread
  let psSpread = 0;
  for (const s of slices) {
    psSpread = Math.max(psSpread, Math.abs(s.pixelSpacing[0] - first.pixelSpacing[0]), Math.abs(s.pixelSpacing[1] - first.pixelSpacing[1]));
  }

  // Orientation spread (row and column directions vs the first slice)
  const row0: Vec3 = [first.iop[0]!, first.iop[1]!, first.iop[2]!];
  const col0: Vec3 = [first.iop[3]!, first.iop[4]!, first.iop[5]!];
  let rowSpread = 0;
  let colSpread = 0;
  for (const s of slices) {
    const r: Vec3 = [s.iop[0]!, s.iop[1]!, s.iop[2]!];
    const c: Vec3 = [s.iop[3]!, s.iop[4]!, s.iop[5]!];
    rowSpread = Math.max(rowSpread, angleBetween(row0, r));
    colSpread = Math.max(colSpread, angleBetween(col0, c));
  }

  // Off-axis: perpendicular distance of each slice origin from the line through
  // first.ipp along the (row x col) normal.
  const normal = unit(cross(row0, col0));
  let offAxisMax = 0;
  const projections: number[] = [];
  for (const s of slices) {
    const rel = sub(s.ipp, first.ipp);
    const along = dot(rel, normal);
    projections.push(along);
    const perp: Vec3 = [rel[0] - along * normal[0], rel[1] - along * normal[1], rel[2] - along * normal[2]];
    offAxisMax = Math.max(offAxisMax, norm(perp));
  }

  // Slice spacing from sorted projections
  projections.sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < projections.length; i++) deltas.push(projections[i]! - projections[i - 1]!);
  const spMin = Math.min(...deltas);
  const spMax = Math.max(...deltas);
  const spMean = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  // Vendor DS precision (from non-zero coordinates only) + actual round-trip error
  let minFrac = 99;
  let rtMax = 0;
  let sampleDs = "";
  for (const s of slices) {
    for (const ds of s.rawDs) {
      if (Math.abs(Number(ds)) < 1e-9) continue; // skip exact zeros (axial IOP components)
      const fd = fractionalDigits(ds);
      if (fd >= 0 && fd < minFrac) {
        minFrac = fd;
        sampleDs = ds;
      }
      rtMax = Math.max(rtMax, roundTripDelta(ds));
    }
  }
  const minFractionalDigits = minFrac === 99 ? 0 : minFrac;

  return {
    label,
    nSlices: slices.length,
    pixelSpacingSpreadMm: psSpread,
    rowAngleSpreadRad: rowSpread,
    colAngleSpreadRad: colSpread,
    offAxisMaxMm: offAxisMax,
    sliceSpacingMm: { min: spMin, max: spMax, mean: spMean },
    minFractionalDigits,
    quantumMm: 10 ** -minFractionalDigits,
    sampleDs,
    roundTripMaxDeltaMm: rtMax,
  };
}

const reports: SeriesReport[] = [];
for (const root of dirs) {
  const entries = readdirSync(root).map((e) => join(root, e));
  const seriesDirs = entries.filter((e) => statSync(e).isDirectory());
  const targets = seriesDirs.length > 0 ? seriesDirs : [root];
  for (const d of targets) {
    const slices = loadSlices(d);
    // A folder can hold more than one series; split.
    const bySeries = new Map<string, Slice[]>();
    for (const s of slices) {
      const k = s.seriesUID || d;
      if (!bySeries.has(k)) bySeries.set(k, []);
      bySeries.get(k)!.push(s);
    }
    let idx = 0;
    for (const [, group] of bySeries) {
      const label = bySeries.size > 1 ? `${basename(d)}#${++idx}` : basename(d);
      const r = analyseSeries(label, group);
      if (r) reports.push(r);
    }
  }
}

const sci = (x: number) => x.toExponential(2);
const f = (x: number, d = 4) => x.toFixed(d);

console.log(`\n${reports.length} series analysed\n`);
console.log(
  "series".padEnd(22),
  "slices".padStart(7),
  "psSpread".padStart(10),
  "rowAng".padStart(10),
  "colAng".padStart(10),
  "offAxis".padStart(10),
  "spacing(min/mean/max)".padStart(24),
  "fracDig".padStart(7),
  "rtErr".padStart(10),
);
for (const r of reports) {
  console.log(
    r.label.padEnd(22),
    String(r.nSlices).padStart(7),
    f(r.pixelSpacingSpreadMm).padStart(10),
    sci(r.rowAngleSpreadRad).padStart(10),
    sci(r.colAngleSpreadRad).padStart(10),
    f(r.offAxisMaxMm).padStart(10),
    `${f(r.sliceSpacingMm.min, 3)}/${f(r.sliceSpacingMm.mean, 3)}/${f(r.sliceSpacingMm.max, 3)}`.padStart(24),
    String(r.minFractionalDigits).padStart(7),
    sci(r.roundTripMaxDeltaMm).padStart(10),
  );
}
console.log("\nleast-precise non-zero DS coordinate per series (quantum = 10^-fracDigits):");
for (const r of reports) {
  console.log(`  ${r.label.padEnd(22)} "${r.sampleDs}"  ${r.minFractionalDigits} frac digits  quantum ${sci(r.quantumMm)} mm`);
}

const maxPs = Math.max(...reports.map((r) => r.pixelSpacingSpreadMm));
const maxAng = Math.max(...reports.map((r) => Math.max(r.rowAngleSpreadRad, r.colAngleSpreadRad)));
const maxOffAxis = Math.max(...reports.map((r) => r.offAxisMaxMm));
const maxRt = Math.max(...reports.map((r) => r.roundTripMaxDeltaMm));
const worstQuantum = Math.max(...reports.map((r) => r.quantumMm));

console.log("\n=== aggregate worst-case across all series ===");
console.log("PixelSpacing within-series spread   :", sci(maxPs), "mm");
console.log("Orientation within-series spread    :", sci(maxAng), "rad  (", f((maxAng * 180) / Math.PI, 5), "deg )");
console.log("Slice-origin off-axis deviation     :", sci(maxOffAxis), "mm");
console.log("Coordinate read/re-encode round-trip:", sci(maxRt), "mm");
console.log("Coarsest vendor DS quantum          :", sci(worstQuantum), "mm  (=> re-encode error <=", sci(worstQuantum / 2), "mm)");

console.log("\n=== current DEFAULT_TOLERANCE ===");
console.log("positionMm         : 0.5");
console.log("spacingMm          : 0.01");
console.log("directionAngleRad  : 1e-3   (", f((1e-3 * 180) / Math.PI, 4), "deg )");

console.log("\n=== headroom (current / measured worst-case) ===");
console.log("position  : 0.5   /", sci(Math.max(maxOffAxis, maxRt)), "=>", f(0.5 / Math.max(maxOffAxis, maxRt, 1e-12), 0), "x");
console.log("spacing   : 0.01  /", sci(maxPs), "=>", maxPs === 0 ? "inf (exact)" : `${f(0.01 / maxPs, 0)}x`);
console.log("direction : 1e-3  /", sci(maxAng), "=>", maxAng === 0 ? "inf (exact)" : `${f(1e-3 / maxAng, 0)}x`);
