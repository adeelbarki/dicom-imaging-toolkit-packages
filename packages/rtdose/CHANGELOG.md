# Changelog

## [0.1.0] - 2026-08-28

First release. DICOM RTDOSE reading and dose-volume histograms, built on `rt-geometry-js`
`^0.1.1` (peer dependency). Part of the `dicom-imaging-toolkit-packages` monorepo
(roadmap v2, Phase E, PR 2).

**Not a treatment planning system and not clinically validated.** It *is* cross-checked
against `dicompyler-core` on real TCIA RTDOSE + RTSTRUCT + CT triples (roadmap §9):
194 / 195 metric comparisons within tolerance across 3 Varian Eclipse pancreas SBRT plans
× 5 ROIs — see `VALIDATION.md`. That is reference-implementation agreement, not clinical
validation.

### Added

- `DoseGrid.fromDicom(bytes)` — parse one RTDOSE object:
  - `DoseGridScaling` applied; stored values become dose in `DoseUnits`.
  - `GridFrameOffsetVector` read as frame offsets along the grid normal relative to
    `ImagePositionPatient`; non-ascending frames are sorted and flagged.
  - 16-/32-bit, signed/unsigned, uncompressed little-endian `PixelData`.
  - `NotRTDoseError` for a non-dose SOP class; `MalformedDoseGridError` for an
    unassemblable grid (missing Type 1 element, `GridFrameOffsetVector` length mismatch,
    short `PixelData`).
  - Soft issues (units not Gy, missing `DoseGridScaling`, reordered frames, single-frame
    grid, non-zero offset origin) surface as `dose.diagnostics`.
- `dose.sample(point, { method })` — interpolated dose at a physical point; `0` outside the
  grid extent.
- `dose.statistics(mask)` — min / max / volume-weighted mean over a structure mask.
- `dose.calculateDVH(mask, { bins, method })` — cumulative dose-volume histogram.
- `dose.getD(percent, mask)` — Dx% (dose covering x% of the structure).
- `dose.getV(doseGy, mask)` — V(d) (structure volume at or above a dose), absolute and
  fractional.
- Every mask query resamples the dose field onto the mask's grid (roadmap §6.1 default:
  sample dose at structure voxel centres), trilinear by default, memoised per
  `(mask geometry, interpolation)`. `FrameOfReferenceMismatchError` when the grids declare
  different frames of reference.
- Every metric return carries `method` — `resampling`, `interpolation`, `volumePolicy`
  (`"whole-voxel-binary"`), `resampledToMaskGrid` (roadmap §6.4). `docs/DVH-METHOD.md`
  records the choices.
- `readRTDose(bytes)` — the standalone parse function (counterpart of `rtstruct-js`'s
  `readSeriesGeometry`).

### Known / deferred

- `dicompyler-core` cross-check covers one planning system (Varian Eclipse); Elekta /
  RayStation / Pinnacle dose needs an NBIA-authenticated TCIA download. No
  `DoseSummationType BEAM` / `MULTI_PLAN` case yet.
- `volumePolicy` is whole-voxel binary only; fractional edge coverage / supersampling is a
  later minor (roadmap §6.3).
- Single-frame dose grids sample in-plane only, and volume queries need a structure mask
  with at least two planes (slice thickness is otherwise undefined).
- Compressed `PixelData` is not supported.
- Dose frames are assumed stacked parallel to the grid normal (non-coplanar
  `GridFrameOffsetVector` is not handled).
