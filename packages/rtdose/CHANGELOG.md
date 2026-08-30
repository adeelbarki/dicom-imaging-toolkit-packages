# Changelog

## [0.2.0] - 2026-08-30

Additive — `rt-geometry-js` peer stays `^1.0.0`, and the default behaviour of every
method is byte-for-byte unchanged (the `dicompyler-core` agreement in `VALIDATION.md` was
re-run: same 194/195).

### Added

- **`volumePolicy: "supersample"`** on `statistics` / `getD` / `getV` / `calculateDVH`
  (via `DoseQueryOptions` / `DvhOptions`). Splits each occupied structure voxel into
  `supersampling`³ sub-voxels (`supersampling` an integer in `[2, 4]`, default `2`),
  point-samples the **raw** dose field at every sub-voxel centre, and gives each sub-voxel
  `1/k³` of the voxel volume. Resolves a steep dose gradient across a voxel that a single
  centre sample misses — moves D95/V20 on small structures. No resample is involved
  (`method.resampledToMaskGrid` is `false`). Cost scales `k³`×. See `docs/DVH-METHOD.md` §3.
- `DoseMethod` now carries `volumePolicy: "whole-voxel-binary" | "supersampled"`,
  `supersampling?: number`, and a second `resampling` value
  `"dose-sampled-at-structure-subvoxel-centres"`.
- A cross-frame-of-reference mask under supersampling throws `FrameOfReferenceMismatchError`
  (matching the whole-voxel path, which throws it via `resampleField`).

### Changed

- `DvhOptions` now `extends DoseQueryOptions` (it gains `volumePolicy` / `supersampling`;
  it already had `method`). `bins` unchanged. No break for existing call sites.

## [0.1.1] - 2026-08-30

No API change. Peer dependency `rt-geometry-js` bumped `^0.1.1` → `^1.0.0` — the shared
core was promoted to a stable major (identical code to its 0.1.2, see
`rt-geometry-js/CONTRACT.md`).

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
