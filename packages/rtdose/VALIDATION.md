# Validation against real DICOM files

`rtdose-js`'s correctness suite (`tests/unit/`) uses synthetic dose grids with closed-form
answers — a uniform field, a linear ramp. That proves the parsing, the resampling wiring,
and the DVH arithmetic are right. It proves nothing about agreement with an established DVH
implementation on a real plan, where the dose grid, the structure set, and the CT all come
from a planning system and carry its conventions.

This document is where that comparison lives: `rtdose-js` vs
[`dicompyler-core`](https://github.com/dicompyler/dicompyler-core) — D2/D50/D95,
V5Gy/V20Gy/V30Gy, and mean/min/max dose, per ROI, on real RTDOSE + RTSTRUCT pairs from
[TCIA](https://www.cancerimagingarchive.net/). Same pattern as `rtstruct-js`'s keyhole
scan: **the comparison harness is built before the results exist**, so the implementation
is checked against a reference rather than trusted.

No DICOM files are included in this repository or redistributed. Every number that lands
here is a derived, aggregate figure computed from files downloaded from TCIA's public API
at analysis time; TCIA collections are pre-de-identified before publication.

**Reproduce this**: [`scripts/validation/`](scripts/validation/) — `metrics-rtdose-js.ts`,
`metrics-dicompyler.py`, `compare.mjs`. See that directory's README for the run sequence.
Not part of the published npm package (`dist/` only).

## Status

| | |
|---|---|
| Harness | ✅ built and smoke-tested (Phase E PR 3, 2026-08-28) |
| `rtdose-js` side (`metrics-rtdose-js.ts`) | ✅ end-to-end on a synthetic CT+RTSTRUCT+RTDOSE triple: box ROI on a linear ramp, every metric matched the hand calculation (mean 4.5 Gy, D95 2 Gy, D50 5 Gy, V5Gy 50%, volume 1.2 cm³) |
| `dicompyler-core` side (`metrics-dicompyler.py`) | ✅ compiles; needs `pip install dicompyler-core` + real data to run |
| Agreement table on real TCIA data | ⏳ **pending a data run** — table below is the placeholder |

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
| plane axis | interpolated by projected position | nearest dose plane per structure slice unless `interpolation_segments_between_planes` > 0 |
| boundary voxels | whole-voxel binary | whole-voxel binary |

This is a genuine method difference, not a bug in either. Expect the largest disagreements
on **small structures** (few voxels across) and **steep dose gradients** (penumbra,
hot-spot edges). The harness also emits a `--method nearest` variant of the `rtdose-js`
numbers: comparing *that* against `dicompyler-core` isolates the resampling-direction
difference from the interpolation difference.

## Data sources

*To be filled when the run happens. Target: RTDOSE + RTSTRUCT pairs spanning at least two
planning systems (e.g. Varian Eclipse, Elekta Monaco/RayStation) from TCIA collections
that publish RT dose — e.g. a subset of those already used for the `rtstruct-js` keyhole
scan that also ship an RTDOSE.*

| Collection | Patients | Planning system | License | Citation |
|---|---|---|---|---|
| _pending_ | | | | |

## Agreement table

*Placeholder — populated by `compare.mjs` output once run against real data.*

| ROI | metric | rtdose-js | dicompyler-core | Δ | Δ% | within tol |
|---|---|--:|--:|--:|--:|:-:|
| _pending_ | | | | | | |

### Findings

_pending the run — this section will record the agreement rate, every row outside
tolerance, and which method difference above explains it (the same discipline as
`rtstruct-js`'s VALIDATION.md: disagreements are reported and explained, not hidden)._
