# Validation against real DICOM files

`rtstruct-js`'s correctness suite (`tests/unit/`) uses analytic phantoms — cube, sphere,
torus — with closed-form volumes, plus synthetic contour fixtures. That proves the
geometry math is right. It proves nothing about survival through a real planning
system's RTSTRUCT export, because real files carry noise, vendor-specific conventions,
and encoding choices no phantom can generate.

This document reports what happened when real, de-identified RTSTRUCT files from
[The Cancer Imaging Archive (TCIA)](https://www.cancerimagingarchive.net/) were run
through the library. No DICOM files are included in this repository or redistributed
anywhere — every number below is a derived, aggregate finding computed from files
downloaded directly from TCIA's public API at analysis time. No PHI is involved; TCIA
collections are pre-de-identified before publication.

**Reproduce this**: the scripts that produced every number below live in
[`scripts/validation/`](scripts/validation/) and are runnable against any local folder
of `.dcm` files — see that directory's own comments for usage. They are not part of the
published npm package (only `dist/` ships).

## Data sources

| Collection | Patients used | Vendor/tool (per file's own `Manufacturer` tag) | License | Citation |
|---|---|---|---|---|
| LCTSC | 3 (`LCTSC-Test-S1-101`, `LCTSC-Train-S1-006`, `LCTSC-Train-S3-001`) | Plastimatch (open-source) | CC BY 3.0 | https://doi.org/10.7937/K9/TCIA.2017.3r3fvz08 |
| NSCLC-Radiomics | 1 (`LUNG1-001`) | not confirmed via metadata | CC BY-NC 3.0 | https://doi.org/10.7937/K9/TCIA.2015.PF0M9REI |
| NSCLC-Radiomics-Interobserver1 | 1 (`interobs11`) | Varian Medical Systems | CC BY-NC 3.0 | https://doi.org/10.7937/tcia.2019.cwvlpd26 |
| Soft-tissue-Sarcoma | 1 (`STS_010`, 6 RTSTRUCT files) | MIM Software Inc. | CC BY 3.0 | https://doi.org/10.7937/K9/TCIA.2015.7GO2GSKS |
| Vestibular-Schwannoma-SEG | 1 (`VS-SEG-199`, 2 RTSTRUCT files, MR-based grid) | Elekta | CC BY 4.0 | https://doi.org/10.7937/TCIA.9YTJ-5Q73 |

7 patients, 13 RTSTRUCT files, 5 distinct authoring tools/vendors, 2,498 individual
contours analyzed. Two collections are CC BY-NC (NonCommercial) — only aggregate,
derived statistics from those collections appear below, consistent with standard
research citation practice; no data from them is redistributed.

## Finding 1: real-contour round trip is exact

Method: load a real RTSTRUCT onto its series' real geometry → take the resulting mask
→ write it back out via `RTStruct.createFromMask` → reload → compare against the first
mask, using `dice()` and `voxelDisagreement()`.

Run across every ROI in the LCTSC (3 patients, 19 ROIs) and
NSCLC-Radiomics-Interobserver1 (1 patient, 24 ROIs) files — **43/43 exact: Dice
1.000000, 0 voxel disagreement**, including lung anatomy with up to 7 simultaneous
nested contours on one plane.

This is expected, not surprising, once you know why: `vectorize()` traces boundaries at
exact half-integer offsets, and `rasterize()`'s sample points never touch that lattice,
so `mask → contours → mask` through this library's own writer and reader is exact by
construction for any mask — the two functions are inverses of each other by design, not
by coincidence. What this result actually confirms is that the guarantee holds at real
scale and real topological complexity (million-voxel structures, real multi-hole
anatomy), which had never been exercised before — prior round-trip coverage was
phantom shapes only (sphere, torus — one hole, not seven).

## Finding 2: real-world hole-encoding distribution

Neither `CLOSEDPLANAR_XOR` nor keyhole/self-touching `CLOSED_PLANAR` encoding is
discoverable via TCIA's series metadata, so this required reading each file's raw
`ContourGeometricType` tag and contour point geometry directly
(`scripts/validation/scan-encodings.ts`).

**Keyhole detection method**: a keyhole contour walks a channel out to an inner
boundary and back along the same path, so it revisits an earlier coordinate in the same
contour, non-adjacently. The scanner flags an *exact* (bit-identical, not merely close)
coordinate revisit. Verified by hand on one example (LCTSC `Lung_R`, a plane at
z = -400.2mm): points 23 and 43 are bit-identical, points 24 and 42 are bit-identical,
and points 25–41 trace a complete separate inner loop between them — outer boundary →
channel in → full inner loop → channel back out → outer boundary continues. This is the
same shape as the synthetic `keyhole()` helper in `tests/unit/holes.test.ts`.

Per-ROI results (`CLOSED_PLANAR` contours with an exact self-revisit / total
`CLOSED_PLANAR` contours for that ROI):

| Patient | ROI | Keyhole contours |
|---|---|---|
| Elekta `VS-SEG-199`, file 1 | `*Skull` | **80 / 80 (100%)** |
| Elekta `VS-SEG-199`, file 2 | `*Skull` | **115 / 115 (100%)** |
| Elekta `VS-SEG-199`, file 1 | `AN` | 12 / 12 (100%) |
| Elekta `VS-SEG-199`, file 2 | `AN` | 0 / 13 (0%) |
| Elekta `VS-SEG-199`, file 1 | `cochlea` | 0 / 6 (0%) |
| Elekta `VS-SEG-199`, file 2 | `cochlea` | 6 / 6 (100%) |
| LCTSC `Test-S1-101` | `Lung_R` / `Lung_L` | 9/93 (9.7%) / 15/82 (18.3%) |
| LCTSC `Train-S1-006` | `Lung_R` / `Lung_L` | 13/76 (17.1%) / 16/82 (19.5%) |
| LCTSC `Train-S3-001` | `Lung_R` / `Lung_L` | 4/125 (3.2%) / 10/135 (7.4%) |
| LCTSC, all 3 patients | `SpinalCord`, `Heart`, `Esophagus` | **0%**, every patient |
| NSCLC-Radiomics `LUNG1-001` | all 4 ROIs | 0% (uses plain nested contours instead) |
| NSCLC-Radiomics-Interobserver1 `interobs11` | all 24 ROIs | 0% |
| Soft-tissue-Sarcoma `STS_010` | all ROIs, all 6 files | 0% |

`CLOSEDPLANAR_XOR`: **0 occurrences across all 2,498 contours scanned.**

Reading this together: keyhole encoding is real and, for at least one real structure
(Elekta's `*Skull`, both files), the *dominant* encoding — anatomically sensible, since
a skull cross-section has many internal cavities a boundary-tracer represents as
channels rather than separate nested loops. It is structure-dependent even within one
patient/tool (Elekta's `AN` and `cochlea` used it inconsistently between the file's two
RTSTRUCT exports) and concentrated in the LCTSC lungs specifically — every other LCTSC
structure (cord, heart, esophagus) used zero keyhole contours, every patient. Two other
tools (Varian, MIM) never used it at all in this sample, using plain nested `CLOSED_PLANAR`
instead. `CLOSEDPLANAR_XOR` — implemented and phantom-tested in this library — was not
observed in any of the 2,498 real contours from 5 vendors/tools. That is a real result,
not an absence of searching; it may mean the encoding is rare/legacy in practice, or
simply that none of the collections sampled so far happen to use it. This sample cannot
distinguish those two explanations.

This also retroactively explains something that would otherwise have read as a gap: the
LCTSC/Elekta ROIs above never triggered the `NESTED_CLOSED_PLANAR_INTERPRETED`
diagnostic, because a keyhole is a single self-touching polygon — there is nothing to
detect nesting *between*. The rasterizer's even-odd fill (the same logic
`tests/unit/holes.test.ts`'s `CTR-03` covers synthetically) has been correctly
interpreting real clinical keyhole contours the entire time; this is simply the first
time it was checked against real files rather than only the synthetic fixture.

## Finding 3: point-count ratio (read this one carefully)

Method: original `ContourData` point count (as authored) vs. what `vectorize()` emits
for the resulting mask, same 43 ROIs as Finding 1.

**What this ratio actually measures**: the *original* contour is pre-quantization
geometry — smooth, sub-voxel vertices, however the authoring tool produced them. This
library's *output* is necessarily post-quantization — a staircase traced around a
rasterized mask, since rasterization is lossy by design (this library's own round-trip
gate is `mask → RTSTRUCT → mask`, never the reverse, for exactly this reason). So the
ratio compares post-quantization density to pre-quantization density — it says
something about the *original* contour's point density relative to voxel size, not
about this library's vectorizer being more or less "efficient."

| Structure type | Ratio (vectorize() points / original points) |
|---|---|
| SpinalCord, Esophagus (thin/tubular) | 0.31x – 0.43x |
| Heart | 0.42x, 3.27x, 3.56x (inconsistent — see below) |
| Lungs (LCTSC/Plastimatch) | 1.12x – 3.20x |
| Lungs, GTV structures (Varian) | ~2.0x, or exactly 1.00x for roughly half the ROIs |

A sub-1.0 ratio is not fidelity loss on this library's part — the loss already happened
at rasterization (the direction this library has always documented as lossy). A thin
structure's smooth pre-quantization contour can carry far more points than its
voxel-boundary perimeter needs.

Two open anomalies, not yet resolved, with a hypothesis each:

- **Exactly 1.00x on roughly half the Varian ROIs.** An exact-integer ratio in a
  measurement like this usually means something structural, not coincidence.
  Hypothesis: those specific ROIs were themselves already mask-derived by the
  originating tool, so their `ContourData` is *already* a voxel-boundary staircase —
  and if so, this library's vectorizer reproducing another tool's boundary trace
  point-for-point would be a real, independent correctness signal, stronger than the
  Dice-1.0 result in Finding 1 (which is self-referential; this would not be). The
  ~2.00x cases might then be the same staircase under a different collinear-run policy
  (one tool emits a vertex at every voxel-edge crossing, this library's vectorizer
  currently does not merge collinear runs into single segments — unverified whether
  that specific policy difference is the cause). Not yet checked: whether the 1.00x
  ROIs correlate with the `-auto-`-named ROIs in this file (as opposed to the `-vis-`
  ones) — the naming suggests they might.
- **The Heart split** (0.42x in one Plastimatch patient vs. 3.27x/3.56x in two others,
  same tool family). Plausible explanation: a sparse, hand-adjusted contour in one case
  vs. a dense, automatically-generated one in the others — same tool, different
  authoring path. Not confirmed.

## Finding 4: diagnostics fired correctly on real, unmodified files

- `SLICE_ORDER_REVERSED` — a real CT series (not from TCIA; a locally-available
  clinical series) was stored in descending physical order; `readSeriesGeometry()`
  detected and corrected it.
- `FRAME_OF_REFERENCE_MISMATCH` — 2 of the 6 Soft-tissue-Sarcoma RTSTRUCT files were
  authored against a different series' frame of reference than the CT geometry
  supplied; the library flagged it under default (`"warn"`) strictness and still loaded,
  rather than silently misattaching the ROI or throwing.
- `CONTOUR_PLANE_DISTANCE` — the same two files contained real contour points tens of
  millimeters from their nearest plane (up to ~94mm in one case); the geometric-fallback
  path (bounded, diagnosed) handled it rather than silently snapping to the wrong slice.
- `NESTED_CLOSED_PLANAR_INTERPRETED` — fired correctly and only where genuine multi-contour
  nesting existed (e.g. `NSCLC-LUNG1-001`'s lungs, up to 7 contours on one plane at
  once), never on structures without real nesting in the same file (`GTV-1`,
  `Spinal-Cord` in the same file correctly stayed unflagged).

No false positives or false negatives observed among these in the files examined.

## Finding 5: volumes are clinically plausible

Across all real patients: lungs in the 1.8–3.0 L range, hearts 550–750 cm³, spinal cord
~40–70 cm³ — all within ranges a planning system would report. An independent sanity
check against domain knowledge, not just internal consistency.

## Finding 6: DEFAULT_TOLERANCE re-derived — real within-series / round-trip noise is zero

`rt-geometry-js`'s `DEFAULT_TOLERANCE` (`positionMm` 0.5, `spacingMm` 0.01,
`directionAngleRad` 1e-3) governs two comparisons: `GridGeometry.equals()` and
`readSeriesGeometry`'s instance-consistency check. `scripts/validation/tolerance-derivation.ts`
measured the noise those tolerances have to absorb across 7 de-identified series
(6 from the table above, plus the LCTSC extract), spanning 5+ acquisition origins —
Elekta MR at 1.5mm, Plastimatch/LCTSC CT at 2–3mm, MIM CT at 3.27mm, Varian CT at 5mm,
TCIA NSCLC CT at 3mm.

| Axis measured | Worst case across all 7 series |
|---|---|
| Per-slice `PixelSpacing` spread within a series | **0** (bit-identical every slice) |
| Per-slice `ImageOrientationPatient` angular spread | **0** (bit-identical every slice) |
| Slice-origin deviation off the series normal | **0 mm** (every stack perfectly axial) |
| Coordinate read → `number` → DS re-encode → re-parse | **0 mm** (vendor DS precision ≤ 6 fractional digits, lossless through a JS `number`) |
| Slice spacing regularity within a series | exact (min = mean = max), 1.5–5.0 mm |

So the real noise floor for all three fields is **zero** in this dataset, and nothing
in real multi-vendor data approaches the current values. They are **kept as-is** — a
deliberate margin for the one case this dataset can't probe: the *same* physical
geometry reconstructed by two independent pipelines (an RTSTRUCT's referenced-FoR grid
vs. the CT it was drawn on). The `tolerance.ts` doc comment now records this rather than
admitting a guess. `positionMm` is the loosest and the first candidate to tighten if a
paired two-pipeline dataset ever becomes available.

## Known limitation surfaced during this validation

The rasterizer's hole-fill (`fillPlane()` in `src/contour/rasterize.ts`) merges every
`CLOSED_PLANAR` contour on a plane into one edge list and applies a single even-odd
parity fill across all of them at once. This is correct for arbitrary nesting depth and
for disjoint contours — verified above at real scale. It is **not** correct for two
contours that partially overlap without either containing the other (neither nested nor
disjoint) — even-odd fill would carve out the symmetric-difference region, which is
almost certainly not the intended ROI. This is a real, if uncommon, possibility in
edited/hand-corrected real-world contour sets. Not observed in the files examined here.
Not yet fixed; not yet diagnosed. Logged in `.claude/ROADMAP.md`.

## What this does not prove

- No collection here confirmed as a mainstream commercial TPS beyond Varian and Elekta
  specifically (e.g. RayStation, Pinnacle) — sample is 5 tools, not exhaustive.
- `CLOSEDPLANAR_XOR` handling remains phantom-tested only; genuinely unconfirmed in the
  wild in this sample.
- `DEFAULT_TOLERANCE` has now been checked against measured multi-vendor
  position/spacing/orientation noise (Finding 6) — the floor came out at zero, so the
  values are unchanged but no longer a pure guess. The residual unknown is cross-pipeline
  (not cross-vendor) reconstruction of the same geometry, which this dataset can't
  isolate.
- This is 7 patients. Interoperability claims here are directional evidence, not a
  statistically powered study.
