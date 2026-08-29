# Changelog

## [0.1.2] - 2026-08-28

Additive — no breaking change, `^0.1.0` covers it.

### New

- `meanValue(field, mask, tolerance?)` — volume-weighted mean of a `ScalarField3D` over a
  `Mask3D` (`Σ(vᵢ·xᵢ) / Σvᵢ`). This is `dicom-seg-js`'s `meanConfidence` for a FRACTIONAL
  SEG probability field, and mean dose for a dose field.
- `thresholdSensitivity(field, mask, thresholds, tolerance?)` — `volumeAboveThreshold`
  sampled across a list of thresholds in one pass, returned ascending as
  `{ threshold, volumeMm3, volumeFraction }[]`. Shows how much a FRACTIONAL segment's
  volume depends on where the confidence cut is placed (roadmap §7.2).

Both throw `GridMismatchError` off-grid and `RangeError` for an empty mask, matching the
existing histogram functions. Built here (not in `dicom-seg-js`) so the histogram/DVH
machinery stays in one place (roadmap §3).

## [0.1.1] - 2026-08-28

Additive — no breaking change, `^0.1.0` covers it.

### New

- **Resampling** (`resample.ts`), the primitive `rtdose-js` needs because dose grids and
  structure grids almost never coincide:
  - `sampleFieldAt(field, patientPoint, opts)` — value of a `ScalarField3D` at an
    arbitrary physical point. `"trilinear"` (default; exact for linear fields,
    corner-clamped at the grid edge) or `"nearest"`. Interpolates along the plane axis by
    the planes' projected positions, so irregular slice spacing is handled correctly. A
    point outside the extent returns `opts.outOfBounds` (default `0`).
  - `resampleField(source, targetGeometry, opts)` — a new `ScalarField3D` on
    `targetGeometry`, each voxel sampled from `source` at its physical centre.
  - `resampleMask(source, targetGeometry, opts)` — the reverse direction (structure onto
    the dose grid) by nearest-voxel membership.
  - All three throw `FrameOfReferenceMismatchError` when the two grids declare different
    frames of reference.

## [0.1.0] - 2026-08-27

First release. Extracted from `rtstruct-js` 0.2.1 as the shared geometry core for the
`dicom-imaging-toolkit-packages` monorepo (roadmap v2, Phase B). No DICOM, network, or
filesystem dependency.

### Included (moved from `rtstruct-js`, behaviour unchanged)

- `GridGeometry` — `createGridGeometry`, `createUniformGrid`, `equals`/`fingerprint`,
  `indexToPatient`/`patientToPixel`/`findNearestPlane`, `isUniformlySpaced`.
- `Mask3D` — `createEmptyMask`, `maskFromDense`, `checkVoxelBudget`, `DEFAULT_MAX_VOXELS`,
  `volume({ method })`.
- `sortPlanes` — projection sort, duplicate-plane detection, non-parallel rejection.
- `vec3` helpers, `DEFAULT_TOLERANCE`, `GridTolerance`.
- Analytic phantoms — `cubePhantom`, `spherePhantom`, `torusPhantom`, `analyticVolumeMm3`.
- Comparison metrics — `dice`, `voxelDisagreement`, `centroidDisplacementMm`.
- `Diagnostic` / `createDiagnostic` / `redact`, `Provenance`.
- Geometry errors — `ResourceLimitError`, `NonParallelPlanesError`,
  `NonOrthogonalBasisError`, `IndeterminateVolumeError`, `GridMismatchError`,
  `IndeterminateCentroidError`, `FrameOfReferenceMismatchError`, `NotImplementedError`.

### Changed during extraction

- `planeThicknessMm` is now a method on `GridGeometry` (roadmap Phase B step 2). The
  free function of the same name is kept as a thin delegating wrapper.
- `Diagnostic.code` is a plain `string` here — the RTSTRUCT-specific code union stays in
  `rtstruct-js`. `createDiagnostic` accepts any string.

### New

- `ScalarField3D` / `createScalarField` — a number per voxel, the counterpart of the
  boolean `Mask3D`. Backs RTDOSE and FRACTIONAL SEG in later phases.
- `histogram`, `volumeAboveThreshold`, `valueAtVolumeFraction` — a scalar field bucketed
  or queried over a mask. This is the DVH engine (D95 = `valueAtVolumeFraction(dose, roi,
  0.95)`, V20 = `volumeAboveThreshold(dose, roi, 20)`); the identical code serves SEG
  confidence histograms.

### Known / deferred

- `DEFAULT_TOLERANCE` is still the reasoned default from `rtstruct-js`, not yet
  re-derived from measured multi-vendor DICOM noise — tracked as a Phase B follow-up.
