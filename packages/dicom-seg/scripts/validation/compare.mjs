#!/usr/bin/env node
// Diff a dicom-seg-js reconstruction against a highdicom one (roadmap §9, Phase F PR 4).
//
//   node scripts/validation/compare.mjs <a.dicom-seg-js.json> <b.highdicom.json>
//
// Both sides emit, per segment, per plane (keyed by physical z): an FNV-1a checksum of the
// row-major slice bytes plus the non-zero voxel count. A voxel-exact reconstruction means
// every matched (segment, z) checksum is identical. Always exits 0 (a report).
import { readFileSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: node scripts/validation/compare.mjs <a.dicom-seg-js.json> <b.highdicom.json>");
  process.exit(1);
}
const a = JSON.parse(readFileSync(aPath, "utf8"));
const b = JSON.parse(readFileSync(bPath, "utf8"));

console.log(`# SEG reconstruction agreement — ${a.source} vs ${b.source}\n`);
console.log(`file: ${a.file}`);
console.log(`type: ${a.segmentationType}${a.fractionalType ? ` / ${a.fractionalType}` : ""}  (ref: ${b.segmentationType}${b.fractionalType ? ` / ${b.fractionalType}` : ""})`);
console.log(`geometry a: ${a.geometry.rows}×${a.geometry.columns}×${a.geometry.planes}   b: ${b.geometry.rows}×${b.geometry.columns}×${b.geometry.planes}`);
if (a.diagnostics?.length) console.log(`diagnostics: ${a.diagnostics.map((d) => `${d.code}(${d.severity})`).join(", ")}`);
console.log();

let totalSlices = 0;
let exactSlices = 0;
let totalVoxelDelta = 0;
const problems = [];

const bBySeg = new Map(b.segments.map((s) => [s.number, s]));

for (const sa of a.segments) {
  const sb = bBySeg.get(sa.number);
  if (!sb) {
    problems.push(`segment ${sa.number} (${sa.label}) — no match in reference`);
    continue;
  }
  const countDelta = sa.nonzeroVoxelCount - sb.nonzeroVoxelCount;
  totalVoxelDelta += Math.abs(countDelta);

  const bByZ = new Map(sb.slices.map((s) => [s.z, s]));
  let segExact = 0;
  let segChecked = 0;
  let firstMismatchZ = null;
  for (const slice of sa.slices) {
    const ref = bByZ.get(slice.z);
    if (!ref) {
      if (slice.nonzero > 0) problems.push(`segment ${sa.number}: no reference slice at z=${slice.z} (${slice.nonzero} voxels)`);
      continue;
    }
    segChecked++;
    totalSlices++;
    if (slice.checksum === ref.checksum && slice.nonzero === ref.nonzero) {
      segExact++;
      exactSlices++;
    } else if (firstMismatchZ === null) {
      firstMismatchZ = slice.z;
    }
  }

  const extra = [`count Δ ${countDelta >= 0 ? "+" : ""}${countDelta}`];
  if (sa.rawValueSum !== undefined && sa.rawValueSum !== null) {
    extra.push(`rawSum ${sa.rawValueSum} vs ${sb.rawValueSum}`, `rawMax ${sa.rawValueMax} vs ${sb.rawValueMax}`);
  }
  const status = segExact === segChecked && countDelta === 0 ? "✓ voxel-exact" : `✗ ${segExact}/${segChecked} slices match`;
  console.log(`segment ${sa.number} ${JSON.stringify(sa.label)} — ${status}  [${extra.join(", ")}]`);
  if (firstMismatchZ !== null) console.log(`    first mismatching slice: z=${firstMismatchZ}`);
}

console.log(`\n## Summary\n`);
console.log(`- ${exactSlices}/${totalSlices} matched (segment, z) slices are checksum-identical`);
console.log(`- total |non-zero voxel count Δ| across segments: ${totalVoxelDelta}`);
if (problems.length) {
  console.log(`\n### Problems\n`);
  for (const p of problems) console.log(`- ${p}`);
} else if (exactSlices === totalSlices && totalVoxelDelta === 0) {
  console.log(`\n**Voxel-exact.** Every segment reconstructs identically to highdicom.`);
}
