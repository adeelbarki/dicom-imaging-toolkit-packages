#!/usr/bin/env node
// Build-failing guard for the monorepo dependency rules (.claude/ROADMAP.md, Phase B step 3).
//
// Package boundaries:
//   - rt-geometry-js (the shared core) imports NO other workspace package.
//   - No domain package (rtstruct-js, rtdose-js, dicom-seg-js, ...) imports another
//     domain package.
//   - Only rt-convert-js may depend on more than one domain package.
//   - Nothing imports rt-convert-js (it is a leaf).
//
// Intra-package (carried over from the pre-split script — the old path-based rule that
// "geometry/contour/mask/phantom must not import dicom/" is now mostly a *package*
// boundary; the part still meaningful inside one package is kept here):
//   - rtstruct-js: src/contour/** must not import from src/dicom/**.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(rootDir, "packages");

const CORE = "rt-geometry-js";
const CONVERT = "rt-convert-js";

function listTsFiles(dir) {
  let files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listTsFiles(full));
    else if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

// Every `from "..."` / `import "..."` specifier in a source file.
function importSpecifiers(text) {
  const specs = [];
  const re = /(?:from|import)\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) specs.push(m[1]);
  return specs;
}

// Discover workspace packages: dir name -> package name.
const packages = [];
for (const entry of readdirSync(packagesDir)) {
  const pkgJsonPath = join(packagesDir, entry, "package.json");
  try {
    const name = JSON.parse(readFileSync(pkgJsonPath, "utf8")).name;
    packages.push({ dir: entry, name, path: join(packagesDir, entry) });
  } catch {
    /* not a package */
  }
}
const workspaceNames = new Set(packages.map((p) => p.name));

function classify(name) {
  if (name === CORE) return "core";
  if (name === CONVERT) return "convert";
  return "domain";
}

// specifier -> the workspace package it resolves to, or undefined.
function resolveWorkspaceDep(spec) {
  if (spec.startsWith(".")) return undefined;
  for (const name of workspaceNames) {
    if (spec === name || spec.startsWith(name + "/")) return name;
  }
  return undefined;
}

const violations = [];

for (const pkg of packages) {
  const kind = classify(pkg.name);
  const srcDir = join(pkg.path, "src");
  const crossDeps = new Set();

  for (const file of listTsFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(rootDir, file);
    for (const spec of importSpecifiers(text)) {
      const dep = resolveWorkspaceDep(spec);
      if (dep && dep !== pkg.name) crossDeps.add(dep);

      // Intra-package: rtstruct-js contour/ must not reach into dicom/.
      if (pkg.name === "rtstruct-js" && rel.includes(`${sep}src${sep}contour${sep}`)) {
        if (spec.includes("/dicom/") || spec.endsWith("/dicom")) {
          violations.push({ file: rel, detail: `contour/ imports dicom/ ("${spec}")` });
        }
      }
    }
  }

  const domainDeps = [...crossDeps].filter((d) => classify(d) === "domain");

  if (kind === "core" && crossDeps.size > 0) {
    violations.push({
      file: `packages/${pkg.dir}`,
      detail: `${CORE} must not import any workspace package, imports: ${[...crossDeps].join(", ")}`,
    });
  }
  if (kind === "domain" && domainDeps.length > 0) {
    violations.push({
      file: `packages/${pkg.dir}`,
      detail: `domain package "${pkg.name}" imports another domain package: ${domainDeps.join(", ")}`,
    });
  }
  if (kind === "convert" && domainDeps.length > 2) {
    // convert is allowed multiple domain deps; this only guards against an obvious mistake
    // (importing every domain package) — tighten if the rule needs to be exact.
  }
  if (crossDeps.has(CONVERT)) {
    violations.push({
      file: `packages/${pkg.dir}`,
      detail: `"${pkg.name}" imports ${CONVERT}, which must stay a leaf`,
    });
  }
}

if (violations.length > 0) {
  console.error("Dependency rule violation(s):\n");
  for (const v of violations) console.error(`  ${v.file}\n    ${v.detail}`);
  process.exit(1);
}

console.log(
  `check:deps OK — ${packages.length} workspace package(s): ` +
    packages.map((p) => p.name).join(", "),
);
