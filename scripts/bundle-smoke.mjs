#!/usr/bin/env node
// Browser-bundle smoke test. For each published package, bundle its built entry point for
// `platform: "browser"` and check the import graph resolves with nothing Node-only leaking
// in unshimmed. This is not a functional test — it catches "this package can't even be
// bundled for the web" regressions, which the Node-run vitest suite would never see.
//
// - rt-geometry-js: zero dependencies -> must bundle clean with NO externals.
// - domain packages: `dcmjs` is a peer the consuming app provides, so it's marked
//   external; anything ELSE that's Node-only (a `node:` builtin reached at module scope)
//   is reported. `dicom/port.ts` uses `createRequire` from `node:module` to load dcmjs's
//   CJS build — a known limitation, surfaced here rather than hidden.
//
// Run after `npm run build`. Exit non-zero only on an outright bundle failure or an
// unexpected Node builtin; the known `node:module` use in the domain ports is reported as
// a warning.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ name: string, entry: string, external: string[], allowNodeBuiltins: string[] }[]} */
const targets = [
  { name: "rt-geometry-js", entry: "packages/geometry/dist/index.js", external: [], allowNodeBuiltins: [] },
  { name: "rtstruct-js", entry: "packages/rtstruct/dist/index.js", external: ["dcmjs"], allowNodeBuiltins: ["node:module"] },
  { name: "rtdose-js", entry: "packages/rtdose/dist/index.js", external: ["dcmjs"], allowNodeBuiltins: ["node:module"] },
  { name: "dicom-seg-js", entry: "packages/dicom-seg/dist/index.js", external: ["dcmjs"], allowNodeBuiltins: ["node:module"] },
  { name: "rt-convert-js", entry: "packages/convert/dist/index.js", external: ["dcmjs", "rt-geometry-js", "rtstruct-js", "dicom-seg-js"], allowNodeBuiltins: ["node:module"] },
];

const NODE_BUILTIN = /^node:|^(fs|path|os|crypto|module|util|stream|http|https|net|zlib|child_process|worker_threads)$/;

let failed = false;

for (const t of targets) {
  const entry = resolve(root, t.entry);
  /** @type {Set<string>} */
  const nodeBuiltinsSeen = new Set();

  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
      external: t.external,
      metafile: true,
      plugins: [
        {
          name: "flag-node-builtins",
          setup(b) {
            b.onResolve({ filter: NODE_BUILTIN }, (args) => {
              nodeBuiltinsSeen.add(args.path);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });

    const bytes = result.outputFiles.reduce((n, f) => n + f.contents.length, 0);
    const unexpected = [...nodeBuiltinsSeen].filter((b) => !t.allowNodeBuiltins.includes(b));
    const known = [...nodeBuiltinsSeen].filter((b) => t.allowNodeBuiltins.includes(b));

    if (unexpected.length > 0) {
      failed = true;
      console.error(`✗ ${t.name}: bundled, but pulls in unexpected Node builtin(s): ${unexpected.join(", ")}`);
    } else if (known.length > 0) {
      console.log(
        `⚠ ${t.name}: bundles for browser (${(bytes / 1024).toFixed(0)} KB), with the known ` +
          `${known.join(", ")} use for loading dcmjs — a bundler/app must handle it (see README "Runtime support").`,
      );
    } else {
      console.log(`✓ ${t.name}: bundles clean for platform:browser (${(bytes / 1024).toFixed(0)} KB, no externals needed).`);
    }
  } catch (err) {
    failed = true;
    console.error(`✗ ${t.name}: failed to bundle for platform:browser\n${err && err.message ? err.message : err}`);
  }
}

if (failed) {
  console.error("\nbundle-smoke: FAILED");
  process.exit(1);
}
console.log("\nbundle-smoke: OK");
