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

## Published

MIT license added (`LICENSE`, `package.json` `license`/`author`). User set
up an npm account, logged in (`npm whoami` → `adeelbarki`), `"private":
true` was removed, and `rtstruct-js@0.1.0` was published to the public
registry. The root README was rewritten accordingly — the pre-publish
"how to publish" instructions and the full dcmjs postmortem narrative both
moved out of the public README (which now just says "published," links
the npm page, and gives a one-line dcmjs caveat) and live here instead,
since that level of detail is dev/maintainer history, not user-facing
package documentation. `.claude/*` is also no longer linked from the
public README — those files aren't shipped in the package (`files:
["dist"]`) and the links were dead weight for anyone landing on the npm
page.

Next version bump (whenever it happens): `npm version patch|minor|major`
then `npm publish` again — `0.x` is understood as "not yet stable," so
breaking changes don't require a major bump until `1.0.0`.

npm/GitHub metadata added post-publish (`keywords`, `repository`,
`homepage`, `bugs` in `package.json`) — won't show on the npm page until
the next version is published, since npm renders each version's own
`package.json`.

## `readSeriesGeometry` — SeriesGeometry from real CT/MR files

The biggest practical gap flagged after publishing: every consumer had to
hand-build a `GridGeometry` themselves — no path from "I have real CT/MR
slice files" to a usable geometry. Went back to
`IMPLEMENTATION_PLAN.md` section 1 to confirm scope before building
anything: `SeriesGeometry` was **already listed as in-scope, non-negotiable
v0.1** (alongside `GridGeometry`, tolerances, plane ordering, diagnostics,
provenance, phantoms, the round-trip gate), and `types.ts` already defined
`SeriesGeometry`/`DicomSliceReference` for exactly this — Phases 1–5 just
never got around to building it. Not scope creep; the missing piece of the
original plan.

New: `src/dicom/series-geometry.ts` — `readSeriesGeometry(instances:
ArrayBuffer[])`. Design choices:

- Kept `dicom/port.ts` as the literal (not just conventional) sole dcmjs
  importer by extracting a small `readDicomDataset()` helper from
  `readRTStruct()` and exporting it; `series-geometry.ts` calls that
  instead of touching dcmjs directly. `readRTStruct()` itself is
  behavior-preserving after the refactor (covered by the existing IO-*
  tests).
- Reused `createGridGeometry()` as-is for the actual plane sorting/dedup/
  parallelism rejection — no new geometry math. The only new logic is
  DICOM tag extraction (`SOPInstanceUID`, `ImagePositionPatient`,
  `ImageOrientationPatient`, `PixelSpacing`, `Rows`, `Columns`,
  `FrameOfReferenceUID`) and cross-instance consistency validation.
- Rows/columns/pixel spacing/orientation inconsistency across instances
  **throws** (`InconsistentSeriesError`, new in `errors.ts`) rather than
  producing a diagnostic — v0.1's grid model has exactly one value for
  each, not per-plane, so there's no tolerant fallback to offer, same
  reasoning as `NonParallelPlanesError`.
- `SLICE_ORDER_REVERSED` — a `DiagnosticCode` that already existed in
  `types.ts` and was unused anywhere in the codebase — turned out to be
  exactly the right fit here: emitted when the input array's z-projections
  are strictly decreasing (the exact reverse of the sort order
  `createGridGeometry` requires). Strong signal this is what it was added
  for originally.
- `readSeriesGeometry` is re-exported from `src/index.ts` (unlike
  `dicom/port.ts`'s ROI read/write internals) — there's no higher-level
  wrapper class for it the way `RTStructImpl` wraps RTSTRUCT I/O, so it's
  a standalone public function.

Test fixtures: new `writeCTSlice()` in `port.ts` (test-fixture-only, same
category as `writeRTStruct`'s `shuffleSequences`/`omitRTROIObservations`
knobs — real code never writes a CT image, only tests need one). New
`tests/unit/series-geometry.test.ts`, named descriptively rather than with
fake spec IDs (`GEO-2x` etc.) since this is new functionality added after
the original 44-test v0.1 contract, not part of it. 4 tests: consistent
series builds the expected grid, reversed input triggers the diagnostic
and still sorts correctly, mismatched `PixelSpacing` throws, single-
instance series still works.

**Bug caught while writing `examples/05-series-geometry.ts`:** used
illustrative UIDs like `"...3680043.example.series"` (readable, but
contains letters). DICOM UIDs are strictly digit-and-dot notation per
PS3.5, and dcmjs's `UniqueIdentifier` VR silently strips any character
that isn't `0-9` or `.` on read (`removeInvalidUidChars`) — so the example
printed `frameOfReferenceUID: 1.2.826.0.1.3680043..` (letters gone, dots
collapsed together). Not a library bug, but real, correct DICOM behavior
that would have shipped a broken example. Fixed by using purely numeric
UIDs, matching real-world DICOM convention. The test file was already
numeric-only and unaffected.

`npm run typecheck`, `check:deps`, and `npm test` all green — 48/48
(44 original + 4 new). Rebuilt, packed, and verified end to end against
the actual installed tarball again: `readSeriesGeometry` reachable from
`"rtstruct-js"`, `writeCTSlice` correctly NOT reachable (confirmed via
`SyntaxError: does not provide an export named 'writeCTSlice'`), and a
synthetic multi-slice series correctly round-tripped through
`RTStructImpl.createFromMask`/`.load`.

Not yet done: trying this against a real downloaded DICOM series (user is
sourcing one from TCIA); CI; a `.github/workflows` file.

## 0.2.0 correctness pass — Frame of Reference bug + external review fixes

Reviewing the codebase against 0.2.0 goals ("correctness over features")
surfaced a real bug in already-shipped 0.1 surface: `GridGeometry.equals()`
never compared `frameOfReferenceUID` despite `fingerprint()` already
including it, so two grids in different, non-comparable coordinate systems
could test as equal. Fixed: `equals()` now short-circuits to `false` when
both sides declare a FoR and they differ; falls through (unaffected) when
either side is unset, since `createUniformGrid`/phantoms never set one.
Compounding it, `RTStructImpl.load()` never read the RTSTRUCT's own
`ReferencedFrameOfReferenceUID` (Type 1 per ROI, PS3.3 C.8.8.5) at all — no
cross-check existed between what the file declares and the geometry the
caller supplies. Fixed via a new `FRAME_OF_REFERENCE_MISMATCH` diagnostic
plus a new `FrameOfReferenceMismatchError`, gated on `LoadOptions.strictness`
(`"warn"` default/diagnostic-only, `"strict"` throws, `"silent"` neither) —
the first real use of `strictness`, which was previously accepted but never
read anywhere. 8 new tests (GEO-08..10, IO-09..13), 56/56 green at that
point.

Also caught during the same review, still open (0.2.0/0.3.0 candidates, not
yet fixed): `Provenance.sliceAssociation` is typed as
`"sop-reference" | "geometric-fallback"` but only `"geometric-fallback"` is
ever produced — `ContourImageSequence` is never read. `holeInterpretation`
is inferred from contour *count* on a plane, not verified geometric
nesting — two disjoint non-nested shapes get labeled `"nested-even-odd"`
same as genuinely nested ones (fill is correct either way; only the
provenance label is a guess). `HoleInterpretation` includes `"keyhole"` but
nothing ever produces it. `CONTOUR_PLANE_DISTANCE` and
`MISSING_CONTOUR_IMAGE_SEQUENCE` are dead `DiagnosticCode`s, never emitted.
`isUniformlySpaced()` exists on `GridGeometry` but nothing calls it.

Separately, ran an external README/API review and fixed what didn't need
CI (CI itself stays deferred per user instruction):

- **`RTStructImpl` → `RTStruct`.** The `-Impl` name was scaffolding that
  leaked into the public API. Renamed the class; kept `RTStructImpl` as a
  `@deprecated` alias (both type and value position) so nothing breaks —
  tested explicitly (IO-14: `RTStructImpl === RTStruct`, still functions).
  All internal usage (examples, tests, README) switched to `RTStruct`.
- **Added a `## Limitations` section** near the top of the README — no
  `volume({ method: "contour" })`, no boolean ops/margin/centroid utility,
  parallel-planes-only, geometry must be supplied by the caller, plus the
  two still-open provenance gaps above (slice association, hole labeling)
  disclosed explicitly rather than left implicit.
- **Added a feature bullet for the three-hole-encoding equivalence**
  (nested/XOR/keyhole → identical mask) near the top — previously only
  visible as an error class name. Deliberately did *not* reuse the
  reviewer's exact suggested wording ("validated against a torus with a
  closed-form volume") since that conflates two different tests:
  `holes.test.ts` proves the three encodings agree with each other (on a
  plain ring, no closed-form check), while `phantom.test.ts`'s torus test
  separately verifies round-trip volume against a closed-form value. Stated
  both claims accurately instead of merging them into one.
- **Moved the dcmjs/adm-zip advisory disclosure** out of the second
  paragraph into a `## Dependencies` section near the bottom, wording
  unchanged, so a first-time reader sees what the library does before
  seeing a security advisory.
- **Fixed the stale "44 tests" claim** (README hadn't been updated since
  before the FoR fix; actual count is 57 as of this pass).
- **Not done, and deliberately not attempted here:** GitHub repo topics,
  the repo's About-sidebar description text, and tagging `v0.1.0` on the
  remote. No `gh` CLI is installed in this environment, and pushing a tag
  is a visible/shared-state action — these need the user to do directly
  (or explicitly ask for the tag push) rather than being silently taken.

Added `CHANGELOG.md` and bumped `package.json`/`package-lock.json` to
`0.2.0` via `npm version minor --no-git-tag-version` (deliberately no git
commit or tag — user wants to review and commit/push themselves).

## `vec3.ts` robustness — external review, same session

Second external review, this time of `src/geometry/vec3.ts`. Two findings,
both verified by tracing the actual math before agreeing with any of it:

1. `normalize()` checked `len === 0`, so a vector like `[1e-15, 0, 0]`
   (plausible floating-point noise, not a real direction) passed the check
   and got scaled by `1/1e-15`, producing a wildly unstable "unit" vector.
2. `normalize([NaN, 0, 0])` and `normalize([Infinity, 0, 0])` both silently
   produced `[NaN, NaN, NaN]` — traced exactly: `NaN === 0` is `false`, so
   the check never catches it; `Infinity * 0 = NaN` in the Infinity case.

Fix, matching the reviewer's own proposed architecture (validate at the
boundary, not in every primitive): `normalize()` now throws on non-finite
input and on near-zero (not just exactly-zero) length. This works as the
boundary check for free because `normalize()` is *only* ever called at grid
construction (`createGridGeometry`'s row/column direction and their cross
product, `sortPlanes`, `angleBetween`) — never per-voxel or per-contour-point
— confirmed via grep before relying on it. `add`/`dot`/`cross`/`scale` stay
unchecked, per the reviewer's explicit preference, since they're hot-path
primitives that should trust their inputs.

Found one gap the review's diagram didn't cover: plane *positions*
(`ImagePositionPatient`) never pass through `normalize` — they only hit
`dot`/`sub` in `sortPlanes`/`findNearestPlane`, so a NaN position would have
silently corrupted a distance/sort comparison without ever reaching the new
guard. Added a matching finite-check in `sortPlanes` (`RangeError`, same
pattern `series-geometry.ts`'s `extractInstance` already uses for malformed
DICOM fields) to close that half of the chain too.

Also fixed the `angleBetween` doc comment: it claimed "independent of
magnitude or sign convention," but flipping one input's sign flips
`cosTheta`'s sign and `acos(-x) = π - acos(x)` — a genuinely different
angle. Only the magnitude-independence claim was true.

While adding tests for this, caught and fixed a real bug from the earlier
FoR-fix session in the same sitting: the new GEO-08/09/10 tests added to
`tolerance.test.ts` collided with `plane-sort.test.ts`'s pre-existing
`GEO-10` (part of the original frozen v0.1 spec). Renamed the three new
ones to plain descriptive names — matching the convention
`series-geometry.test.ts` already established for genuinely-new,
not-part-of-the-original-spec tests — rather than extending fake spec IDs.

New tests: `tests/unit/vec3.test.ts` (new file — `vec3.ts` had no dedicated
test file before, only indirect coverage via grid-geometry/plane-sort
tests) plus one new case in `plane-sort.test.ts`. 65/65 green, typecheck
and build clean. `CHANGELOG.md`'s `[0.2.0]` entry updated with this batch
before anything is committed.
