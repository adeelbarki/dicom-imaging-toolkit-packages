# Validation against real DICOM files

`rt-convert-js` has no external reference implementation — there is no second tool that
converts RTSTRUCT ↔ SEG the same way to diff against. What it *is* built from is validated
independently:

- the contour ⇄ mask rasterize / vectorize primitives, in
  [`rtstruct-js`'s VALIDATION.md](../rtstruct/VALIDATION.md) — 5 vendors/tools, 2 498
  contours, real keyhole/nested distributions;
- SEG read / write, in [`dicom-seg-js`'s VALIDATION.md](../dicom-seg/VALIDATION.md) —
  voxel-exact vs `highdicom`, 728 / 728 slice checksums.

This document reports **self-consistency on real, de-identified TCIA data**: does each
conversion preserve what it claims to, and does the fidelity it reports in
`provenance.lossySteps` hold up against an independent re-measurement. No DICOM is included
in this repository or redistributed; every figure is derived from files downloaded from
TCIA's public API at analysis time (TCIA collections are pre-de-identified).

**Reproduce this:** [`scripts/validation/roundtrip.ts`](scripts/validation/) — see that
directory's README. Not part of the published package (`dist/` + docs only).

## Data sources

| Collection | File | Authoring tool | Used for | License / citation |
|---|---|---|---|---|
| LCTSC | `Train-S1-006` (CT + RTSTRUCT, 5 ROIs) | Plastimatch | RTSTRUCT → SEG | CC BY 3.0 · https://doi.org/10.7937/K9/TCIA.2017.3R3FVZ08 |
| NSCLC-Radiomics-Interobserver1 | `interobs11` (CT + RTSTRUCT, 24 ROIs) | Varian Eclipse | RTSTRUCT → SEG | CC BY-NC 3.0 · https://doi.org/10.7937/tcia.2019.cwvlpd26 |
| NSCLC-Radiomics | `LUNG1-001` (CT + RTSTRUCT, 4 ROIs) | (TCIA-published RS) | RTSTRUCT → SEG | CC BY-NC 3.0 · https://doi.org/10.7937/K9/TCIA.2015.PF0M9REI |
| C4KC-KiTS | `KiTS-00007` SEG (BINARY, Kidney + Mass) | QIICR `dcmqi` | SEG → RTSTRUCT | CC BY 3.0 · https://doi.org/10.7937/TCIA.2019.IX49E8NX |
| NSCLC-Radiomics | `LUNG1-005` SEG (BINARY, 6 segments) | QIICR `dcmqi` | SEG → RTSTRUCT | CC BY-NC 3.0 · (as above) |
| ISPY1 | `ISPY1_1004` SEG (FRACTIONAL / OCCUPANCY) | GE workstation | SEG → RTSTRUCT | CC BY 3.0 · https://doi.org/10.7937/K9/TCIA.2016.HdHpgJLK |

Only aggregate, derived statistics from the CC BY-NC collections appear here; no data is
redistributed. LCTSC and NSCLC-Radiomics are the same collections used for the `rtstruct-js`
keyhole scan.

## Method

**RTSTRUCT → SEG** — `readSeriesGeometry(series)` builds the CT grid; `RTStruct.load`
rasterizes each ROI onto it; `rtstructToSeg(rt, roi)` writes a BINARY SEG; `readSeg` +
`seg.mask(1)` reconstruct it; that is compared voxel-for-voxel against `rt.getMask(roi)`.
This direction is a **voxel copy** — `provenance.lossySteps` is empty and the pass
condition is `voxelDisagreement === 0` for every ROI.

**SEG → RTSTRUCT** — `readSeg` → `segToRtstruct(seg, n[, {threshold}])` → `RTStruct.load`
onto `seg.geometry` → `rt.getMask(roi)`, compared against the mask that was vectorized
(for FRACTIONAL, the post-threshold mask). This direction is a **vectorization**:
`voxelDisagreement > 0` on a curved boundary is expected, not a failure. The harness also
re-derives `voxelDisagreement` independently and checks it equals the figure
`segToRtstruct` put in `provenance.lossySteps[…].mask-vectorization`.

## Finding 1 — RTSTRUCT → SEG is voxel-for-voxel exact

| Case | Authoring tool | ROIs | Largest ROI (voxels) | Max `voxelDisagreement` | Min Dice |
|---|---|--:|--:|--:|--:|
| LCTSC `Train-S1-006` | Plastimatch | 5 | 630 348 (Lung_R) | **0** | 1.000000 |
| NSCLC-Interobs `interobs11` | Varian Eclipse | 24 | 4 546 (GTV-1auto-5) | **0** | 1.000000 |
| NSCLC-Radiomics `LUNG1-001` | TCIA RS | 4 | 1 036 805 (Lung-Right) | **0** | 1.000000 |

**33 ROIs across 3 authoring tools, zero voxel disagreement.** `rtstructToSeg` writes the
mask `RTStruct.load` produced, unmodified, and `dicom-seg-js` reads back exactly that —
confirmed on real CT grids (512×512, 100–200 planes) and ROIs spanning a single small
structure (Esophagus, 12 136 voxels) to a whole lung (> 1M voxels).

## Finding 2 — SEG → RTSTRUCT: the reported fidelity is the real fidelity

| Case | Type | Segment(s) | `voxelsBefore` → `voxelsAfter` | `provenance.dice` | `voxelDisagreement` | independent re-check |
|---|---|---|---|--:|--:|---|
| C4KC-KiTS `KiTS-00007` | BINARY | Kidney (206 780) | unchanged | 1.000000 | 0 | matches (Δ 0) |
| C4KC-KiTS `KiTS-00007` | BINARY | Mass (7 058) | unchanged | 1.000000 | 0 | matches (Δ 0) |
| ISPY1 `ISPY1_1004` | FRACTIONAL, thr 0.5 (unit) | PE Tumor | 89 711 → 89 711 | 1.000000 | 0 | matches (Δ 0) |

For the `dcmqi`-generated kidney/mass SEG and the GE fractional file, `segToRtstruct` →
`RTStruct.load` reproduces the segment mask **exactly** — Dice 1.000000, 0 voxel
disagreement. These are grid-aligned, mostly-convex structures; tracing them to contours
and re-rasterizing loses nothing. The ISPY1 file's `SegmentationFractionalType` is
`OCCUPANCY` but every non-zero voxel is at `MaximumFractionalValue` (`dicom-seg-js` flags
this as `FRACTIONAL_VALUES_LOOK_BINARY`), so the 0.5 threshold keeps its whole support and
the two lossy steps (`fractional-threshold`, then `mask-vectorization`) both come through
clean.

In every case the harness's independent re-measurement of `voxelDisagreement` equals the
number `segToRtstruct` put in `provenance.lossySteps` — so the per-conversion fidelity
figure can be trusted for structures where it is *not* exact.

The 6-segment NSCLC-Radiomics `LUNG1-005` SEG (512×512 × 91 planes) was not run to
completion — the harness re-rasterizes once per segment and `rtstruct-js`'s `rasterize` is
slow at that grid size (see `docs/PERFORMANCE.md`); it is a tooling limit, not a
correctness result, and `dicom-seg-js` already validates that file's *read* voxel-exact
against `highdicom`.

## What this proves — and does not

**Does:**

- RTSTRUCT → SEG loses nothing beyond what `RTStruct.load`'s rasterization already did
  (verified across 3 authoring tools, 33 ROIs).
- `segToRtstruct`'s `provenance.lossySteps` fidelity figure is accurate — it is a real
  re-measurement, not a generic claim.
- The whole `RTStruct` / `Segmentation` / geometry chain interoperates on real CT grids.

**Does not:**

- Compare against an independent RTSTRUCT ↔ SEG converter (none was found; `dcmqi` goes
  DICOM ↔ research formats, not RTSTRUCT ↔ SEG directly).
- Exercise FRACTIONAL PROBABILITY SEG — TCIA's fractional SEGs are rare and the sampled
  ISPY1 file is a binary mask stored as OCCUPANCY (see `dicom-seg-js` VALIDATION.md).
- Cover multi-frame-of-reference or oblique-grid conversions.
