# Changelog

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
