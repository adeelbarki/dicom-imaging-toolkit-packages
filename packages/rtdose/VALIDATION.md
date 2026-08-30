# Validation against real DICOM files

`rtdose-js`'s correctness suite (`tests/unit/`) uses synthetic dose grids with closed-form
answers — a uniform field, a linear ramp. That proves the parsing, the resampling wiring,
and the DVH arithmetic are right. It proves nothing about agreement with an established DVH
implementation on a real plan, where the dose grid, the structure set, and the CT all come
from a planning system and carry its conventions.

This document is that comparison: `rtdose-js` vs
[`dicompyler-core`](https://github.com/dicompyler/dicompyler-core) — D2/D50/D95,
V5Gy/V20Gy/V30Gy, and mean/min/max dose, per ROI, on real RTDOSE + RTSTRUCT + planning-CT
triples from [TCIA](https://www.cancerimagingarchive.net/). Same pattern as `rtstruct-js`'s
keyhole scan: the comparison harness was built before the results existed, so the
implementation was checked against a reference rather than trusted.

No DICOM files are included in this repository or redistributed. Every number here is a
derived figure computed from files downloaded from TCIA's public API at analysis time; TCIA
collections are pre-de-identified before publication.

**Reproduce this**: [`scripts/validation/`](scripts/validation/) — `metrics-rtdose-js.ts`,
`metrics-dicompyler.py`, `compare.mjs`. See that directory's README for the run sequence
(including the `pydicom<3` virtualenv `dicompyler-core` 0.5.6 needs). Not part of the
published npm package (`dist/` only).

## Status

| | |
|---|---|
| Harness | ✅ built and smoke-tested (Phase E PR 3, 2026-08-28) |
| `rtdose-js` side | ✅ verified on synthetic + 3 real TCIA cases |
| `dicompyler-core` cross-check | ✅ **run** — dicompyler-core 0.5.6, pydicom 2.4.5 |
| Result | **194 / 195 metric comparisons within tolerance** across 3 patients × 5 ROIs; the one outlier is a single-voxel *max dose* on a small OAR, explained below |

## Method

For each ROI in the RTSTRUCT:

1. `rtdose-js` — `RTStruct.load` rasterizes the ROI onto the CT series' `GridGeometry`
   (`readSeriesGeometry`), then `DoseGrid` resamples the dose field onto that grid
   (trilinear) and runs `rt-geometry-js`'s histogram engine. `getD(p)` =
   `valueAtVolumeFraction(field, mask, p/100)`; `getV(d)` =
   `volumeAboveThreshold(field, mask, d)`; mean is volume-weighted.
2. `dicompyler-core` — `dvhcalc.get_dvh(rtss, rtdose, roi_number)` with defaults, then
   `.statistic("D95")` / `.statistic("V20Gy")` / `.mean` etc.
3. `compare.mjs` joins by ROI name and reports Δ (rtdose-js − dicompyler-core) and Δ%,
   flagging dose Δ > max(0.5 Gy, 2%), volume Δ > max(1 cm³, 2%), or V% Δ > 2 pp.

### The two implementations resample in opposite directions

| | `rtdose-js` (default) | `dicompyler-core` (`get_dvh` default) |
|---|---|---|
| histogram grid | the **structure** grid (dose sampled at structure voxel centres) | the **dose** grid (structure contours rasterized onto it) |
| dose interpolation | trilinear | nearest dose plane; no in-plane upsampling unless `interpolation_resolution` is set |
| plane axis | interpolated by projected position | nearest dose plane per structure slice |
| boundary voxels | whole-voxel binary | whole-voxel binary |

Despite that, the clinically meaningful quantities agree to well under 1% (see below). The
difference only becomes visible on a pure single-voxel extremum (`max`) at a structure
edge, where `rtdose-js` — sampling the dose at every one of the far denser 1.37 mm
structure voxels near the boundary — catches a hotter voxel than `dicompyler-core` sees on
its 2.5 mm dose-grid rasterization. Switching `rtdose-js` to `--method nearest` does **not**
close this gap (it is a resampling-direction / sampling-density effect, not an
interpolation effect), and it never moves `mean`, `D95`, `D2`, or any `V(d)`.

## Data sources

| Collection | Patients | Planning system | License | Citation |
|---|---|---|---|---|
| [Pancreatic-CT-CBCT-SEG](https://doi.org/10.7937/TCIA.ESHQ-4D90) | 3 (`Pancreas-CT-CB_003`, `_014`, `_030`) | Varian Eclipse (`DoseSummationType PLAN`, `DoseUnits GY`) | CC BY 4.0 | Hong J. et al., TCIA, 2021 |

Pancreas SBRT plans. Each triple is the planning CT series (the one the planning RTSTRUCT
`ReferencedFrameOfReferenceSequence` points at, `FrameOfReferenceUID` verified equal to the
RTDOSE's), the `BSPC_LL_LR_ROI_SDPC` structure set (ROIs: `ROI` target, `LUNG_L`, `LUNG_R`,
`Bowel_sm_planCT`, `Stomach_duo_planCT`), and the `Eclipse Doses` RTDOSE. Dose grids are
2.5 mm in-plane / 3 mm between planes; CT is 1.37 mm / 3 mm — so every ROI here exercises
the cross-grid resample.

Only one collection in TCIA's public (unauthenticated) API exposes RT dose alongside
structures and a CT (`Vestibular-Schwannoma-SEG` is the other, but it is MR-based Gamma
Knife with two plans per patient). More planning systems require an NBIA account and are a
follow-up.

## Agreement — the clinical quantities

Mean dose, D95, D2, and V20Gy for every ROI, all 3 patients. `Δ%` is against
`dicompyler-core`.

| Patient | ROI | mean Gy (js / dcm) | D95 Gy (js / dcm) | D2 Gy (js / dcm) | V20Gy % (js / dcm) |
|---|---|---|---|---|---|
| 003 | ROI (target) | 47.99 / 48.01 | 20.19 / 20.15 | 77.03 / 77.07 | 95.06 / 95.05 |
| 003 | Bowel_sm | 9.56 / 9.56 | 0.77 / 0.77 | 31.04 / 31.17 | 23.35 / 23.30 |
| 003 | Stomach_duo | 14.08 / 14.08 | 1.75 / 1.75 | 45.26 / 45.33 | 35.14 / 35.24 |
| 003 | LUNG_L | 0.79 / 0.79 | 0.35 / 0.35 | 1.92 / 1.92 | 0.0 / 0.0 |
| 003 | LUNG_R | 0.78 / 0.78 | 0.44 / 0.44 | 2.00 / 2.01 | 0.0 / 0.0 |
| 014 | ROI (target) | 48.40 / 48.42 | 31.73 / 31.73 | 77.81 / 77.94 | 98.51 / 98.51 |
| 014 | Bowel_sm | 33.69 / 33.70 | 11.69 / 11.66 | 48.52 / 48.71 | 83.20 / 83.31 |
| 014 | Stomach_duo | 33.32 / 33.28 | 7.65 / 7.64 | 48.57 / 48.63 | 80.26 / 80.14 |
| 014 | LUNG_L | 2.77 / 2.76 | 1.01 / 1.01 | 12.83 / 12.71 | 1.07 / 1.05 |
| 014 | LUNG_R | 2.81 / 2.80 | 0.86 / 0.86 | 18.26 / 18.23 | 1.56 / 1.54 |
| 030 | ROI (target) | 43.43 / 43.45 | 19.34 / 19.34 | 77.18 / 77.33 | 94.80 / 94.80 |
| 030 | Bowel_sm | 23.62 / 23.68 | 2.38 / 2.39 | 49.04 / 49.06 | 57.10 / 57.11 |
| 030 | Stomach_duo | 25.39 / 25.38 | 3.25 / 3.25 | 50.50 / 50.39 | 71.32 / 71.13 |
| 030 | LUNG_L | 1.89 / 1.89 | 0.55 / 0.55 | 11.36 / 11.34 | 0.47 / 0.47 |
| 030 | LUNG_R | 2.28 / 2.28 | 0.52 / 0.52 | 16.45 / 16.39 | 1.10 / 1.10 |

Largest deviations among these: `D2` on `Bowel_sm` / patient 014 (−0.4%, −0.19 Gy) and
`V20Gy` on `Bowel_sm` / 003 (+0.2 pp). Every mean-dose figure matches to ≤ 0.06 Gy; every
D95 to ≤ 0.04 Gy.

## Findings

**1. Clinical DVH metrics agree to sub-1%.** Across 3 patients × 5 ROIs, mean / D50 / D95 /
D2 and every V(d) (absolute and %) fall inside tolerance — 194 of 195 comparisons. The two
libraries resample in opposite directions (dose→structure grid vs structure→dose grid) and
still land on the same DVH, because the histogrammed volume is dominated by ROI interior
voxels where the dose field is smooth and both samplings agree.

**2. The one outlier is `max` dose on a small OAR.** `Stomach_duo` / patient 003:
`rtdose-js` 65.6 Gy vs `dicompyler-core` 63.8 Gy (+2.7%). `Bowel_sm` / 003 and both lungs /
014 show the same sign at +1.6–2.0%. `max` is a single-voxel extremum at the structure
boundary; `rtdose-js` samples the dose at ~3× finer voxel spacing there and picks up a
hotter penumbra voxel that `dicompyler-core`'s coarser dose-grid rasterization does not
include. It is a boundary/sampling-density effect, confirmed by the fact that
`rtdose-js --method nearest` does not reduce it. `max` dose is not a DVH decision criterion
(D2 or D0.1cc is used instead, and those agree here); this is documented behaviour, not a
defect.

**3. Structure volumes agree to ≤ 0.2%.** `rtdose-js`'s voxel volumes come from the CT
grid's `planeThicknessMm`; `dicompyler-core`'s from its own contour rasterization. The
largest gap over all 15 ROIs is 2.3 cm³ on a 1500 cm³ lung (0.15%).

**4. `DoseGridScaling`, `GridFrameOffsetVector`, and units parsed correctly on real
Eclipse dose.** `DoseGridScaling` here is ~4.5e-5; the agreement on absolute dose values
confirms it is applied. `GridFrameOffsetVector` starts at 0 and is ascending on all three
(no `DOSE_FRAMES_REORDERED` / `GRID_FRAME_OFFSET_NONZERO_ORIGIN` diagnostics fired).

### Not yet covered

- One planning system only (Varian Eclipse). Elekta / RayStation / Pinnacle dose needs an
  NBIA-authenticated download — follow-up.
- No `DoseSummationType BEAM` or `MULTI_PLAN` case.
- No non-zero `GridFrameOffsetVector` origin or reversed frame order seen in the wild yet
  (only synthetic coverage in `tests/unit/port.test.ts`).
- **`volumePolicy: "supersample"` (0.2.0) is not part of this comparison.** `dicompyler-core`
  has no sub-voxel mode, so there is nothing to diff against; it is covered by analytic
  tests only (`tests/unit/supersample.test.ts` — a known linear gradient across a single
  voxel). The 194/195 figure above is the **default** (`"whole-voxel-binary"`) path, which
  0.2.0 leaves byte-for-byte unchanged — the harness was re-run at 0.2.0 and reproduced it
  exactly (003 64/65, 014 65/65, 030 65/65).
