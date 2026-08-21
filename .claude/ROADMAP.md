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

Not a code deliverable — an evidence deliverable. No longer purely
blocked/unattempted — real progress made via `scratch/` exploration
tooling (git-ignored, TCIA REST API, no vendor files ever entered the
tracked repo). Still not yet turned into the actual publishable document
this item calls for; that write-up is the remaining work.

**Done so far** (`scratch/inspect.ts`, `scratch/real-contour-analysis.ts`,
all data via `curl` against `services.cancerimagingarchive.net/nbia-api`,
no NBIA Data Retriever needed):

- 2 vendors/tools confirmed: Plastimatch (open-source; LCTSC collection,
  3 patients) and Varian/Eclipse-family (commercial; `Manufacturer:
  "Varian Medical Systems"`, `NSCLC-Radiomics-Interobserver1` collection,
  1 patient). 43 real ROIs total, all loaded and rasterized with zero
  errors.
- Real-contour round trip (load real RTSTRUCT → mask1 → `createFromMask`
  → reload → mask2 → compare) — the previously-missing half of the gate,
  since prior validation only round-tripped library-generated phantoms.
  **43/43 exact: Dice 1.000000, 0 voxel disagreement**, including real
  multi-hole anatomy (lung planes with up to 7 simultaneous nested
  contours at once).
- Point-count inflation measured directly (original `ContourData` points
  vs. what `vectorize()` emits for the same mask) instead of guessed:
  Plastimatch ranges 0.31x–3.56x depending on structure shape (thin/
  tubular structures like SpinalCord/Esophagus actually got *fewer*
  points from the vectorizer, not more); Varian is a tight bimodal
  1.00x/2.00x split, mechanism not yet investigated.
- Real volumes are clinically plausible across all patients (lungs
  1.8–3.0 L, hearts 550–750 cm³, cord ~60 cm³) — an independent sanity
  check nobody had explicitly run before.
- Confirmed one real interoperability finding is NOT a one-off: variable
  `RTROIInterpretedType` population (empty vs. `"ORGAN"`) recurs across
  different patients within the same Plastimatch-authored collection, not
  just the one file that first surfaced it.
- Two more vendors added: MIM Software Inc. (`Soft-tissue-Sarcoma`,
  patient `STS_010` — 6 RTSTRUCT files on one CT, exercised
  `FRAME_OF_REFERENCE_MISMATCH` and `CONTOUR_PLANE_DISTANCE` for real,
  since some of the 6 were authored on a different series' frame) and
  Elekta (`Vestibular-Schwannoma-SEG`, patient `VS-SEG-199` — first
  MR-based grid tested, not CT; a `*Skull` ROI with 31 simultaneous
  nested/keyhole contours on one plane). 5 vendors/tools total now:
  Plastimatch, Varian, MIM, Elekta, plus the OHIF-tagged majority of
  TCIA's RTSTRUCT corpus not yet sampled.
- **Real keyhole contours found — confirmed, not just theorized.**
  Wrote `scratch/scan-encodings.ts`: exact (not approximate) revisit of a
  coordinate within the same `CLOSED_PLANAR` contour, non-adjacently.
  Verified by hand on one example (LCTSC `Lung_R`, plane at z=-400.2):
  points 23↔43 and 24↔42 are bit-identical, and points 25–41 trace a
  complete separate inner loop between them — outer boundary → channel in
  → full inner loop → channel back out → outer boundary continues.
  Textbook keyhole shape, same structure as the synthetic `keyhole()`
  helper in `tests/unit/holes.test.ts`. Real distribution: **Elekta's
  `*Skull` is 92% keyhole-encoded (213/232 contours)** — anatomically
  sensible, a skull cross-section has many internal cavities a
  boundary-tracer represents as channels rather than separate nested
  loops; LCTSC/Plastimatch lungs show it at 4–6%; `NSCLC-LUNG1-001`,
  `Varian-interobs11`, and `MIM-STS_010` show zero (they use plain nested
  contours instead). This retroactively explains why LCTSC/Elekta lung
  and skull ROIs never triggered `NESTED_CLOSED_PLANAR_INTERPRETED`
  earlier — a keyhole is a single self-touching polygon, nothing to
  detect nesting *between* — and confirms the rasterizer's even-odd fill
  (the same logic `CTR-03` tests synthetically) has been silently getting
  these right the entire time on real clinical files.
- `CLOSEDPLANAR_XOR` remains completely unconfirmed: 0 occurrences across
  2,498 real contours scanned (13 RTSTRUCT files, 5 vendors/tools). May
  simply be rare/legacy in practice, or none of the collections sampled
  so far happen to use it — can't distinguish those two from this data
  alone.

**Still open:**

- Real `CLOSEDPLANAR_XOR` evidence — still zero, see above. Would need
  either a much larger/more diverse sample, or a way to search TCIA by
  contour encoding style directly (no such metadata field exists).
- The Heart point-count anomaly (0.42x in one Plastimatch patient vs.
  3.27x/3.56x in two others, same structure, same tool family) — likely
  ordinary per-patient contour-density variation in the source files, but
  not actually confirmed.
- The Varian point-count 1.00x/2.00x bimodal split — mechanism not
  investigated.
- The actual write-up: turn the above into the publishable
  agreement-numbers document this item was meant to produce. Everything
  needed to start it already exists in `scratch/` output — this is now
  almost entirely a writing task, not a data-gathering one.
- Tolerance re-derivation (linked item, above) — still not attempted;
  would use this same real multi-vendor data once enough of it exists.

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
- A diagnostic for a present-but-empty `RTROIInterpretedType` (DICOM Type
  2 — required to be present, value allowed to be empty). Today the
  library only flags the *sequence entirely missing* case
  (`MISSING_RT_ROI_OBSERVATIONS`, document-level); a per-ROI observation
  entry that exists but declares `RTROIInterpretedType: ""` reads through
  silently as `""` (correctly — not defaulted to `"ORGAN"`, since that
  would fabricate a clinical claim the file never made — see the
  `??`-only-substitutes-on-null/undefined behavior in `src/dicom/port.ts`).
  Confirmed against a real file: TCIA's LCTSC collection, patient
  `LCTSC-Test-S1-101` (Plastimatch-generated RTSTRUCT) has exactly this —
  5 ROIs, all with `RTROIInterpretedType` present and explicitly empty,
  verified via the raw DICOM tag (`300600A4`, VR `CS`, `Value: [""]`),
  not a parsing bug. The pass-through behavior is correct; the gap is
  that nothing surfaces it as worth noticing the way the missing-sequence
  case already does.
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
