# rtdose-js

> **Not a treatment planning system. Not clinically validated.**
> D95 and V20 are clinical decision criteria — "V20 < 20% for lung" gates plan approval.
> This library is for research and QA tooling. Every dose metric it returns carries the
> method used to compute it, and [`docs/DVH-METHOD.md`](docs/DVH-METHOD.md) states the
> resampling, interpolation, and partial-volume choices plainly, so a disagreement with a
> planning system is explicable rather than mysterious. Do not use these numbers to make or
> check a treatment decision.

DICOM **RTDOSE** reading and dose-volume histograms, built on
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js). Part of the
[DICOM imaging toolkit](https://github.com/adeelbarki/dicom-imaging-toolkit-packages).

**Status:** 0.1.0 — first release. Reads a dose grid, samples it at a point, and answers
D/V/mean/DVH queries against a structure mask. `rt-geometry-js` `^0.1.1` is a **peer
dependency** (the resampling primitive landed in 0.1.1).

**Cross-checked against `dicompyler-core`** on real TCIA RTDOSE + RTSTRUCT + CT triples
(3 Varian Eclipse pancreas SBRT plans, 5 ROIs each): **194 / 195 metric comparisons within
tolerance** — mean / D50 / D95 / D2 and every V(d) agree to sub-1%, structure volumes to
≤ 0.2%. Full table and the one explained outlier (a single-voxel `max`-dose boundary
effect) in [`VALIDATION.md`](VALIDATION.md). This is a reference-implementation agreement
check, **not** clinical validation — the disclaimer above still stands.

**Standard pinned (for doc references):** DICOM PS3.3 **2026c**.

## Install

```sh
npm install rtdose-js rt-geometry-js
```

`rt-geometry-js` is a peer dependency, so it is installed explicitly and there is exactly
one copy — a `Mask3D` you build with it is the same `GridGeometry` implementation this
package resamples against. See the monorepo roadmap §4 for why this matters.

## Use

```ts
import { DoseGrid } from "rtdose-js";
import { RTStruct } from "rtstruct-js";

const dose = DoseGrid.fromDicom(rtdoseBytes);          // ArrayBuffer -> parsed dose grid
const rt = await RTStruct.load({ rtstruct: rtssBytes, geometry: ctGeometry });
const ptv = rt.getMask("PTV");

dose.getD(95, ptv);            // { doseGy, volumeFraction: 0.95, method }
dose.getV(20, ptv);            // { doseGy: 20, volumeMm3, volumeFraction, method }
dose.statistics(ptv);         // { minGy, maxGy, meanGy, volumeMm3, voxelCount, method }
dose.calculateDVH(ptv);       // { kind: "cumulative", points: [{ doseGy, volumeMm3, volumeFraction }], ... }
dose.sample([x, y, z]);       // interpolated dose at a physical point (0 outside the grid)
```

`rtstruct-js` is only used here to produce the ROI `Mask3D` — it is **not** a dependency of
`rtdose-js`. Any `Mask3D` on any `rt-geometry-js` `GridGeometry` works (a phantom, your own
rasterizer, a SEG mask later).

Every mask query resamples the dose field **onto the structure mask's grid** — dose is
sampled at each structure voxel centre (trilinear by default), then
`rt-geometry-js`'s histogram engine does the rest. Pass `{ method: "nearest" }` to any
query to switch the interpolation. The resample is memoised per `(mask geometry,
interpolation)`, so calling all four queries for one ROI costs one resample.

`dose.field` (a `ScalarField3D`) and `dose.geometry` are exposed for callers who want to
run the `rt-geometry-js` primitives directly.

## What it reads

| Element | Handling |
|---|---|
| `DoseGridScaling` (3004,000E) | applied — stored values become dose in `DoseUnits`. Absent → factor 1.0 + a warning diagnostic |
| `GridFrameOffsetVector` (3004,000C) | frame offsets (mm) along the grid normal, relative to `ImagePositionPatient`. Non-ascending → frames sorted + a diagnostic; non-zero first entry → a diagnostic |
| `DoseUnits` (3004,0002) | surfaced on `dose.units`; anything but `"GY"` raises a diagnostic (Gy-denominated thresholds stop being meaningful) |
| `DoseType`, `DoseSummationType` | surfaced, not interpreted |
| `PixelData` | 16- or 32-bit, signed or unsigned, uncompressed little-endian. Compressed dose is not supported |
| multi-frame geometry | frames stacked parallel to the grid normal (true for essentially all clinical RTDOSE) |

Parsing raises `NotRTDoseError` for a non-dose SOP class and `MalformedDoseGridError` when
the grid can't be assembled (missing Type 1 element, `GridFrameOffsetVector` length ≠
`NumberOfFrames`, `PixelData` too short). Soft issues are `dose.diagnostics`.

## Method, on every number

```ts
dose.getD(95, ptv).method
// {
//   resampling: "dose-sampled-at-structure-voxel-centres",
//   interpolation: "trilinear",
//   volumePolicy: "whole-voxel-binary",
//   resampledToMaskGrid: true
// }
```

`volumePolicy` is `"whole-voxel-binary"` — a structure voxel counts fully or not at all,
no fractional edge coverage. This moves D95 and V20 on small structures; supersampling is
deferred to a later minor. `resampledToMaskGrid` is `false` only when the dose grid already
coincides with the mask's grid. See [`docs/DVH-METHOD.md`](docs/DVH-METHOD.md).

## License

[MIT](../../LICENSE)
