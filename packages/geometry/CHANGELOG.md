# Changelog

## [1.1.0] - 2026-08-30

Additive — `^1.0.0` covers it, domain packages need no change. New mask
operations, the set both reviews asked for (booleans, physical morphology,
single-mask measurement).

### New

- **Boolean masks** (`mask-ops.ts`): `union`, `intersection`, `subtract`, `xor`,
  `complement`. Each requires both masks on an equivalent grid
  (`GridMismatchError` otherwise), returns a fresh `Mask3D`.
- **Physical morphology** (`morphology.ts`):
  - `distanceTransformMm(mask, { signed? })` → `ScalarField3D`: exact Euclidean
    distance (mm) to the nearest set voxel, anisotropic by `pixelSpacing`
    (Felzenszwalb–Huttenlocher, O(voxels)). The through-plane axis uses the
    grid's **mean** plane spacing — an approximation on a non-uniformly spaced
    grid. `signed` makes inside negative.
  - `dilateMm(mask, mm)` / `erodeMm(mask, mm)` — true Euclidean dilation/erosion
    by a mm-radius ball, implemented as a threshold on the distance field. Exact
    duals (`dilateMm(A, r) = ¬erodeMm(¬A, r)`); radius `0` is identity.
- **Single-mask measurement**:
  - `centroid(mask)` (`metrics.ts`) → `{ index, patientMm }`, volume-weighted the
    same way `centroidDisplacementMm` is. Throws `IndeterminateCentroidError` on
    an empty mask.
  - `boundingBox(mask)` (`mask-ops.ts`) → inclusive index box `{ min, max }` or
    `null` for an empty mask.
  - `crop(mask, box?)` → a `Mask3D` on a sub-grid (plane subset + shifted
    in-plane origin), every kept voxel's physical location preserved. Defaults to
    the mask's own bounding box.
  - `pad(mask, margin)` → a `Mask3D` on a grid grown by `margin` voxels per side.
    Column/row padding is always allowed; **plane** padding needs a
    uniformly-spaced grid with ≥ 2 planes.
- **Connected components** (`connected-components.ts`):
  `connectedComponents(mask, { connectivity: 6 | 26 })` → `{ labels, count,
  sizes }` (two-pass union-find; labels numbered 1..count in descending size
  order); `largestComponent(mask)` → `Mask3D`.

41 new tests (analytic checks — `dilateMm(r)` volume vs `4/3·π·r³`, boolean-op
identities on cube phantoms, connected-component counts, crop/pad physical-
location preservation). `CONTRACT.md` updated with the new surface.

## [1.0.0] - 2026-08-30

**No code change from 0.1.2.** This release only promotes the shared core to a
stable major so the toolkit has a real SemVer boundary to version against.

Background: the 0.x peer-dependency arrangement worked only as long as every
change stayed additive — the moment the core made a breaking change and one
domain package moved while another hadn't, npm could install two copies and the
"geometry objects the packages hand each other are identical" guarantee would
break silently. 0.1.1 and 0.1.2 were both additive across three consumers with
no breakage, and `rt-convert-js` (the package that stresses cross-domain
geometry identity hardest — SEG↔RTSTRUCT round trips) exercises the current
surface with 13 passing tests and needs nothing the API doesn't already expose.
So the surface is cut as-is.

### What this means

- New `CONTRACT.md` states exactly what the stability guarantee covers
  (`GridGeometry`'s public surface; `Mask3D` / `ScalarField3D` as interfaces;
  the constructors, sampling/resampling/histogram entry points, metrics,
  phantoms, and error classes) and what it does not — notably that the internal
  dense-buffer storage of `Mask3D` / `ScalarField3D` is **not** part of the
  contract and may change (e.g. bit-packing) in a minor.
- SemVer from here: additive → minor, breaking → major. Domain packages peer on
  `^1.0.0`.

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
