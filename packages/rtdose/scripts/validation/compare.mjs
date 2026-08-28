#!/usr/bin/env node
// Diff two dvh-*.json reports from the RTDOSE validation harness (roadmap §9, Phase E PR 3).
//
//   node scripts/validation/compare.mjs <candidate.json> <reference.json>
//
// candidate = rtdose-js (dvh-rtdose-js.trilinear.json), reference = dicompyler-core
// (dvh-dicompyler-core.json). Order matters: Δ is candidate − reference, and relative Δ is
// against the reference. Prints a Markdown agreement table plus a summary; always exits 0
// (this is a report, not a CI gate).
import { readFileSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: node scripts/validation/compare.mjs <candidate.json> <reference.json>");
  process.exit(1);
}
const a = JSON.parse(readFileSync(aPath, "utf8"));
const b = JSON.parse(readFileSync(bPath, "utf8"));

const norm = (s) => String(s ?? "").trim().toLowerCase();
const bByName = new Map(b.rois.map((r) => [norm(r.name), r]));

// metric key -> { label, unit, get(roi), tol(ref) => absolute tolerance }
const doseTol = (ref) => Math.max(0.5, Math.abs(ref) * 0.02); // 0.5 Gy or 2%
const volTol = (ref) => Math.max(1.0, Math.abs(ref) * 0.02); // 1 cm³ or 2%
const pctTol = () => 2.0; // 2 percentage points

const METRICS = [
  { key: "volumeCm3", label: "volume", unit: "cm³", get: (r) => r.volumeCm3, tol: volTol },
  { key: "meanGy", label: "mean", unit: "Gy", get: (r) => r.meanGy, tol: doseTol },
  { key: "minGy", label: "min", unit: "Gy", get: (r) => r.minGy, tol: doseTol },
  { key: "maxGy", label: "max", unit: "Gy", get: (r) => r.maxGy, tol: doseTol },
  ...[2, 50, 95].map((p) => ({
    key: `D${p}`,
    label: `D${p}`,
    unit: "Gy",
    get: (r) => r.dGy?.[p],
    tol: doseTol,
  })),
  ...[5, 20, 30].map((g) => ({
    key: `V${g}Gy`,
    label: `V${g}Gy`,
    unit: "cm³",
    get: (r) => r.vCm3?.[g],
    tol: volTol,
  })),
  ...[5, 20, 30].map((g) => ({
    key: `V${g}Gy%`,
    label: `V${g}Gy`,
    unit: "%",
    get: (r) => r.vPct?.[g],
    tol: pctTol,
  })),
];

const fmt = (x) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(3));

console.log(`# DVH agreement — ${a.source} ${a.toolVersion ?? ""} vs ${b.source} ${b.toolVersion ?? ""}\n`);
console.log(`candidate: ${aPath}`);
console.log(`reference: ${bPath}`);
if (a.method) console.log(`candidate method: ${JSON.stringify(a.method)}`);
if (b.method) console.log(`reference method: ${JSON.stringify(b.method)}`);
console.log("\ntolerance: dose ±max(0.5 Gy, 2%); volume ±max(1 cm³, 2%); V% ±2 pp\n");

let compared = 0;
let within = 0;
const flagged = [];

console.log("| ROI | metric | candidate | reference | Δ | Δ% | |");
console.log("|---|---|--:|--:|--:|--:|:-:|");

for (const ra of a.rois) {
  const rb = bByName.get(norm(ra.name));
  if (!rb) {
    console.log(`| ${ra.name} | — | — | *no match in reference* | | | ⚠ |`);
    continue;
  }
  for (const m of METRICS) {
    const va = m.get(ra);
    const vb = m.get(rb);
    if (va === null || va === undefined || vb === null || vb === undefined) continue;
    compared++;
    const d = va - vb;
    const dPct = vb !== 0 ? (d / Math.abs(vb)) * 100 : NaN;
    const ok = Math.abs(d) <= m.tol(vb);
    if (ok) within++;
    else flagged.push({ roi: ra.name, metric: `${m.label} (${m.unit})`, va, vb, d, dPct });
    console.log(
      `| ${ra.name} | ${m.label} (${m.unit}) | ${fmt(va)} | ${fmt(vb)} | ${d >= 0 ? "+" : ""}${fmt(d)} | ${
        Number.isNaN(dPct) ? "—" : `${dPct >= 0 ? "+" : ""}${dPct.toFixed(1)}%`
      } | ${ok ? "✓" : "✗"} |`,
    );
  }
}

console.log(`\n## Summary\n`);
console.log(`- ${within}/${compared} metric comparisons within tolerance`);
console.log(`- ${a.rois.length} candidate ROIs, ${b.rois.length} reference ROIs`);
if (flagged.length) {
  console.log(`\n### Outside tolerance (${flagged.length})\n`);
  flagged.sort((x, y) => Math.abs(y.dPct || 0) - Math.abs(x.dPct || 0));
  for (const f of flagged) {
    console.log(
      `- **${f.roi} / ${f.metric}**: ${fmt(f.va)} vs ${fmt(f.vb)} (Δ ${f.d >= 0 ? "+" : ""}${fmt(f.d)}, ${
        Number.isNaN(f.dPct) ? "—" : `${f.dPct.toFixed(1)}%`
      })`,
    );
  }
  console.log(
    `\nInvestigate each against the method differences in VALIDATION.md before treating it as a bug.`,
  );
} else if (compared > 0) {
  console.log(`\nAll compared metrics agree within tolerance.`);
}
