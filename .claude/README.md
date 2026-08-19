# Spec staging

Source-of-truth materials for v0.1, copied in from the sibling folder before
any implementation existed. Not yet wired into a buildable project.

- `IMPLEMENTATION_PLAN.md` — phase order, scope freeze, invariants.
- `spec/src/types.ts` — the public type surface (`GridGeometry`, `Mask3D`,
  `Provenance`, `Diagnostic`, ...). Belongs at `src/types.ts` at repo root.
- `spec/tests/unit/*.test.ts` — the 9 "Phase 0" spec files (44 tests per the
  plan). Import paths (`../../src/...`, `../helpers.js`) assume they land at
  `tests/unit/*.test.ts` in a repo with `src/` and `tests/helpers.ts` at the
  root — i.e. this `spec/` folder's layout should be copied up as-is.

## Status

The real tree now exists at the repo root (`src/`, `tests/`, `package.json`,
`tsconfig.json`, `vitest.config.ts`, `scripts/check-dependency-rule.mjs`) —
this `spec/` folder is kept only as the original staged snapshot.

Phase 1 (geometry core) is implemented and green: `vec3.ts`, `tolerance.ts`,
`grid-geometry.ts`, `plane-sort.ts`.

Phase 2 (mask and phantoms) is implemented and green: `mask/mask3d.ts`
(`createEmptyMask`/`maskFromDense`, with the SEC-01 voxel-count check run
*before* allocation) and `cubePhantom` in `phantom/index.ts`. Per-plane
thickness is the average distance to neighboring planes (falls back to the
single-neighbor distance at the ends of the stack), which reduces to the
uniform slice spacing for `createUniformGrid` grids — confirmed exactly by
VOL-01/VOL-02. VOL-04 now genuinely exercises `cubePhantom` before hitting
the intended `NotImplementedError` on `{method: "contour"}`, no longer a
technicality.

Phase 3 (rasterization and holes) is implemented and green:
`contour/rasterize.ts`. All three hole encodings (nested `CLOSED_PLANAR`,
`CLOSEDPLANAR_XOR`, keyhole) reduce to one algorithm — combine every
fillable contour's edges on a plane into a single list and run an even-odd
ray-cast with the half-open rule (`y0 <= y < y1`) per pixel center. Parity
is direction- and winding-independent, so nested rings and XOR pairs are
handled identically; a keyhole's out-and-back channel edges cancel exactly
under the half-open rule instead of double-counting and filling the hole
solid. `holeInterpretation` is recorded as a provenance label only — it
does not change which algorithm runs.

Phase 4 (vectorization and round trip) is implemented and green:
`contour/vectorize.ts`, `metrics.ts`, `spherePhantom`/`torusPhantom`, and
`RTStructImpl.load`/`.createFromMask` in `src/index.ts`.

`vectorize()` traces each filled cell's boundary edges in the unit-square
lattice (a cell at (row, column) occupies the square centered on it, with
corners at half-integer offsets) and stitches them into closed loops —
this is the exact inverse of `rasterize()`'s point-sampling: boundaries
always sit at half-integer coordinates, so they never touch the integer
sample points rasterize() tests, and the round trip is exact rather than
approximate for a single mask <-> contour <-> mask pass. `RTStructImpl`
wraps `vectorize()`'s output in a **private JSON wire format** (not DICOM)
to drive the round trip — this is scaffolding only; Phase 5 replaces
`load()`/`createFromMask()` with real `dicom/port.ts` I/O, but
`vectorize()`/`rasterize()` themselves do not change.

`npx vitest run` reports 39/44 passing: everything through Phase 4,
including RT-01…05. It also incidentally passes IO-06/07/08, since those
only exercise `createFromMask()` → `load()` behavior (three sequences
present, `holeInterpretation` defined, `interpretedType` defaults to
`ORGAN`) rather than real DICOM bytes. IO-01…05 remain — they need
`buildFixture`, a real DICOM fixture builder that doesn't exist yet
(Phase 5 scope, alongside `dicom/port.ts` and tolerant-reading diagnostics
like `MISSING_RT_ROI_OBSERVATIONS`).

Phase 5 (DICOM read/write) is implemented and green: `dicom/port.ts` (the
only `dcmjs` importer), rewired `RTStructImpl.load`/`.createFromMask`
(replacing the Phase 4 private JSON wire format entirely), and
`tests/fixtures.ts`'s `buildFixture` (wired in as a real `globalThis`
global via `tests/setup.ts` + `vitest.config.ts`'s `setupFiles`, since
`io.test.ts` references it as an untyped ambient global, not an import).

Two non-obvious correctness issues surfaced and were fixed:

- **ROI name padding ambiguity.** DICOM's LO VR pads odd-length values with
  one trailing space to reach even byte length, and PS3.5 defines trailing
  space as non-significant — so a standards-compliant reader (dcmjs's
  `naturalizeDataset`) always strips it, silently breaking "never normalize
  ROI names" for names that end in a *genuine* space (IO-04's `"gtv_p "`),
  while `forceStoreRaw`'s untrimmed `_rawValue` alone breaks odd-length
  names by keeping padding that was never real content (`"PHANTOM"` came
  back `"PHANTOM "`, which then failed RT-01…05's `getMask("PHANTOM")`).
  Neither "always trim" nor "never trim" is correct — the two cases are
  genuinely indistinguishable from the stored bytes alone. Fixed by writing
  the name's exact character count into a private tag (`(0009,1001)`,
  unregistered, self-consistent — only our own reader ever looks at it) and
  comparing it against the raw value's length on read: equal lengths mean
  no padding was added (keep the raw value, trailing space and all); a
  1-character excess means padding was added (strip exactly it).
- **DS 16-character limit.** Full-precision floats from `vectorize()` (e.g.
  `-1.4849242404917504`) silently truncated when written as ContourData,
  which is capped at 16 characters — dcmjs slices the string blind, not the
  number. Fixed by rounding every coordinate to 6 decimal places before
  writing, which is far more precision than any of this project's tolerance
  gates need and stays safely under the limit for realistic coordinate
  magnitudes.

`npx vitest run` reports **44/44 passing — v0.1 complete** per
IMPLEMENTATION_PLAN.md section 8's exit criteria (test-wise; still needs a
license decision and its own final review pass, see the root README).

**Caveat carried over from `npm install dcmjs`:** it declares
`engines.node >= 22.13` while this environment runs Node 20.10.0 (a
warning, not a hard failure — the full test suite passes on 20.10.0
regardless) and pulls in `adm-zip`, which carries a high-severity advisory
(crafted ZIP triggers ~4GB allocation). `dicom/port.ts` never touches
dcmjs's zip/anonymizer/DICOMDIR features — only `DicomDict`, `DicomMessage`,
`DicomMetaDictionary` — so the vulnerable code path is never reached here.
**Decision (user call): accepted for now.** Revisit if dcmjs ships a fix,
or before deploying this anywhere with stricter requirements. The only
clean fix otherwise is downgrading to `dcmjs@0.29.6`, a semver-major step
backward.

## Packaging (post-Phase-5)

Added `tsconfig.build.json` (emits `dist/` — declarations included, `src/`
only) and `package.json` `main`/`types`/`exports`/`files`/`build`/
`prepublishOnly`. `"private": true` stays on until someone deliberately
decides to publish — `npm publish` is a real, public, one-way action, not
something to trigger as a side effect of "make it buildable."

**Two real bugs surfaced by actually installing the built tarball into a
separate Node project and running it** (`npm pack` → `npm install
./rtstruct-js-0.1.0.tgz` in a scratch dir → plain `node consumer.mjs`,
no bundler) — neither was caught by this repo's own test suite, because
vitest's bundler-based module resolution is more forgiving than Node's
native ESM resolver:

1. **dcmjs's dual-package hazard.** Its `package.json` maps the ESM
   `"import"` condition to `build/dcmjs.es.js` — a file containing `export`
   syntax but with no `"type": "module"` of its own and no `.mjs`
   extension. Node's spec-compliant resolver decides CJS-vs-ESM from the
   file's own extension/`type` field, not from which `exports` condition
   led to it — so it parses that file as CommonJS and throws a
   `SyntaxError` on the first `export`. Fixed in `dicom/port.ts` by loading
   dcmjs via `createRequire(import.meta.url)("dcmjs")` instead of a static
   `import` — this forces Node's `"require"` condition (`build/dcmjs.js`,
   genuinely CJS) regardless of our own module being ESM. Also let
   `@types/node` replace the ad hoc `"DOM"` lib entry and the
   `dicom/dcmjs.d.ts` ambient module stub (both now unnecessary) —
   `createRequire`'s return type is untyped by design, so nothing about
   dcmjs needs its own declaration file anymore.
2. **`src/index.ts` only exported `RTStructImpl`.** Fine for source-tree
   tests (which import every module by relative path directly), useless as
   a published package — nothing else was reachable, so a real consumer
   couldn't build a `GridGeometry` or a phantom at all. Fixed by
   re-exporting `types.js`, `errors.js`, `contour/*.js`,
   `geometry/*.js` (grid-geometry, tolerance, vec3, plane-sort),
   `mask/mask3d.js`, `phantom/index.js`, and `metrics.js` from the barrel.
   `dicom/port.ts` is deliberately NOT re-exported — `RTStructImpl` stays
   the one public DICOM I/O surface, per IMPLEMENTATION_PLAN.md section 1.

Verified end to end against the actual installed tarball, not just typing:
import, `createFromMask`, `load`, and a Dice-1.0 round trip all ran
correctly from `rtstruct-js` as a package name in a separate Node process.
