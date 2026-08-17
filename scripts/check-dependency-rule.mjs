#!/usr/bin/env node
// Build-failing guard for the plan's dependency rule (IMPLEMENTATION_PLAN.md section 3):
// geometry/, contour/, mask/, roi/, phantom/ must never import from dicom/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "src");
const forbiddenDirs = ["geometry", "contour", "mask", "roi", "phantom"];
const dicomImport = /from\s+["'][^"']*\/dicom(?:\/[^"']*)?["']/;

function listTsFiles(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listTsFiles(full));
    else if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

const violations = [];
for (const name of forbiddenDirs) {
  const dir = join(srcDir, name);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of listTsFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (dicomImport.test(line)) violations.push({ file, line: line.trim() });
    }
  }
}

if (violations.length > 0) {
  console.error("Dependency rule violation: geometry/contour/mask/roi/phantom must not import from dicom/\n");
  for (const v of violations) console.error(`  ${v.file}\n    ${v.line}`);
  process.exit(1);
}

console.log("check:deps OK — no dicom/ imports from geometry/contour/mask/roi/phantom.");
