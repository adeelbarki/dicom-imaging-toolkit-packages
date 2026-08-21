# Roadmap (post-0.2.1)

Forward-looking plan only. For what shipped, see `CHANGELOG.md` (public)
and `.claude/README.md` (internal postmortem/rationale). `.claude/
IMPLEMENTATION_PLAN.md` is the frozen v0.1 spec — don't edit it to reflect
later versions, this file is where later planning lives instead.

Original version philosophy (still the frame everything below fits into):
0.1.0 Foundation → 0.2.0 Correctness + documentation → 0.3.0 Geometry +
topology robustness → 0.4.0 ROI/mask operations → ... → 1.0.0.

## Already satisfied — don't rebuild

`readSeriesGeometry(instances: ArrayBuffer[])` (`src/dicom/series-geometry.ts`,
shipped in 0.2.0) already does what a proposed `createGridFromSeries()` would:
raw DICOM CT/MR slice bytes in, `GridGeometry` out, instance order doesn't
matter, validates rows/columns/pixelSpacing/orientation agree across
instances (`InconsistentSeriesError` otherwise), flags reversed slice order.
Documented in `README.md` under "Build a grid from real CT/MR slice files."
If a future review raises this gap again, check this file and the actual
code before treating it as real — it was a genuine gap before 0.2.0, closed
during it.

## Still open from the v0.1 exit criteria

`.claude/IMPLEMENTATION_PLAN.md` §8 lists six exit criteria for v0.1. Four
were actually met (44 tests green, strict typecheck clean, dependency lint
enforced, README states the seven invariants). Two were not, and neither
had been carried into this file until this was checked directly against
the code:

- **Tolerance defaults re-derived from real multi-vendor data, not
  guessed.** `DEFAULT_TOLERANCE`'s own doc comment
  (`src/geometry/tolerance.ts`) still says so explicitly: "not yet
  re-derived from real multi-vendor DICOM... revisit once real
  interoperability testing across vendors is possible." This is the same
  blocker as "real hospital-file validation" below, not a separate one —
  whenever real multi-vendor exports are available, use them for both:
  publish the agreement numbers *and* check whether `positionMm: 0.5` /
  `spacingMm: 0.01` / `directionAngleRad: 1e-3` actually hold, tightening
  or loosening with evidence instead of the current reasoned guess.
- **Round-trip gate running in CI on every commit.** No CI config exists
  (checked — no `.yml`/`.yaml` anywhere in the repo). Explicitly deferred
  early in the 0.2.0 session ("not implementing CI for now, keep it in
  plan for later version") but never actually written down until now.
  Candidate for 0.3.0 alongside the CLI work below, or its own small task
  — typecheck + full test suite + dependency-rule check on every push,
  mirroring exactly what's already run manually before every commit this
  project has made so far.

## Still-deferred v0.1 scope, not yet scheduled

§1 of the v0.1 plan explicitly deferred a list of features past v0.1.
Boolean mask operations and mm-based margin expansion are already tracked
under "0.4.0 and beyond" below. The rest were never carried into this
file until now — checked each against the code, none exist:

- `volume({ method: "contour" })` — still throws `NotImplementedError`
  ("not implemented yet (Phase 4)"). Natural pairing with the vectorizer
  work already listed under 0.3.0's geometry/topology track.
- `centroid()` / `boundingBox()` as general single-mask utilities (today
  only `centroidDisplacementMm(a, b)` exists, a two-mask comparison, not
  a general single-mask utility — the README's Limitations section
  already says this plainly). Natural fit alongside 0.4.0's ROI/mask
  operations.
- Distance transforms — no implementation, not yet scoped to any version.
- A Cornerstone (or similar viewer) adapter — no implementation, no
  scoping done yet; would need a concrete integration target before
  planning further.
- Package split (pure-geometry core vs. DICOM I/O) — no work started,
  but `scripts/check-dependency-rule.mjs`'s enforced boundary (`geometry/`,
  `contour/`, `mask/`, `roi/`, `phantom/` never import from `dicom/`) is
  exactly what keeps this possible later without a rewrite.
- A WASM accelerator — no implementation, no evidence yet that JS
  performance is actually a bottleneck for any real workload; revisit
  only if that evidence shows up.
- A `ContourEngine` pluggable-interface abstraction — no implementation,
  no concrete second implementation motivating it yet.

## 0.3.0 — Geometry/topology robustness + a CLI

Two independent tracks; ship together or split, whichever lands first.

### Remaining geometry/topology gaps (carried over from the 0.2.0 gap analysis)

Identified but deliberately deferred past 0.2.0 as smaller/lower-urgency
than the ROI-identity and ContourData fixes that shipped in 0.2.1:

- No finite-coordinate check on contour points in `contour/rasterize.ts` —
  a NaN/Infinity coordinate from malformed DICOM propagates silently into
  the geometry math today. Grepped, confirmed absent.
- `planeThicknessMm()` lives in `mask/mask3d.ts`, not on `GridGeometry` —
  works today (exported, reused by `metrics.ts`), but geometry should own
  a purely geometric calculation rather than mask/metrics owning it.
- Vectorizer output ordering/winding is deterministic as a side effect of
  the implementation (fixed iteration order throughout `linkLoops`/
  `boundaryEdges`) but never asserted as an explicit contract or locked in
  with a test.
- No exact `voxelDisagreement(A, B) === 0` round-trip test for canonical
  shapes (single voxel, rectangle) where floating-point curvature isn't a
  factor — existing round-trip tests use Dice thresholds (`>= 0.99`)
  because the phantom shapes (sphere/torus) are genuinely curved. A test
  on a shape with an exact mask→contour→mask identity would be a stronger
  regression lock than a threshold.
- `tests/unit/holes.test.ts`'s CTR-01/02/03 (nested/XOR/keyhole produce
  the same mask) only compares `mask.count()`, not full voxel-for-voxel
  equality — worth tightening to `voxelDisagreement() === 0`.
- Binary topology fixture matrix (single voxel, rectangle, disconnected
  islands, island-inside-a-hole, checkerboard, thin one-pixel structures,
  image-border contact) — deliberately deferred in the phantom-review
  round; only diagonal-touching (VECTOR-001) has dedicated coverage today.

### CLI validate command

`npx rtstruct-js validate myfile.dcm` — a thin wrapper around the
diagnostics layer that already exists (`src/diagnostics/`,
`RTStruct.load(...).diagnostics`), not new correctness logic. Opens a
different audience than npm consumers: physicists/QA staff who have a
folder of files they don't trust but won't write TypeScript to check them.

Scope for a first version: read one or more `.dcm` paths, load each as an
RTSTRUCT (need a `geometry` to rasterize onto — either accept a
companion series directory to build one via `readSeriesGeometry`, or run
in a geometry-less "parse + structural diagnostics only" mode that skips
rasterization entirely; needs a decision before implementation, not
before planning), print diagnostics with severity, exit non-zero on any
`"error"`-severity diagnostic (today's `Severity` type and diagnostic
codes should be checked for whether an actual error tier exists yet, or
only info/warning — may need one added).

Needs: a `bin` entry in `package.json` (none exists today), a CLI
argument parser (currently zero CLI dependencies in the project — pick
something dependency-light), decide the geometry-input story above before
coding starts.

## Later — DICOM SEG support

The largest single feature under consideration. Not scheduled to a
specific version yet — deserves its own scoping pass before committing to
one, given its size relative to everything shipped so far.

Rationale as given: RTSTRUCT stores polygon outlines (radiotherapy-centric,
smaller audience); SEG stores voxel masks directly (what most medical AI
segmentation output actually is). Structurally simpler than what this
library already does for RTSTRUCT — no polygon/vectorize geometry
involved, closer to a direct `Mask3D` ↔ DICOM SEG serialization. The
`Mask3D` interface, `GridGeometry`, and the phantom/metrics modules are
already segmentation-format-agnostic (no RTSTRUCT-specific assumptions
baked into `mask/`, `geometry/`, `metrics.ts`, `phantom/` — confirmed by
`scripts/check-dependency-rule.mjs`'s enforced boundary that those modules
never import from `dicom/`), so a `dicom/seg.ts` alongside the existing
`dicom/port.ts` should be able to reuse the whole non-DICOM core as-is.

Would also make this library the RTSTRUCT↔SEG conversion path (AI
produces SEG, treatment planning systems consume RTSTRUCT) — nobody does
this well in JS today, per the review that raised this.

Needs its own implementation plan (SOP Class, Segment Sequence structure,
per-segment vs. combined-frame encoding, overlapping-segment handling)
before scoping into a version number — do that as a separate planning
pass when this is picked up, not folded into 0.3.0 planning.

## Later — real hospital-file validation + published results

Not a code deliverable — an evidence deliverable. Current correctness
validation is entirely analytic phantoms (cube/sphere/torus with
closed-form volumes) plus synthetic contour fixtures; deliberately no
vendor DICOM in the repo (no PHI, no licensing question, and per the
project's own stated reasoning, vendor files carry no ground truth
anyway — phantoms do). That proves the math is right; it proves nothing
about survival through a real Eclipse/RayStation/MIM round trip.

Blocked on the maintainer sourcing real (de-identified, licensable)
RTSTRUCT exports from multiple planning systems — not something to
attempt autonomously in this session. When available: run them through
`RTStruct.load`/`createFromMask`, publish agreement numbers and the
specific failure modes found, most likely as a document alongside the
README rather than as new library code. Can proceed in parallel with any
other version's work whenever real fixture data actually exists.

## 0.4.0 and beyond — ROI/mask operations

Per the original roadmap split (not restated in detail here). Includes
the `union`/`intersection`/mm-based `dilateMm`/`erodeMm` operations raised
in the earlier 13-phase-plan gap analysis — genuinely new features, not
fixes, so correctly out of scope for anything version-numbered as a
correctness pass.

## Larger architecture, not yet scheduled anywhere

From the 13-phase-plan gap analysis (see `.claude/README.md`, "Twelfth
review" section, for the full verified breakdown) — real gaps, but
substantial new architecture rather than contained fixes, so deliberately
not folded into 0.3.0:

- A DICOM semantic model (`ReferenceImage`/`ReferenceImageSet`) and
  `ContourImageSequence`/SOP-instance-reference plane association —
  today plane association is 100% geometric (nearest-plane + distance
  tolerance); no SOP reference is read at all.
- Parse-time DICOM validation beyond the ContourData-length fix already
  shipped: `NumberOfContourPoints` cross-check, duplicate-ROI-number
  detection, orphan-reference detection.
- Editable multi-ROI public API (`RTStruct.create()` / `rt.addROI()` /
  `rt.toDicom()`), original-contour preservation on an unmodified ROI
  (today `load()` immediately rasterizes to mask and doesn't retain the
  source contours).
- Provenance/strictness as a genuinely centralized policy surface —
  today `strictness` is real but narrow (wired to exactly the
  FrameOfReference-mismatch check), and `Provenance` doesn't yet carry
  `sliceAssociation` (sop-reference vs. geometric-fallback) since
  SOP-reference association doesn't exist yet.

Worth revisiting once the DICOM semantic model above is scoped, since
several of these depend on it existing first.
