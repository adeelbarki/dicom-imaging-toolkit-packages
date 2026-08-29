/**
 * dicom-seg-js side of the SEG validation harness (roadmap §9, Phase F PR 4).
 *
 * Reads one SEG file and, per segment, emits order-independent invariants + a per-plane
 * checksum keyed by physical z position, so `compare.mjs` can diff it against
 * `metrics-highdicom.py`'s reconstruction without either side having to agree on array
 * layout.
 *
 *   npx tsx scripts/validation/metrics-dicom-seg-js.ts <seg.dcm> [--out file.json]
 *
 * Needs a repo-root `npm install` + `npm run build` (resolves rt-geometry-js from dist/).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readSeg } from "../../src/index.js";

const argv = process.argv.slice(2);
const path = argv[0];
if (!path || path.startsWith("--")) {
  console.error("usage: npx tsx scripts/validation/metrics-dicom-seg-js.ts <seg.dcm> [--out file.json]");
  process.exit(1);
}
const outPath = argv.includes("--out") ? argv[argv.indexOf("--out") + 1]! : path.replace(/\.dcm$/i, "") + ".dicom-seg-js.json";

const bytes = readFileSync(path);
const seg = readSeg(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const g = seg.geometry;
const normal = g.normal();

// FNV-1a over a byte buffer, folded to a hex string — a cheap slice fingerprint.
function fnv1a(buf: Uint8Array | Float32Array): string {
  let h = 0x811c9dc5;
  const view = buf instanceof Float32Array ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf;
  for (let i = 0; i < view.length; i++) {
    h ^= view[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const planeZ = g.planes.map((p) => p.position[0] * normal[0] + p.position[1] * normal[1] + p.position[2] * normal[2]);

const segments = seg.segments().map((info) => {
  const isBinary = seg.type === "BINARY";
  let count = 0;
  let sum = 0;
  let max = 0;
  const slices: { z: number; nonzero: number; checksum: string }[] = [];

  if (isBinary) {
    const mask = seg.mask(info.number);
    for (let k = 0; k < g.planes.length; k++) {
      const slice = mask.getSliceBuffer(k);
      let nz = 0;
      for (let i = 0; i < slice.length; i++) if (slice[i]) nz++;
      count += nz;
      slices.push({ z: round(planeZ[k]!), nonzero: nz, checksum: fnv1a(slice) });
    }
  } else {
    const raw = seg.rawField(info.number);
    for (let k = 0; k < g.planes.length; k++) {
      const slice = raw.getSliceBuffer(k);
      const bytes8 = new Uint8Array(slice.length);
      let nz = 0;
      for (let i = 0; i < slice.length; i++) {
        const v = slice[i] as number;
        bytes8[i] = v;
        if (v !== 0) {
          nz++;
          sum += v;
          if (v > max) max = v;
        }
      }
      count += nz;
      slices.push({ z: round(planeZ[k]!), nonzero: nz, checksum: fnv1a(bytes8) });
    }
  }

  return {
    number: info.number,
    label: info.label,
    category: info.category?.meaning,
    propertyType: info.propertyType?.meaning,
    nonzeroVoxelCount: count,
    rawValueSum: isBinary ? undefined : sum,
    rawValueMax: isBinary ? undefined : max,
    slices,
  };
});

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const report = {
  source: "dicom-seg-js",
  file: basename(path),
  segmentationType: seg.type,
  fractionalType: seg.fractionalType ?? null,
  maximumFractionalValue: seg.maximumFractionalValue ?? null,
  segmentsOverlap: seg.segmentsOverlap,
  geometry: {
    rows: g.rows,
    columns: g.columns,
    planes: g.planes.length,
    pixelSpacing: g.pixelSpacing,
    planeZ: planeZ.map(round),
  },
  diagnostics: seg.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
  segments,
};

writeFileSync(outPath, JSON.stringify(report, null, 2));
console.error(`wrote ${outPath} — ${seg.type}, ${segments.length} segment(s), ${g.planes.length} planes`);
for (const s of segments) console.error(`  seg ${s.number} ${JSON.stringify(s.label)}: ${s.nonzeroVoxelCount} voxels`);
