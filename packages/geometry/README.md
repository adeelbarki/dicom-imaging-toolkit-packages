# rt-geometry-js

The shared geometry core for the [DICOM imaging toolkit](https://github.com/adeelbarki/dicom-imaging-toolkit-packages).
Physical sampling grids, boolean masks, scalar fields, analytic phantoms, comparison
metrics, and a histogram/DVH engine — with **no DICOM, network, or filesystem
dependency**.

**Standard-agnostic by design.** A `GridGeometry` may come from a CT/MR series, an AI
model, a resampling step, NIfTI, or a synthetic phantom. Domain packages
(`rtstruct-js`, and later `rtdose-js` / `dicom-seg-js`) depend on this as a **peer**, so
a `Mask3D` built by one meets the same `GridGeometry` implementation in another.

**Standard pinned (for the doc references):** DICOM PS3.3 **2026c**.

**Status:** published — [`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js) 0.1.0 on npm, extracted from `rtstruct-js` 0.2.1. See `CHANGELOG.md`.

## Install

```sh
npm install rt-geometry-js
```

## What's inside

| Area | Exports |
|---|---|
| Grid | `createGridGeometry`, `createUniformGrid`, `GridGeometry` (incl. `.planeThicknessMm()`), `GridPlane`, `GridTolerance`, `DEFAULT_TOLERANCE` |
| Planes | `sortPlanes` — projection sort, duplicate detection, non-parallel rejection |
| Mask | `createEmptyMask`, `maskFromDense`, `Mask3D`, `checkVoxelBudget`, `DEFAULT_MAX_VOXELS` |
| Scalar field | `createScalarField`, `ScalarField3D` — a number per voxel |
| Histograms / DVH | `histogram`, `volumeAboveThreshold`, `valueAtVolumeFraction` |
| Phantoms | `cubePhantom`, `spherePhantom`, `torusPhantom`, `analyticVolumeMm3` |
| Metrics | `dice`, `voxelDisagreement`, `centroidDisplacementMm` |
| Diagnostics | `createDiagnostic`, `Diagnostic` and `Provenance` (each with a `.redact()` that strips UIDs) |
| Vectors | `add`, `sub`, `scale`, `dot`, `cross`, `normalize`, `distance`, `length`, `angleBetween` |
| Errors | `ResourceLimitError`, `NonParallelPlanesError`, `NonOrthogonalBasisError`, `IndeterminateVolumeError`, `GridMismatchError`, `IndeterminateCentroidError`, `FrameOfReferenceMismatchError`, `NotImplementedError` |

## DVH / histogram engine

A dose-volume histogram is *"histogram a scalar field, restricted to a mask."* The same
code answers the SEG confidence-histogram question when the field is per-voxel
probability instead of dose.

```ts
import { createScalarField, valueAtVolumeFraction, volumeAboveThreshold } from "rt-geometry-js";

const dose = createScalarField(grid, doseValuesGy);       // Float32Array, one per voxel
const d95 = valueAtVolumeFraction(dose, ptvMask, 0.95);   // Gy covering 95% of the PTV
const v20 = volumeAboveThreshold(dose, lungMask, 20);     // mm³ of lung at >= 20 Gy
```

Every value is measured against the mask's own physical voxel volumes, so irregular
plane spacing is handled correctly. The field and mask must share a `GridGeometry`
(`GridMismatchError` otherwise) — cross-grid resampling arrives with `rtdose-js`.

## Interfaces, not classes

`GridGeometry`, `Mask3D`, and `ScalarField3D` are exported as **interfaces**. The dense
`Uint8Array` / `Float32Array` backing is an implementation detail; relying on it is not
supported.

## License

[MIT](LICENSE)
