# Roadmap (post-0.2.1) — v2: monorepo expansion

Forward-looking plan only. For what shipped, see `CHANGELOG.md` (public)
and `.claude/README.md` (internal postmortem/rationale). `.claude/
IMPLEMENTATION_PLAN.md` is the frozen v0.1 spec — don't edit it to reflect
later versions, this file is where later planning lives instead.

**This version supersedes the single-package planning that filled this
file through 0.2.1.** The project is no longer "grow `rtstruct-js`
in place" — it's a five-package monorepo, renamed to
**`dicom-imaging-toolkit-packages`**, built around a shared geometry core.
Everything below is the plan for that; §12 carries forward the
`rtstruct-js`-specific items from the old plan that this restructuring
doesn't itself resolve, so nothing already identified gets dropped.

Original version philosophy for the single package (still the frame the
*content* of `rtstruct-js` fits into, independent of the repo split):
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
during it. This code becomes part of `rtstruct-js`'s DICOM I/O layer after
the geometry extraction (Phase B/C below) and needs no rework to survive
the split.

---

## 1. Priority order

| # | Work | Why here |
|---|---|---|
| 1 | Repo migration to workspaces (`dicom-imaging-toolkit-packages`) | Prerequisite for everything |
| 2 | Extract `rt-geometry-js` | Unblocks every downstream package |
| 3 | `rtstruct-js` 0.3.0 (non-breaking) | Keeps shipped users whole |
| 4 | CI | Closes an outstanding v0.1 exit criterion |
| 5 | `rtdose-js` | Highest clinical value; forces `ScalarField3D` |
| 6 | `dicom-seg-js` | Inherits the scalar layer built in 5 |
| 7 | `rt-convert-js` | Needs 5 and 6 to exist |

**Sequencing rule:** the geometry extraction happens *before* any new
domain package is written. Building against `rtstruct-js` first and
splitting later means untangling two things at once and breaking a public
API that has already shipped.

**Why SEG is scheduled after dose despite being the larger audience:** it
depends on `ScalarField3D`, resampling, and histogram machinery, all of
which dose forces you to get right under harder pressure (dose grids
never match CT grids, so resampling is unavoidable and load-bearing).
Building SEG first means building the scalar layer without its toughest
use case validating it, then reworking it when dose arrives.

---

## 2. Target shape

```
dicom-imaging-toolkit-packages/     one repository, npm workspaces
├── package.json                    workspaces: ["packages/*"]
├── .github/workflows/ci.yml
├── scripts/
│   └── check-dependency-rule.mjs   rewritten for package boundaries
├── docs/
│   ├── VALIDATION.md               real-file evidence
│   ├── DVH-METHOD.md               resampling + interpolation decisions
│   └── FRACTIONAL-SEG.md           probability vs occupancy, calibration
└── packages/
    ├── geometry/                   -> rt-geometry-js
    ├── rtstruct/                   -> rtstruct-js
    ├── rtdose/                     -> rtdose-js
    ├── dicom-seg/                  -> dicom-seg-js
    └── convert/                    -> rt-convert-js
```

Dependency graph — no domain package depends on another:

```
              rt-geometry-js
         ┌─────────┬─────────┐
         ↓         ↓         ↓
   rtstruct-js  rtdose-js  dicom-seg-js
         └─────────┬─────────┘
                   ↓
             rt-convert-js
```

`rt-convert-js` is the only package allowed to depend on two domain
packages. This keeps SEG↔RTSTRUCT conversion available without forcing a
dose user to install a polygon rasterizer, or a SEG user to install RT
contour machinery.

---

## 3. The shared core: three data types

The central architectural change in v2. `Mask3D` is boolean; both RTDOSE
and fractional SEG are **scalar** — a number per voxel. That is one
abstraction, not two.

```
GridGeometry      the sampling grid              (exists)
Mask3D            boolean per voxel               (exists)
ScalarField3D     number per voxel                NEW
```

`ScalarField3D` is used by:

- `rtdose-js` — dose in Gy per voxel
- `dicom-seg-js` — FRACTIONAL probability or occupancy per voxel

### Histogram machinery generalizes

A dose-volume histogram is *"histogram a scalar field, restricted to a
mask."* Swap dose for probability and the identical code produces a
confidence histogram. So this lives in geometry, not in rtdose:

```ts
histogram(field: ScalarField3D, mask: Mask3D, opts): Histogram
volumeAboveThreshold(field, mask, threshold): number
valueAtVolumeFraction(field, mask, fraction): number
```

- `getD(95, mask)` in dose = `valueAtVolumeFraction(dose, mask, 0.95)`
- `getV(20, mask)` in dose = `volumeAboveThreshold(dose, mask, 20)`
- `volumeAboveThreshold(confidence, mask, 0.7)` in SEG = volume the model
  is at least 70% confident about

One algorithm, three packages. Build it once, in geometry.

### `rt-geometry-js` contents

```
GridGeometry, GridPlane, GridTolerance, Vec3
Mask3D, createEmptyMask, maskFromDense
ScalarField3D, createScalarField                      NEW
createGridGeometry, createUniformGrid
sortPlanes, plane ordering + dedupe
resampling (trilinear + nearest)                      NEW
histogram / volumeAboveThreshold / valueAtVolumeFraction  NEW
metrics: dice, voxelDisagreement, centroidDisplacementMm
phantoms: cube, sphere, torus, analyticVolumeMm3
errors: GridMismatchError, NonParallelPlanesError, ResourceLimitError
Diagnostic, Provenance, Severity, redact()
```

**Moved down from `rtstruct-js`:** phantoms and metrics (neither is
RTSTRUCT-specific; both needed by the other packages), and
`planeThicknessMm()` from `mask/mask3d.ts` — a purely geometric
calculation that geometry should own. Closes an existing roadmap item
(see §12).

---

## 4. Dependency declarations

Every domain package declares geometry as a **peer dependency**:

```json
{
  "peerDependencies": { "rt-geometry-js": "^0.1.0" },
  "devDependencies":  { "rt-geometry-js": "^0.1.0" }
}
```

With a regular `dependencies` entry, npm may install two copies at
different versions. Then a `Mask3D` produced by one package meets a
different `GridGeometry` implementation in another and they disagree
silently — the exact class of bug this architecture exists to prevent.

Each README states its compatibility range explicitly.

---

## 5. Phases

### Phase A — Repo migration — ✅ 2026-08-27 (branch `chore/monorepo-migration`)

1. Create `dicom-imaging-toolkit-packages` with npm workspaces.
2. Move the existing repo into `packages/rtstruct/` **preserving git
   history** (`git subtree` or `git mv` on a clone — not a file copy into
   a fresh repo).
3. Confirm existing tests pass unchanged.

Nothing published. Executed with `git mv` directly on the renamed repo (no
clone needed): every tracked file under `packages/rtstruct/`, `.claude/`
and `.gitignore` left at root, new private root `package.json`
(`workspaces: ["packages/*"]`), single regenerated root lockfile.
`rtstruct-js` package name and version 0.2.1 unchanged — only
`repository`/`homepage`/`bugs` URLs repointed. `check:deps`, `tsc --noEmit`,
and all 120 tests pass unchanged from the new path. Full record in
`.claude/README.md`.

### Phase B — Extract `rt-geometry-js` 0.1.0 — ✅ complete 2026-08-27 (`rt-geometry-js` 0.1.0 published to npm)

Extraction PR (branch `feat/extract-rt-geometry`, merged): `packages/geometry`
created as `rt-geometry-js` 0.1.0 (not yet published), the
geometry/mask/metrics/phantom/diagnostics code moved with `git mv` history
intact, `types.ts`/`errors.ts` split geometry-vs-rtstruct, `rtstruct-js` rewired
to the peer dep with the full geometry surface re-exported from its entry point
(so Phase C step 2 is already satisfied), tests split across the two packages
(120 unchanged + 13 new for `ScalarField3D`/histograms = 133, all green),
typecheck + build clean. Workspace-source resolution via a `paths` mapping + a
vitest alias; the published build clears the mapping so the emitted JS keeps the
bare `rt-geometry-js` specifier.

Tolerance PR (branch `feat/tolerance-from-real-data`) closes **step 4**:
`scripts/validation/tolerance-derivation.ts` measured within-series
`PixelSpacing`/`ImageOrientationPatient` spread, slice-origin off-axis deviation,
and coordinate DS-round-trip error across 7 de-identified series / 5+ acquisition
origins — **all exactly zero**. `DEFAULT_TOLERANCE` values kept (0.5 / 0.01 /
1e-3) as a deliberate margin for the one unmeasurable case (same geometry via two
independent pipelines); the `tolerance.ts` doc comment and `VALIDATION.md`
Finding 6 now record the evidence instead of admitting a guess.

Step 6: `rt-geometry-js` 0.1.0 published to npm (2026-08-27). **Phase B done.**
`rtstruct-js` still ships 0.2.1 (its peer-dep wiring lands with the 0.3.0
release in Phase C).

1. Move geometry, mask, metrics, phantom, diagnostics, provenance, shared
   errors into `packages/geometry/`.
2. Move `planeThicknessMm()` onto `GridGeometry` (§12 item). — done: method on
   `GridGeometry`, free function kept as a delegating wrapper.
3. **Rewrite `check-dependency-rule.mjs`.** It currently enforces
   "`geometry/` never imports `dicom/`" by file path. After extraction
   that boundary is a *package* boundary and the script silently stops
   checking anything real. New rules:
   - `packages/geometry` imports no other workspace package
   - no domain package imports another domain package
   - only `packages/convert` may import two domain packages
4. ✅ Re-derive `DEFAULT_TOLERANCE` from the real multi-vendor series.
   Done: `rtstruct-js/scripts/validation/tolerance-derivation.ts` measured
   IPP off-axis variance, orientation drift, `PixelSpacing` spread, and
   coordinate DS-round-trip error across 7 series / 5+ acquisition origins
   — all exactly zero. Values kept (evidence shows the floor is far below
   them and nothing real approaches them); doc comment in
   `rt-geometry-js/src/tolerance.ts` and `VALIDATION.md` Finding 6 now
   carry the evidence. **Closed v0.1 exit criterion**, same item as under
   §9's "still open."
5. `ScalarField3D` and the histogram functions may be stubbed here and
   filled in during Phase E, or built now — either is fine, but the
   *types* should exist before `rtstruct-js` 0.3.0 publishes so the
   geometry API doesn't churn immediately after release.
6. Publish.

### Phase C — `rtstruct-js` 0.3.0 — steps 1-5 ✅ 2026-08-27 (branch `feat/rtstruct-0.3.0`); step 6 (publish) open

Must break nobody. Done in this PR:

1. ✅ Peer dependency — added in Phase B (`peerDependencies` + `devDependencies`
   `rt-geometry-js: ^0.1.0`).
2. ✅ Re-export every geometry type — done in Phase B (`export * from
   "rt-geometry-js"` in `src/index.ts`).
3. ✅ Real-file round-trip re-run on 3 of 7 patients (Elekta MR, TCIA NSCLC CT,
   Varian CT — every ROI): Dice `1.000000`, voxel disagreement `0`, point-count
   ratios unchanged. `VALIDATION.md` "Re-run history" note + `CHANGELOG` record.
   (The 3 large-mask patients — LCTSC-S3, MIM — were left for a follow-up; the 3
   run span both modalities + 3 tools and reproduce every finding.)
4. ✅ Already done — `RTStructImpl` deprecated alias has existed since 0.2.0.
5. ✅ §12 gaps folded in:
   - **finite-coordinate check** — `rasterize()` throws `MalformedContourError`
     on a NaN/Infinity point coordinate (was: silent).
   - **vectorizer ordering/winding contract** — documented on `vectorize()` and
     locked by `VECTOR-ORDER-01..03` (plane-ascending → row-major discovery
     order; clockwise winding in screen space; hole boundaries wind the other
     way).
   - **exact round-trip test** — new `topology.test.ts`, `voxelDisagreement()
     === 0` for single voxel, rectangle, disconnected islands, island-in-a-hole,
     checkerboard, one-voxel-wide, border-flush (TOPO-01..07).
   - **holes-test tightening** — CTR-02/03 now `voxelDisagreement() === 0`, not
     `mask.count()`.
   - **topology fixture matrix** — the 7 TOPO cases above.
   - **CLI `validate`** — *deferred*. It's the one item marked "if there's room"
     and it still needs the geometry-less-vs-companion-series decision (§12).
     Own follow-up.
   Plus: `Diagnostic.code` widened to `string` (see §12 / CHANGELOG — type-level,
   non-breaking at runtime), version bump 0.2.1 → 0.3.0, `CHANGELOG.md` shipped
   in the tarball, README status/install updated for the peer dep.

6. Publish `rtstruct-js` 0.3.0 — **open, manual, user-run** (after CI merges).

Test count: 80 geometry + 64 rtstruct = 144, all green. Typecheck + build clean.

### Phase D — CI — ✅ 2026-08-27 (branch `feat/ci`)

`.github/workflows/ci.yml`: on every PR + pushes to `main`, Node 20 and 22
matrix — `npm ci`, `check:deps`, `npm run typecheck` (both packages,
`tsc --noEmit` strict + `noUncheckedIndexedAccess`), `npm test` (full
suite incl. the mask→RTSTRUCT→mask round-trip gate), `npm run build`
(exercises the published-build resolution where `tsconfig.build.json`
clears the `paths` alias). `concurrency` cancels superseded runs.

```
typecheck  (tsc --noEmit, strict + noUncheckedIndexedAccess)
dependency-rule check
full test suite including the round-trip gate
```

**Closed the second outstanding v0.1 exit criterion.**

### Phase E — `rtdose-js` 0.1.0 — PR 1 + PR 2 + PR 3 ✅ (2026-08-28); publish 0.1.0 (manual) open

Builds `ScalarField3D`, resampling, and histograms for real.

**§6 decisions made (2026-08-28):** resampling default = **sample dose at
structure voxel centres** (reverse direction exposed via `resampleMask`);
interpolation default = **trilinear** (nearest exposed); volume accounting =
**whole-voxel binary**, computation method recorded on every metric;
supersampling/fractional coverage deferred to a later minor.

**PR 1 ✅ — `rt-geometry-js` 0.1.1 (branch `feat/geometry-resampling`):** added
`sampleFieldAt` / `resampleField` / `resampleMask` in `resample.ts` (trilinear +
nearest; plane-axis interpolation by projected position so irregular spacing is
handled; `outOfBounds` fill; `FrameOfReferenceMismatchError` across FoRs). 10
tests. Released additively as 0.1.1 — `^0.1.0` covers it, so `rtstruct-js` needs
no change; `rtdose-js` will require `^0.1.1`. The DVH functions
(`histogram`/`volumeAboveThreshold`/`valueAtVolumeFraction`) already exist from
Phase B.

**PR 2 ✅ — `packages/rtdose/` `rtdose-js` 0.1.0 (branch `feat/rtdose-js`):**
`packages/rtdose/` scaffolded on the same pattern as `rtstruct/` (peer dep
`rt-geometry-js ^0.1.1`; `paths` alias for dev/test, `paths: {}` in
`tsconfig.build.json`; vitest `resolve.alias`; `dcmjs` the only runtime dep,
imported through `createRequire` in the single `src/dicom/port.ts`).

```
DoseGrid.fromDicom(bytes)   RTDOSE parse, DoseGridScaling applied, GridFrameOffsetVector
                            -> plane positions along the normal; frames sorted if needed;
                            NotRTDoseError / MalformedDoseGridError; soft issues -> diagnostics
dose.sample(point, {method}) interpolated dose at a physical point (0 outside the grid)
dose.statistics(mask)       min / max / volume-weighted mean
dose.calculateDVH(mask,{bins}) cumulative DVH (points non-increasing in volume)
dose.getD(percent, mask)    Dx%  = valueAtVolumeFraction(field, mask, percent/100)
dose.getV(doseGy, mask)     V(d) = volumeAboveThreshold(field, mask, doseGy), abs + fraction
readRTDose(bytes)           standalone parse (counterpart of readSeriesGeometry)
```

Every mask query calls a private `fieldOn(mask.geometry, method)` that returns
`this.field` when the grids already coincide, else a `resampleField` memoised
in a `WeakMap<GridGeometry, Map<InterpMethod, ScalarField3D>>` — one resample
per ROI, not per query — then the Phase B histogram functions. Every return
carries `method` = `{ resampling: "dose-sampled-at-structure-voxel-centres",
interpolation, volumePolicy: "whole-voxel-binary", resampledToMaskGrid }`.
`FrameOfReferenceMismatchError` propagates from `resampleField` on a FoR
mismatch. Clinical "not a TPS / not validated" disclaimer at the top of the
README; `docs/DVH-METHOD.md` records the three §6 choices and how each derived
quantity is computed. 24 tests (PARSE-01..11, DG-01..07, DVH-01..06). Typecheck
+ build clean; bare `rt-geometry-js` specifier preserved in `dist/`.
`check-dependency-rule.mjs` auto-discovered the package, no script change
needed. **Not yet published** (manual, user-run, after CI).

**PR 3 ✅ — validation** vs `dicompyler-core` (branch `feat/rtdose-validation`).
Harness built **and run** on real TCIA data: **194 / 195 metric comparisons
within tolerance** across 3 Pancreatic-CT-CBCT-SEG patients (Varian Eclipse
pancreas SBRT) × 5 ROIs. dicompyler-core 0.5.6 + pydicom 2.4.5 (needs a
`pydicom<3` venv — 0.5.6 imports `pydicom.dicomio.read_file`, gone in
pydicom 3). mean/D50/D95/D2/V(d) all sub-1%; the single outlier is `max`
dose on a small OAR (+2.7%, a boundary sampling-density effect — rtdose-js
samples the dose at the ~3× finer CT-grid voxels near the edge; not an
interpolation effect, `--method nearest` doesn't change it; `max` isn't a
DVH criterion). Full table + findings in `packages/rtdose/VALIDATION.md`.

`packages/rtdose/scripts/validation/`:
- `metrics-rtdose-js.ts` — folder (1 RTDOSE + 1 RTSTRUCT + its CT series) ->
  per-ROI `{ volumeCm3, meanGy/minGy/maxGy, dGy: D2/D50/D95, vCm3/vPct:
  V5Gy/V20Gy/V30Gy }` JSON. `--method trilinear|nearest`. Uses `rtstruct-js`
  (added as a **devDependency** — dev-only, not in `src/`, invisible to
  `check-dependency-rule.mjs` which scans `src/` imports only, never ships).
- `metrics-dicompyler.py` — same folder + same metric shape via
  `dvhcalc.get_dvh` defaults. `pip install dicompyler-core pydicom`.
- `compare.mjs` — joins by ROI name, prints a Markdown Δ / Δ% table, flags
  dose Δ > max(0.5 Gy, 2%) / vol Δ > max(1 cm³, 2%) / V% Δ > 2 pp. Report,
  not a gate.
- `README.md` — run sequence + the expected disagreement (the two tools
  resample in opposite directions: rtdose-js dose->structure grid
  trilinear, dicompyler-core structure->dose grid nearest-plane).

`packages/rtdose/VALIDATION.md` — method, the resampling-direction
difference table, the **populated** agreement table (3 patients × 5 ROIs,
mean/D95/D2/V20Gy), 4 findings, and a "not yet covered" list (one planning
system only; no `DoseSummationType BEAM`; no in-the-wild reversed/offset
`GridFrameOffsetVector`). Data in `scratch/data-dose/Pancreas-CT-CB_{003,
014,030}/` (gitignored).

**Still open:** more planning systems (Elekta / RayStation / Pinnacle dose
needs an NBIA-authenticated TCIA download).

**Scratch relocation (2026-08-28):** the 670 MB `scratch/` tree (dev debug
`.ts` + `data-real/` TCIA cases used for the rtstruct keyhole scan) moved
from `packages/rtstruct/scratch/` to the **repo root** `scratch/` so every
package shares it. Still gitignored (`.gitignore` `scratch/` matches at any
depth). `tolerance-derivation.ts`'s usage docstring updated to the new
`../../scratch/...` relative path. The existing `data-real/` cases are
CT/MR + RTSTRUCT only — **no RTDOSE**, so PR 3's agreement table needs a
fresh download of dose-bearing cases.

### Phase F — `dicom-seg-js` 0.1.0

Inherits everything from Phase E.

```
readSeg(bytes)              BINARY | FRACTIONAL | LABELMAP
seg.segments()              segment list with coded meanings
seg.mask(segmentNumber)     Mask3D          (BINARY, LABELMAP)
seg.field(segmentNumber)    ScalarField3D   (FRACTIONAL, rescaled to 0..1)
writeSeg({ ... })           BINARY or FRACTIONAL out
```

See §7 for the fractional-specific requirements.

### Phase G — `rt-convert-js`

```
segToRtstruct(seg, segmentNumber, opts)
rtstructToSeg(rt, roiName, opts)
```

The lossy directions must be documented and diagnosed: RTSTRUCT cannot
represent fractional data (a threshold must be chosen and recorded), and
SEG→RTSTRUCT is a vectorization, with all the quantization already
understood from the existing round-trip work.

---

## 6. Decisions required before rtdose-js

### 6.1 Resampling direction

Dose grids and CT grids are almost never identical — RTDOSE is typically
2–3mm with different extent and sometimes different orientation. So
**every DVH computation crosses grids**, and `GridGeometry.equals()`,
correctly strict for RTSTRUCT, would reject nearly every real
dose/structure pair.

Two options, different answers:

- Sample dose **at** structure voxel centres
- Resample the structure **onto** the dose grid

TPS vendors differ. Pick one as the default, expose the other, document
both in `docs/DVH-METHOD.md`.

### 6.2 Interpolation

Trilinear or nearest-neighbour. Trilinear is the usual default and the
one that makes `sample()` smooth under a moving cursor.

### 6.3 Partial volume at boundaries

Whether a voxel straddling a structure edge counts fully, not at all, or
fractionally. Moves D95 and V20 visibly on small structures.

### 6.4 The method travels with the number

As with `volume({ method })`, every dose metric returns its method
alongside its value.

---

## 7. Fractional SEG requirements

### 7.1 PROBABILITY and OCCUPANCY are not interchangeable

DICOM defines two fractional meanings. PROBABILITY is the probability
that the segmented property occupies the voxel. OCCUPANCY is the
proportion of the voxel volume the property occupies. A value of 0.5
means "50% confident this is tumour" under one and "half this voxel is
tumour" under the other.

Requirements:

- `writeSeg` **must not** accept fractional data without an explicit
  fractional type. No default.
- On read, expose the declared type on the returned field; never discard
  it.
- Rescale by `MaximumFractionalValue` (0062,000E) on read — a stored
  value of x means x / max. Expose the raw integers too, for callers who
  need them.
- Emit a diagnostic when values look inconsistent with the declared type
  (e.g. an OCCUPANCY field that is bimodal at 0 and max, which is a
  thresholded probability mislabelled).

### 7.2 Confidence is not accuracy

Per-voxel probability is the model's confidence at each location. It is
not the accuracy of the segmentation, and averaging it does not produce
one — accuracy needs ground truth unavailable at inference time.

Most model outputs are also **uncalibrated**: a softmax value of 0.9 does
not mean 90% of such voxels are correct, and networks are typically
overconfident.

So the library exposes honest quantities only:

```
meanConfidence(field, mask)
volumeAboveThreshold(field, mask, t)
thresholdSensitivity(field, mask)   how volume moves as t moves
```

and never a single "accuracy" or "% correct" number. `docs/
FRACTIONAL-SEG.md` states the calibration caveat plainly, so nobody
builds a misleading UI on top of an honest library.

### 7.3 Cursor sampling comes free

`field.sample(patientPoint)` is the same call as `dose.sample()` against
a different field. A confidence-under-cursor tooltip therefore costs
nothing beyond what Phase E already built.

The caveat from 7.2 applies to any UI built on it: displaying "87%
confidence" implies calibration. Relative presentation (heatmap, or
high/medium/low banding) is the honest default unless the model was
explicitly calibrated. This is a documentation obligation, not a library
feature.

### 7.4 Structural notes

- Overlapping segments are permitted; `SegmentsOverlap` should be read
  and surfaced rather than assumed.
- LABELMAP conveys the segment by the integer pixel value matching a
  Segment Number — this is multi-*segment*, a different axis from
  multi-*confidence*. Do not conflate the two in the API.
- SEG references a source series but is **not required to share its
  spatial sampling or extent**. So SEG↔CT is another grid crossing, and
  reuses Phase E's resampling.

---

## 8. Clinical boundary

Volume is a measurement. **D95 and V20 are clinical decision criteria.**
"V20 below 20% for lung" gates plan approval. If this library reports
19.8% where a planning system reports 20.4%, and someone acts on it, the
failure mode is categorically different from a slightly-off volume.

- The "not clinically validated, not a treatment planning system"
  disclaimer goes at the **top** of the `rtdose-js` README.
- Every dose metric carries its computation method.
- `docs/DVH-METHOD.md` states resampling, interpolation, and
  partial-volume choices plainly, so a TPS disagreement is explicable.

Entering the dose-metrics space is a deliberate decision, not a drift.
Research and QA tooling is a legitimate niche; it should be entered
knowingly.

---

## 9. Validation strategy

The keyhole scan is the most credible artifact this project has produced.
Repeat the pattern for each new package, and **build the comparison
harness before the implementation is finished** so work is checked
against a reference throughout rather than at the end.

- **Dose:** real RTDOSE + RTSTRUCT pairs from TCIA. Run D95, D50, V20,
  mean dose through `dicompyler-core` and through `rtdose-js`. Publish the
  agreement table including disagreements and their explanation.
- **SEG:** round-trip real FRACTIONAL and BINARY SEG files; compare
  against `pydicom-seg` / `highdicom` on the same inputs. Record which
  fractional types appear in the wild, the way the encoding distribution
  was recorded for RTSTRUCT holes.
- Carry existing RTSTRUCT evidence into the same document: four-vendor
  round-trip results, the encoding distribution (Elekta skull 92%
  keyhole, Plastimatch lungs 4–6%, three vendors 0%, XOR unobserved
  across 2,498 contours), and the honest gaps. This is the same
  evidence base referenced in §12's "real hospital-file validation"
  item and Phase B step 4's tolerance re-derivation — one dataset, three
  uses.

---

## 10. Web Worker considerations

Both scalar-heavy packages are worker candidates, so transferability is a
design-time concern.

- Check whether `getSliceBuffer` returns a view into a larger buffer. If
  so it is not cleanly transferable and needs a copy path or a documented
  caveat.
- Dose grids and fractional SEG volumes are large; prefer transferable
  `ArrayBuffer`s over structured cloning.
- No package owns worker orchestration — that belongs to the consuming
  application. The libraries need only be worker-*safe*.

---

## 11. Exit criteria

### `rt-geometry-js` 0.1.0
- [x] All migrated tests green (80 geometry + 53 rtstruct = 133)
- [x] Rewritten dependency-rule script enforcing package boundaries
- [x] `DEFAULT_TOLERANCE` checked against real multi-vendor data (noise
      floor measured at zero across 7 series; values kept, now evidenced)
- [x] `ScalarField3D` and histogram present (built, not stubbed)
- [x] No DICOM, network, or filesystem dependency
- [x] Published to npm — `rt-geometry-js` 0.1.0 (2026-08-27)

### `rtstruct-js` 0.3.0
- [x] Zero breaking changes; geometry types re-exported (runtime; `Diagnostic.code`
      widened to `string` is a type-only change, changelogged)
- [x] Peer dependency declared with a stated range (`rt-geometry-js` `^0.1.0`)
- [x] Real-file validation re-run, results unchanged (3 of 7 patients, every ROI)
- [ ] CI green on every push (Phase D — `feat/ci`, not yet merged)
- [ ] Published to npm — 0.3.0 (step 6, manual)

### `rtdose-js` 0.1.0
- [x] `DoseGrid` parse with `DoseGridScaling` applied (+ `GridFrameOffsetVector`,
      16/32-bit pixel data, `NotRTDoseError`/`MalformedDoseGridError`, soft diagnostics)
- [x] `sample()`, `statistics()`, `calculateDVH()`, `getD()`, `getV()` — 24 tests
- [x] Resampling, interpolation, partial-volume policy in `DVH-METHOD.md`;
      `method` on every return
- [x] Agreement table against `dicompyler-core` published (`VALIDATION.md`) — 194/195
      metric comparisons within tolerance, 3 Pancreatic-CT-CBCT-SEG patients × 5 ROIs,
      dicompyler-core 0.5.6 / pydicom 2.4.5
- [x] Clinical disclaimer at the top of the README
- [ ] CI green (Phase D workflow already covers the new package via `--workspaces`)
- [ ] Published to npm — 0.1.0 (manual, user-run)

### `dicom-seg-js` 0.1.0
- [ ] BINARY, FRACTIONAL, LABELMAP read
- [ ] BINARY and FRACTIONAL write
- [ ] Fractional type required on write, preserved on read
- [ ] `MaximumFractionalValue` rescaling, with raw access retained
- [ ] `SegmentsOverlap` surfaced
- [ ] Calibration caveat documented in `FRACTIONAL-SEG.md`
- [ ] No "accuracy" or "% correct" metric exposed anywhere in the API

### `rt-convert-js` 0.1.0
- [ ] Both directions, with lossiness documented and diagnosed
- [ ] Threshold recorded in provenance on any fractional→binary step

---

## 12. Carried forward from the pre-monorepo roadmap

Items identified before this restructuring that the monorepo plan (§1–11)
doesn't itself resolve. Still real, now re-homed to a phase or package
above where noted.

### Folded into Phase B/C above (listed here for traceability only)

- Tolerance re-derivation from real multi-vendor data → Phase B step 4.
- `planeThicknessMm()` onto `GridGeometry` → Phase B step 2.
- Real hospital-file validation write-up → §9.

### Not yet folded in — `rtstruct-js`-specific, land in Phase C

- No finite-coordinate check on contour points in `contour/rasterize.ts` —
  a NaN/Infinity coordinate from malformed DICOM propagates silently into
  the geometry math today. Grepped, confirmed absent.
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
- CLI `validate` command: `npx rtstruct-js validate myfile.dcm`, a thin
  wrapper around the diagnostics layer that already exists
  (`src/diagnostics/`, `RTStruct.load(...).diagnostics`), not new
  correctness logic. Opens a different audience than npm consumers:
  physicists/QA staff who have a folder of files they don't trust but
  won't write TypeScript to check them. Scope for a first version: read
  one or more `.dcm` paths, load each as an RTSTRUCT (need a `geometry`
  to rasterize onto — either accept a companion series directory to
  build one via `readSeriesGeometry`, or run in a geometry-less "parse +
  structural diagnostics only" mode; needs a decision before
  implementation), print diagnostics with severity, exit non-zero on any
  `"error"`-severity diagnostic. Needs: a `bin` entry in `package.json`
  (none exists today), a CLI argument parser (currently zero CLI
  dependencies in the project — pick something dependency-light).

### Still open, unaffected by the split — later, not yet scheduled to a version

- `volume({ method: "contour" })` — still throws `NotImplementedError`.
  Natural pairing with the vectorizer work already in Phase C's list
  above.
- `centroid()` / `boundingBox()` as general single-mask utilities (today
  only `centroidDisplacementMm(a, b)` exists, a two-mask comparison).
  Fits with the ROI/mask-operations work below once `rt-geometry-js`
  owns metrics.
- Distance transforms — no implementation, not yet scoped to any package
  or version.
- A Cornerstone (or similar viewer) adapter — no implementation, no
  scoping done yet; would need a concrete integration target before
  planning further. Would sit outside the five core packages, likely its
  own consuming-application concern per §10's worker-orchestration
  precedent (libraries stay adapter-agnostic).
- A WASM accelerator — no implementation, no evidence yet that JS
  performance is actually a bottleneck for any real workload; revisit
  only if that evidence shows up.
- A `ContourEngine` pluggable-interface abstraction — no implementation,
  no concrete second implementation motivating it yet.

### 0.4.0 and beyond — ROI/mask operations (post-split, lives in rt-geometry-js + rtstruct-js)

Includes `union`/`intersection`/mm-based `dilateMm`/`erodeMm` operations —
genuinely new features, not fixes, so correctly out of scope for Phase C.
Now that `Mask3D` and the metrics module live in `rt-geometry-js`, these
operations belong on the shared type there, with `rtstruct-js` consuming
them rather than owning them.

### Larger architecture, not yet scheduled anywhere

From the 13-phase-plan gap analysis (see `.claude/README.md`, "Twelfth
review" section, for the full verified breakdown) — real gaps, but
substantial new architecture rather than contained fixes:

- A DICOM semantic model (`ReferenceImage`/`ReferenceImageSet`) and
  `ContourImageSequence`/SOP-instance-reference plane association —
  today plane association is 100% geometric (nearest-plane + distance
  tolerance); no SOP reference is read at all. Relevant to `rtstruct-js`
  and, once it exists, `dicom-seg-js` (SEG references a source series
  the same way).
- Parse-time DICOM validation beyond the ContourData-length fix already
  shipped: `NumberOfContourPoints` cross-check, duplicate-ROI-number
  detection, orphan-reference detection.
- A diagnostic for a present-but-empty `RTROIInterpretedType` (DICOM Type
  2 — required to be present, value allowed to be empty). Today the
  library only flags the *sequence entirely missing* case
  (`MISSING_RT_ROI_OBSERVATIONS`, document-level); a per-ROI observation
  entry that exists but declares `RTROIInterpretedType: ""` reads through
  silently as `""` (correctly — not defaulted to `"ORGAN"`, since that
  would fabricate a clinical claim the file never made). Confirmed
  against a real file: TCIA's LCTSC collection, patient
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
