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

Committed as `58d50d0` and tagged `v0.2.0` (annotated, local only — not
pushed, since more 0.2.0 fixes were expected and the user is committing/
pushing themselves once everything's in).

## `sortPlanes` duplicate-detection bug — third external review, same session

Third external review finding, and a real one: `sortPlanes`'s duplicate-
plane dedup reused `tolerance.positionMm` (default 0.5mm) — the same field
`GridGeometry.equals()` uses to decide whether two whole grids represent the
same geometry. Those are different questions at different scales. Concrete
failure the reviewer gave: slice A at 10.0mm, slice B at 10.4mm — a normal
thin-slice CT spacing — differ by 0.4mm, which satisfies
`0.4 <= 0.5`, so slice B was silently dropped as a "duplicate" and real
image data was lost. The one existing test for dedup (`GEO-12`) only ever
exercised a `1e-7mm` difference, confirming the original intent was
floating-point round-trip noise, not real spacing.

Fix: dedup now uses its own fixed constant,
`DUPLICATE_PLANE_EPSILON_MM = 1e-3`, entirely decoupled from
`tolerance.positionMm` — not exposed as a caller-tunable knob, since there's
no legitimate reason to loosen "is this literally the same plane" toward
real slice-spacing territory. `tolerance.positionMm` keeps its two
legitimate jobs (off-axis parallelism check in the same function,
`equals()`'s whole-grid position comparison) unchanged.

New test in `plane-sort.test.ts` reproduces the reviewer's exact numbers
(10.0mm / 10.4mm) as a regression guard. `GEO-12`'s existing sub-micron case
still passes unchanged. 66/66 green, typecheck and build clean. Not yet
committed — this is the second item in the "fix more things before the
v0.2.0 tag" round the user asked for after the first commit/tag.

## Third `positionMm` reuse — off-axis parallelism check, same review

The reviewer found a *third* meaning sharing `positionMm`: `sortPlanes`'s
off-axis check (`perpendicularOffset(...) > tolerance.positionMm`), which
answers "does this plane sit on the shared stacking axis" — different from
both `equals()` (are two already-built grids the same geometry) and the
dedup constant just fixed above (is this literally the same plane).

First proposed fix was wrong and I said so before implementing: adding a
new public `GridTolerance.offAxisMm` field. Caught the actual problem on
a second look — `createGridGeometry` never passes a `tolerance` argument
through to `sortPlanes` at all, so there's no live per-call coupling
between `equals()`'s tolerance and this check; they only share a *default
value* via `DEFAULT_TOLERANCE`, read at different times, never interacting.
Adding a new caller-facing field would have been API surface for a knob
nothing can currently turn — premature given the project's own stated
minimalism. Corrected to the same treatment as the dedup fix: a dedicated
internal constant, `OFF_AXIS_TOLERANCE_MM = 0.5` in `plane-sort.ts`, not a
`GridTolerance` field. Noted in its comment as the value to promote into a
real parameter if `createGridGeometry` ever gains actual tolerance
passthrough.

Side effect worth flagging: since both tolerances `sortPlanes` needs are
now dedicated constants, its `tolerance: GridTolerance` parameter became
entirely dead code — confirmed via grep that nothing anywhere ever passed
a third argument to `sortPlanes()`. Removed the parameter outright rather
than leave a vestigial unused argument. This is a breaking signature change
to an exported function (`sortPlanes` is re-exported from the public entry
point), acceptable pre-1.0 and called out explicitly in `CHANGELOG.md`.

66/66 still green after the signature change (no call site anywhere,
including tests, ever used the third argument). Typecheck and build clean.
Not yet committed.

## Non-orthogonal row/column basis — fourth review finding, same session

While tracing the `positionMm` reuse, the reviewer found something outside
`tolerance.ts` entirely: `createGridGeometry()` normalizes `rowDirection`
and `columnDirection` independently but never checks they're orthogonal to
each other. Verified with a concrete numeric trace before agreeing, not
just symbolically: with `row=[1,0,0]`, `column=[0.5,1,0]` (normalizes to
≈`[0.447,0.894,0]`, ~63.4° apart instead of 90°),
`patientToPixel(indexToPatient(1, 0, 0, plane))` returns `row ≈ 0.4472`
instead of the `0` it started as. Traced why: `indexToPatient` builds a
point as `rowDirection*column*spacing + columnDirection*row*spacing`, and
`patientToPixel`'s dot-product inverse only cancels the cross term when
`dot(row, column) = 0`. Non-orthogonal input doesn't error anywhere — it
silently returns wrong pixel coordinates, which `rasterize()`'s
`contourEdges` depends on for every contour point on every plane. This
matches DICOM PS3.3 C.7.6.2.1.1: `ImageOrientationPatient` direction
cosines are Type 1 and required orthogonal — so this is exactly the kind
of malformed/non-conformant real-world input the "tolerant reading, don't
hide ambiguity" invariant exists for.

Fixed in `createGridGeometry`, right after normalizing both directions:
compare `angleBetween(rowDirection, columnDirection)` against `π/2`, throw
a new `NonOrthogonalBasisError` if the deviation exceeds
`ORTHOGONALITY_TOLERANCE_RAD` (1e-3 rad, a dedicated constant — deliberately
**not** `GridTolerance.directionAngleRad`, which is a different job again:
`equals()`'s inter-grid "is rowDirection the same direction between two
grids" comparison, not an intra-grid basis-validity constraint checked once
at construction). Single choke point: `createUniformGrid` and
`readSeriesGeometry` both build on `createGridGeometry`, so real DICOM
`ImageOrientationPatient` values get the same protection automatically —
confirmed by checking both call through it, no separate check needed.

Checked every existing test/example that supplies a custom
`rowDirection`/`columnDirection` before trusting nothing would break:
`phantom.test.ts`/`transform.test.ts` use a 45°-rotated but still-orthogonal
basis (`Math.SQRT1_2` pairs, confirmed `dot = 0`) — safe. 3 new tests added
(non-orthogonal rejected with the exact reviewer numbers, exactly-orthogonal
accepted, sub-degree noise within tolerance accepted). 69/69 green,
typecheck and build clean. Not yet committed — third item in the same
"fix more before re-tagging v0.2.0" round.

## Stale doc comment — fifth review finding, same session

Small one: `tolerance.ts`'s comment still said "re-derive from real
multi-vendor data before v0.1 ships" — leftover from before v0.1 actually
shipped. Rewrote it to document what each field means and why (now cleanly
scoped to exactly one job — comparing already-built grids/instances, not
construction-time validation — after this session's other fixes pulled
dedup/off-axis/orthogonality out into their own dedicated constants), and
kept the honest "not yet re-derived from real vendor data, no vendor files
exist in this repo" note rather than pretending the numbers are final.
Typecheck/tests still clean (69/69), no behavior change. Not yet committed.

## Sixth review — grid-geometry.ts batch: two already-fixed, several new, one asked

A large multi-part review of `grid-geometry.ts`. Triaged before touching
anything:

**Already fixed, not still open** (confirmed by re-reading current file
state, not assumed): orthogonality — done two turns ago
(`NonOrthogonalBasisError`). FoR-vs-`equals()` — done three turns ago, and
resolves *opposite* to what the review's hypothetical assumed: two grids
with different, both-declared FoRs already return `false`, not `true`.
Told the user directly rather than silently re-implementing something
already shipped.

**Implemented, unambiguous:**
- `createGridGeometry()`: validates `rows`/`columns` (positive integer),
  `pixelSpacing` (finite, > 0), `planePositions` (non-empty). All
  `RangeError`. The empty-grid case matches the reviewer's own conclusion —
  reject at construction rather than patch `findNearestPlane()`'s
  `{planeIndex: -1, distanceMm: Infinity}` sentinel; once construction
  guarantees ≥1 plane, that sentinel becomes unreachable for real
  `GridGeometry` instances without touching `findNearestPlane()` itself.
- `createUniformGrid()`: validates `planeCount` (positive integer) and
  `sliceSpacingMm` (finite, > 0) — reasoned the same way the reviewer did:
  since `createGridGeometry` sorts planes by position regardless of input
  order, a negative `sliceSpacingMm` has no observable effect on the
  result, so there's nothing legitimate to preserve by allowing it.
- `patientToPixel()`/`fingerprint()`: doc comments added on both the
  implementation and the `GridGeometry` interface itself (not just
  README), matching the reviewer's "document clearly, don't necessarily
  break the API" framing for `patientToPixel()` specifically.

**Asked, not assumed:** fingerprint()'s contract. Found a structural fact
before presenting options: `equals(other, tol?)` accepts an arbitrary
caller-supplied `GridTolerance` per call, but `fingerprint()` takes no
tolerance parameter at all — so no rounding scheme could ever fully
guarantee "equals()-true implies same fingerprint" for every possible
tolerance a caller might pass, only approximate it for `DEFAULT_TOLERANCE`.
Gave two options via AskUserQuestion: document-only (keep current
rounding, write an honest contract) vs. loosen rounding toward
`DEFAULT_TOLERANCE` granularity (better default-case alignment, still
can't cover custom tolerances, real added complexity for angle-bucketing
direction vectors). User picked document-only. Implemented as a contract
comment on `computeFingerprint()` and the interface doc in `types.ts`: a
match is a hint, a mismatch is not proof of inequality, don't build a
cache assuming the reverse.

11 new tests in `tolerance.test.ts` (rows/columns/pixelSpacing/
planePositions/planeCount/sliceSpacingMm validation). Checked no existing
test or example used any of the now-rejected values before trusting
nothing broke. 74/74 green, typecheck and build clean. Not yet committed —
fourth item in the same "fix more before re-tagging v0.2.0" round.

## Seventh review — mask3d.ts, four findings, all real

- **`get()` had zero bounds checking.** Worse than "wrong but plausible":
  `Uint8Array` returns `undefined` past its length, and `undefined !== 0`
  is `true` in JS, so an out-of-range call could fabricate a false
  "voxel is set" rather than aliasing a different real voxel or returning
  false. Fixed with a shared `validateIndex()` helper (integer + range
  check), used by both `get()` and `getSliceBuffer()`.
- **`getSliceBuffer()` silently clamped instead of throwing.**
  `TypedArray.subarray` clamps an out-of-range start to an empty result,
  and — more dangerous — treats a *negative* index as counting from the
  end, so `getSliceBuffer(-1)` would have silently returned real data from
  the wrong plane instead of erroring. Same `validateIndex()` fix.
- **Voxel-count multiplication had no overflow check.** `columns * rows *
  planes.length` can silently exceed `Number.MAX_SAFE_INTEGER` for
  dimensions that are each individually valid (verified: 100,000,000 x
  100,000,000 x 2 = 2e16 vs. `MAX_SAFE_INTEGER` ≈ 9.007e15) — and
  `createUniformGrid`'s rows/columns validation from the last round only
  checks "positive integer," no upper bound, so this is genuinely
  reachable. Added `safeVoxelCount()`, used by both `createEmptyMask` and
  `maskFromDense`, throwing `ResourceLimitError` before the existing
  `maxVoxels` comparison or allocation.
- **Single-plane volume silently reported 0 mm³.** `planeThicknessMm`
  special-cased `n === 1` to return `0`, making a single-plane mask's
  voxel volume always compute to zero regardless of how many voxels were
  set — indistinguishable from "computed, genuinely empty." A single plane
  has no second plane to measure slice thickness from; this is
  unknowable, not zero. Added `IndeterminateVolumeError`, checked once in
  `computeVoxelVolumeMm3` before the loop (not inside `planeThicknessMm`
  itself, which only had one call site — confirmed via grep — so the old
  `n === 1` branch there became genuinely dead code and was removed rather
  than left as unreachable defensive code).

Verified all 5 example scripts still run end-to-end after these changes
(`npx tsx examples/0*.ts`), not just the test suite — `mask3d.ts` is used
by nearly everything. 79/79 tests green, typecheck and build clean. Not
yet committed — fifth item in the same round.

## Eighth review — rasterize.ts, the biggest single fix of the round

Five findings, all confirmed real by reading the actual code before
touching anything (the ROI-wide `closedPlanarContours.length > 1` check,
sitting *before* the `byPlane` grouping that happens later in the same
function — an unambiguous ordering bug once pointed at).

**CONTOUR-003 + CONTOUR-004, fixed together** (tightly coupled — both are
about `holeInterpretation` being decided from the wrong information):
grouping by plane now happens *before* hole interpretation is decided, not
after. And "more than one contour on a plane" no longer automatically
means nested — added `hasNesting()`, which tests actual containment by
reusing the existing even-odd `isInside()` machinery (does a candidate
contour's first point land inside another contour's edges on the same
plane), rather than inferring nesting from a raw count. Disjoint islands
on one plane now correctly get `"none"`, not `"nested-even-odd"`; genuine
containment still correctly triggers `NESTED_CLOSED_PLANAR_INTERPRETED`,
now naming the actual plane index instead of a meaningless ROI-wide count.

**Slice association + coplanarity**: `grid.findNearestPlane()`'s
`distanceMm` was computed and silently discarded. Wired up
`CONTOUR_PLANE_DISTANCE` — a `DiagnosticCode` that has existed since an
early phase of this project but was never actually emitted anywhere,
confirmed via grep before use. Tolerance is derived locally per plane
(half the average neighbor spacing, same idea as `mask3d.ts`'s
`planeThicknessMm` but computed independently here rather than importing
across module boundaries for one calculation) — a single-plane grid has no
spacing to judge against, so nothing is ever flagged for one, matching the
"don't presume anomalous when we lack the info to judge" reasoning already
used for `IndeterminateVolumeError`. Extended the same check from "is the
contour's first point near its plane" to "is *every* point near it,"
closing the malformed-mixed-Z-contour gap in the same pass. Chose
diagnostic-only (not throw) for both — liberal reading stays the default,
consistent with `NESTED_CLOSED_PLANAR_INTERPRETED` already being `info`
rather than a rejection, and consistent with `CONTOUR_PLANE_DISTANCE`
having been designed as a diagnostic code from the start, not an error.

**Degenerate contours**: new `MalformedContourError`, checked against a
per-geometricType minimum point count at the very top of `rasterize()`,
before any other processing — matches the user's explicit "should never
reach rasterization" framing, and the existing precedent of hard-throwing
on genuinely unrepresentable input (`XorHomogeneityError`,
`NonOrthogonalBasisError`). Deliberately scoped to raw point count, not
true geometric uniqueness — noted directly in the code comment and to the
user, since "unique" would need its own tolerance decision not asked for
here.

**Unsupported geometric types**: new `UNSUPPORTED_CONTOUR_GEOMETRY`
diagnostic naming the type(s) and count skipped. Implemented the "at
minimum a diagnostic" floor the user gave, not the "potentially throw"
ceiling — an all-unsupported ROI still produces a legitimately empty mask
plus a diagnostic explaining why, rather than a hard failure.

Verification was unusually important here since this is a real algorithm
change, not just added validation: ran the *entire* existing test suite
before writing a single new test, confirming zero regressions first —
including `CTR-01` (genuinely nested rings, single plane) and the full
`phantom.test.ts` round-trip suite (sphere/torus through real vectorize →
rasterize), both passing unchanged. Then added 10 new tests covering every
finding, including a combined case (disjoint contours on plane 0, genuine
nesting on plane 1, in the same `rasterize()` call) to prove per-plane
independence rather than just per-finding in isolation. All 10 passed on
the first run, which is a fairly strong signal the design reasoning (traced
by hand for each case before running anything) was right, not just lucky.
Also re-ran all 5 example scripts end-to-end after the change, not just
the test suite, since `rasterize()` sits on the critical path for nearly
everything. 89/89 tests green, typecheck and build clean. Not yet
committed — sixth item in the same round.

## Ninth review — vectorize.ts, three findings

**VECTOR-001 (diagonal-touch ambiguity)**: hand-traced the exact
`[[1,0],[0,1]]` example before touching code — confirmed the current
`candidates.find(e => !used.has(e))` picks whichever edge was pushed
earlier into `boundaryEdges()`'s output, which for THIS specific case and
THIS specific row-major iteration order happens to produce the "right"
answer (two separate contours) — but only by accident, not by rule. Fixed
with the standard boundary-tracing resolution for 4-connectivity vs
8-connectivity: always take the sharpest clockwise turn relative to the
incoming edge (`turnRank()`, ranking straight/CW/back/CCW as 0/1/2/3).
Verified by hand with the actual vertex/direction math before writing the
implementation (incoming direction "down," candidate A turns 90° CW into
the voxel's own square, candidate B turns 90° CCW into the diagonal
neighbor — the rule picks A). Documented the resulting topology
explicitly: 4-connected foreground, 8-connected background — the standard
consistent pairing the reviewer asked about.

**VECTOR-002 (unclosed loops)**: added explicit `closed` tracking and a
new `UnclosedContourError`, thrown instead of silently pushing an open
path as `CLOSED_PLANAR`. Could not write a direct unit test without a
real tradeoff: `linkLoops` would need exporting from `vectorize.ts` to
test in isolation, but `index.ts` re-exports that whole file with
`export *`, which would leak an internal algorithm detail into the public
API — the exact mistake already fixed once this session with the
`RTStructImpl` rename. Caught this myself mid-edit (had exported it,
then reverted before running anything) rather than after the fact.
Left `linkLoops` unexported and undocumented the throw as
provably-unreachable-through-any-real-mask-buffer instead — consistent
with how this codebase already treats other internal `at()`-style
defensive checks (not unit-tested in isolation either, for the same
reason). Told the user directly rather than silently claiming full test
coverage.

**VECTOR-005 (no resource limit)**: found `ParserLimits.maxContourPoints`
already exists in `types.ts` but is completely unused anywhere (confirmed
via grep) — designed for exactly this, never wired up. Rather than
threading that specific field through, added a `maxVoxels` parameter to
`vectorize()` directly, mirroring `createEmptyMask`'s existing signature
pattern exactly. Exported `DEFAULT_MAX_VOXELS` from `mask3d.ts` (was
private) and reused it rather than duplicating the magic number — these
are the same underlying resource (a `Mask3D`'s voxel count) guarded at a
second choke point, unlike the earlier `positionMm`-reuse bugs where the
concepts were genuinely different. This closes a real gap:
`maskFromDense`-built masks never passed through `createEmptyMask`'s own
limit, so `RTStructImpl.createFromMask` (which calls `vectorize()`
internally) had no size guard at all before this. Did not implement the
other three limit types the reviewer offered (`maxContours`,
`maxPointsPerContour`, `maxTotalContourPoints`) — voxel count transitively
bounds all of them since edges/points scale with filled-voxel count, and
a single upfront check before any data structure is built is cheaper and
simpler than four downstream ones. Noted as an option for later if real
usage shows it's needed.

Ran the full existing suite before writing anything new — all passed
unchanged, including the sphere/torus round-trip tests, a good stress
test for the new turn-rank logic since real curved boundaries have many
turning vertices. Added 5 new tests (`tests/unit/vectorize.test.ts`, new
file): both diagonal orientations produce 2 contours, a true 4-connected
L-shape stays 1 contour (confirms the fix doesn't over-split legitimately
connected regions), and both resource-limit cases. All 5 passed first
try. Verified all 5 example scripts still run end-to-end afterward. 94/94
tests green, typecheck and build clean. Not yet committed — seventh item
in the same round.

## Tenth review — phantom module and test-architecture gap analysis

A 19-item review (`PHANTOM-001` through `PHANTOM-019`) arrived proposing a
much larger test-architecture overhaul: a `contourPhantoms/` module for
synthetic RTSTRUCT topology (XOR/keyhole/nested), a small-literal-mask
topology matrix (single voxel, checkerboard, island-in-hole, etc.), plus
several specific bugs in `src/phantom/index.ts`. Rather than implementing
all 19 blind, verified each claim against the actual code and test suite
first — several turned out to already be fixed by earlier work this
session, and two directly contradicted a design decision already made.

**Already covered, review was stale**: PHANTOM-009 (irregular plane
spacing) — RT-04 in `phantom.test.ts`. PHANTOM-011 (reject non-orthogonal
basis) — the GEO block in `tolerance.test.ts` from the grid-geometry.ts
batch. PHANTOM-017 (nested/XOR/keyhole produce the same mask) — already
CTR-01/02/03 in `holes.test.ts`, predating this review entirely (though
it only compares `mask.count()`, not full voxel equality — left as-is,
not worth the churn for this round). PHANTOM-013 (diagonal-touch
determinism) — literally the VECTOR-001 regression tests from the
previous batch.

**Design conflict, not a bug**: PHANTOM-018/019 want off-plane and
non-coplanar contours to throw. We deliberately chose "diagnostic, not
throw" for exactly this in the rasterize.ts batch (`CONTOUR_PLANE_DISTANCE`)
— liberal in reading, diagnostics over silent corruption. Asked the user
directly rather than silently picking a side; they confirmed keep current
behavior. Did not implement PHANTOM-018/019 as written.

**Real bugs, fixed** (matching patterns already established elsewhere in
the codebase, not new inventions):
- PHANTOM-003: `cubePhantom`/`spherePhantom`/`torusPhantom` had zero
  parameter validation — `spherePhantom(grid, -10)` silently produced an
  empty mask (`length(delta) <= -10` is never true) instead of rejecting
  invalid input, the same silent-corruption shape as the mask3d.ts and
  grid-geometry.ts findings from earlier batches. Added
  `validatePositive()`, applied to all size parameters. Also added
  `majorRadiusMm > minorRadiusMm` for the torus — not explicitly asked
  for as certain by the reviewer ("we may also want... depending on
  topology"), but genuinely necessary: below that threshold the tube
  self-intersects and `analyticVolumeMm3.torus`'s closed-form formula
  silently stops matching the actual enclosed volume, which would corrupt
  the module's own volume-based test assertions without any error.
- PHANTOM-005: all three phantom functions called `new Uint8Array(...)`
  directly, bypassing the `maxVoxels` budget `createEmptyMask()` already
  enforces — an oversized `GridGeometry` had no guard on the phantom path
  at all. Factored the check out of `createEmptyMask()` into a new
  exported `checkVoxelBudget()` in `mask3d.ts` (same logic, not
  duplicated — `createEmptyMask` now calls it too) and added an optional
  `maxVoxels` parameter to all three phantom functions, checked before
  any voxelization loop runs.

**Genuine test gaps, added** (chose targeted additions over the full
19-item scope — confirmed with the user via AskUserQuestion rather than
assuming): RT-06 anisotropic pixel spacing (`[0.5, 0.8]`, distinct slice
spacing) checked directly against the analytic sphere volume rather than
through a round trip, since a round trip can cancel out a symmetric bug
in both directions. RT-07 a genuinely tilted 3D grid normal — RT-03 only
ever rotated `rowDirection`/`columnDirection` within the z=0 plane, so
`normal()` stayed `[0,0,1]` in every existing test; this is the first
test where the normal itself is off-axis, which would catch code that
hardcodes "z" instead of calling `grid.normal()`. A sub-0.5mm plane
spacing test at the `createGridGeometry` integration level (not just the
`sortPlanes` unit level already covered) — this is a direct regression
lock for the `DUPLICATE_PLANE_EPSILON_MM` fix from the plane-sort.ts
batch, confirming the fix holds through the public constructor, not just
in isolation.

**Deferred, not implemented this round**: PHANTOM-001 (`contourPhantoms/`
directory restructuring — organizational, not correctness; `ring`/
`keyhole` helpers in `holes.test.ts` already serve this informally).
PHANTOM-006 (`createPhysicalPhantom` refactor — the reviewer's own
priority tag was 🟡, "only if adding more shapes"). The full small-
literal-mask topology matrix (single voxel, rectangle, disconnected
components, triple-nested island-in-hole, checkerboard, thin structures,
border contact) — real value, but the bulk of the review's volume; user
chose the smaller "bugs + missing geometry coverage" scope for this round
over the full matrix.

Added 9 new tests (8 in `phantom.test.ts`, 1 in `tolerance.test.ts`), all
passed first try — 103/103 total. Typecheck, build, and all 5 example
scripts clean. Not yet committed — part of the same round.

## Eleventh review — metrics.ts, the "same dimensions ≠ same grid" bug

Reviewer's framing: `dice()`/`voxelDisagreement()` compare mask buffers
index-by-index and never check `a.geometry.equals(b.geometry)` — two masks
with identical array dimensions but different physical pixel spacing get
compared as if voxel `[100,100,20]` meant the same patient location on
both, which it doesn't. Verified by reading `metrics.ts` directly: real,
confirmed exactly as described (METRIC-001/002). Also real: `centroidMm()`
returned `[0,0,0]` for an empty mask (METRIC-005, a fabricated coordinate
indistinguishable from a real ROI at the origin), `centroidDisplacementMm()`
never checked frame of reference (METRIC-004), and the centroid was an
unweighted mean even though this library explicitly supports irregular
plane spacing, where a thicker plane's voxel should count for more
(METRIC-006).

**Design call, not just a bug fix**: `dice`/`voxelDisagreement` (index-by-
index) vs `centroidDisplacementMm` (patient-space) don't need the same
strictness. Full `equals()` — including exact dimension match — is right
for the first two, since the comparison is only meaningful voxel-for-voxel
on an identical grid. But requiring full `equals()` for centroid comparison
would be too strict: two masks on different-resolution grids in the *same*
frame of reference are still comparable in patient-space mm. So
`centroidDisplacementMm` gets its own lighter check — same frame of
reference or nothing to compare — reusing `FrameOfReferenceMismatchError`
(already existed for exactly this invariant in `RTStruct.load`) rather than
inventing a new class for the same concept. New `GridMismatchError` for the
`dice`/`voxelDisagreement` case, since that's a genuinely different,
stricter invariant (one-class-per-invariant, matching every other error in
`errors.ts`).

**METRIC-005 fix shape**: rather than returning a sentinel or `undefined`
Vec3 from `centroidMm()` and pushing the empty-check onto every caller,
made it throw `IndeterminateCentroidError` directly — "a mask with zero
voxels has no centroid" is exactly the same kind of physically-indeterminate
quantity as the existing `IndeterminateVolumeError` (single-plane grid has
no derivable slice thickness), so it gets the same treatment. This also
correctly makes "both masks empty" throw instead of silently reporting
`0mm` — worth calling out since it's easy to fix only the "one empty, one
real" case and miss that the "both empty" case is just as wrong.

**METRIC-006 implementation**: exported `planeThicknessMm()` from
`mask3d.ts` (was private, already used internally by
`computeVoxelVolumeMm3`) rather than reimplementing the same neighbor-
distance averaging in `metrics.ts` — same reuse pattern as
`checkVoxelBudget()` in the phantom batch. Pixel area is a constant
multiplicative factor across every voxel in a given mask (same grid, same
`pixelSpacing`), so the weight only needs `planeThicknessMm(planeIndex)`,
not the full physical volume — it cancels out of the weighted mean either
way, so leaving it out isn't an approximation, it's exactly equivalent and
simpler. Guarded the single-plane case (weight = 1, skip calling
`planeThicknessMm` entirely) since that function itself assumes
`planes.length > 1` and throws otherwise via `at()`.

**Self-caught while verifying, not user-flagged**: running the fixed
`dice()` against `examples/03-compare-masks.ts` threw immediately — the
example itself built two separate `GridGeometry` objects differing only in
`origin` (to fake a spatial offset between "reference" and "predicted"
spheres) and compared masks across them, which is a live instance of
exactly the bug just fixed, in code we ship as documentation. Rewrote it to
build one shared grid and paint the offset sphere directly at an explicit
patient-space center (a small local `spherePhantomAt` helper in the example
script, not added to the library — this is a one-off demo need, not a
reusable phantom shape), rather than shifting the grid. Confirms the fix
is doing real work, not just satisfying its own new tests.

Wrote `tests/unit/metrics.test.ts` (new file, no prior test coverage for
this module at all) — grid-mismatch rejection (differing spacing, differing
dimensions), frame-of-reference cross-check (differing/matching/missing),
empty-mask rejection (one empty, both empty), and — the one worth being
careful about — a weighted-centroid test with a hand-computed expected
value, not just "doesn't throw": three planes at z=0/1/6 give plane
thicknesses 1/3/5, one voxel on plane 0 and one on plane 1 should land the
centroid at z=0.75 (volume-weighted), not z=0.5 (naive mean), verified by
comparing against a reference mask with a single voxel placed exactly at
the expected point and asserting near-zero displacement. Also verified the
uniform-spacing case is unaffected (z=1, the simple midpoint). All 9 passed
first try — 112/112 total. Typecheck, build, and all 5 examples clean.
Not yet committed — part of the same round.

## Twelfth review — comparing our work against a full 13-phase implementation plan

User supplied a large, well-structured implementation plan spanning geometry,
mask, rasterize, vectorize, a DICOM semantic model, ROI identity, provenance/
strictness, metrics, validation, and round-trip invariants, and asked for an
honest gap analysis against everything actually shipped this session. Rather
than reason from memory, verified the load-bearing claims directly:

- Grepped `src/index.ts`: ROI storage was `Map<string, StoredRoi>`,
  `rois.set(roi.name, ...)` — confirmed real, matching the plan's own release
  gate ("No silent duplicate ROI loss", "Duplicate ROI names are supported").
  Two ROIs sharing a name silently overwrote each other, no diagnostic.
- Grepped `port.ts`'s `chunkPoints()`: `for (let i = 0; i + 2 < flat.length; i
  += 3)` — confirmed a `ContourData` length not divisible by 3 drops the
  trailing 1–2 values silently, no error.
- Grepped `rasterize.ts` for `isFinite`: none — no finite-coordinate check on
  contour points, a real but smaller gap, left for a later round.
- Grepped `README.md` for the error classes added this session
  (`GridMismatchError`, `IndeterminateCentroidError`, `NonOrthogonalBasisError`,
  `MalformedContourError`, `UnclosedContourError`, `IndeterminateVolumeError`):
  none present — confirmed the Errors section had gone stale.

Recommended treating Phases 5–8 (DICOM semantic model, editable multi-ROI
API, `ContourImageSequence`/SOP-reference plane association) as genuinely
out of scope for a correctness release — new architecture, not a fix to
existing surface, consistent with the project's own 0.1→0.2→0.3 split. User
agreed and asked to fix three specific, contained items before staging: ROI
identity, `ContourData` length validation, and README sync.

### ROI identity (`src/index.ts`)

Changed `rois` from `Map<string, StoredRoi>` keyed by name to
`Map<number, StoredRoi>` keyed by `ROINumber` (already tracked per-ROI, just
never used as the key). Chose NOT to do the plan's full Phase 7.1 redesign
(`Map<number, ...>` with name as pure convenience everywhere) — instead:
`roi()`/`getMask()`/`getMaskSlice()`/`dicomVolume()` accept `string | number`.
A number resolves directly and unambiguously. A string filters all ROIs by
name — exactly one match resolves normally, zero throws the existing
`RangeError`, and **more than one throws a new `AmbiguousRoiNameError`**
rather than silently picking first-or-last. This was the key design
decision: silently choosing "first match" would just relocate the same
silent-data-loss bug one level down (now hiding which of the two "GTV"s you
got, instead of losing one outright). Forcing disambiguation is the only
option consistent with "don't hide ambiguity." Added `getROINumbers()`
(canonical, always one entry per ROI) and `findROIsByName()` (returns every
match, for legitimate callers who need to enumerate duplicates rather than
pick one). `getROINames()` intentionally left able to return duplicates now
— it used to silently deduplicate via the Map's keys; now it honestly
reflects what's in the file.

Deliberately did not touch: original-contour preservation, `addROI`/
`toDicom` editable API, richer per-ROI handle fields (`getContours()` etc.)
— all Phase 7.2–7.4, genuinely separate scope from the identity bug itself.

### ContourData validation (`src/dicom/port.ts`)

`chunkPoints()` now throws `MalformedContourError` (reused, not a new class
— broadened its doc comment slightly, since "not a multiple of 3" and "too
few points" are the same underlying invariant — a contour that cannot be a
well-formed point sequence — checked at two different points in the
pipeline) if `flat.length % 3 !== 0`, before chunking anything. Chose an
unconditional throw over a `strictness`-gated diagnostic: the plan's own
Phase 8.2 lists "Malformed ContourData" under conditions that should
*always* fail regardless of policy, and unlike the FrameOfReference case
(genuinely recoverable — you can choose to load anyway with a warning),
there's no reasonable partial interpretation of a corrupted coordinate
array. `strictness` stays scoped to the one condition it was actually built
for.

Testing this needed a small extra step: no fixture built through
`writeRTStruct` can ever produce a malformed length (every `Contour`'s
points always flatten to a clean multiple of 3 by construction), so the bug
can only be exercised by calling `chunkPoints` directly with a
hand-corrupted array. Exported it from `port.ts` for exactly that — safe to
do because `port.ts` itself is never re-exported through `index.ts` (checked
the `export *` list to confirm), so this doesn't touch the public API, same
reasoning already applied to keeping `linkLoops` unexported in the
vectorize.ts batch, just the opposite conclusion because the module
boundary is different here.

### README sync

Rewrote the Errors section from a flat five-item list (stale since the
first fix of the round) to cover all twelve current error classes, grouped
by where they fire (geometry construction, mask/phantom allocation,
contours, series/FoR, ROI identity, metrics) rather than one undifferentiated
list. Updated the core round-trip example to show `getROINumbers()` and
note `getROINames()` can contain duplicates, and added a short paragraph on
the string-or-number `roi()` lookup contract.

Ran the full suite after each of the three fixes individually, not just at
the end — all 112 pre-existing tests passed unchanged after both code
changes (confirms no existing fixture depended on the old silent-overwrite
or silent-truncation behavior). Added 8 new tests: 3 for `chunkPoints`
(`tests/unit/port.test.ts`, new file) and 5 for ROI identity (IO-15..19 in
`io.test.ts`). All passed first try — 120/120 total. Typecheck, build, and
all 5 examples clean. Ready to stage and commit.

## Phase A — monorepo migration (2026-08-27)

Roadmap v2 §5 Phase A. `rtstruct-js` is now `packages/rtstruct/` inside the
`dicom-imaging-toolkit-packages` npm-workspaces repo. Branch
`chore/monorepo-migration`.

- GitHub repo renamed `rtstruct-js` → `dicom-imaging-toolkit-packages`
  first (GitHub keeps redirects), local `origin` repointed. Rename and
  restructure are independent, so the rename went first as the cheap step.
- **`git mv`, not a clone and not a file copy** — the roadmap allowed
  `git subtree`/`git mv on a clone`, but a plain `git mv` on the existing
  repo preserves history just as well (`git log --follow
  packages/rtstruct/src/index.ts` walks back through `c791395` etc.). Every
  *tracked* file moved under `packages/rtstruct/`; `.claude/` and
  `.gitignore` stayed at the repo root.
- New private root `package.json`: `workspaces: ["packages/*"]`,
  pass-through `test`/`typecheck`/`build` (`npm run X --workspaces
  --if-present`). The per-package `package-lock.json` was `git rm`'d and
  `npm install` regenerated a single lockfile at the root.
- `.gitignore` left unchanged — its `node_modules/` / `dist/` / `scratch/`
  patterns are unanchored, so they still match under `packages/rtstruct/`.
- `packages/rtstruct/package.json`: name stays `rtstruct-js`, version stays
  `0.2.1` — **nothing published**. Only `repository.url` (plus a new
  `repository.directory: "packages/rtstruct"`), `homepage`, and `bugs`
  repointed at the monorepo.
- `README.md` had exactly one absolute GitHub link (to `VALIDATION.md`); it
  now 404'd on the old path, repointed at
  `.../dicom-imaging-toolkit-packages/blob/main/packages/rtstruct/VALIDATION.md`.
  All *relative* README links were fine — `src/` / `tests/` / `examples/` /
  `LICENSE` all moved together.
- `scratch/` (untracked real-DICOM working data) moved with plain `mv`
  alongside its validation scripts.
- `scripts/check-dependency-rule.mjs` **unchanged and still green** — it
  resolves `src/` relative to its own file location, so it works from
  `packages/rtstruct/` with no edit. Roadmap Phase B still rewrites it for
  real *package* boundaries; that boundary check is not yet meaningfully
  enforced.
- `.claude/IMPLEMENTATION_PLAN.md` deliberately left untouched (frozen v0.1
  spec per the roadmap's own front-matter; it contains no stale repo URLs
  or broken links anyway).

Verification: `check:deps` OK, `tsc --noEmit` clean, **120/120 tests
green**, all run from `packages/rtstruct/` via the workspace root.

Not done here — later roadmap phases: `rt-geometry-js` extraction (Phase
B), the dependency-rule rewrite (Phase B), CI (Phase D), a root
`README.md`, and `docs/`.
