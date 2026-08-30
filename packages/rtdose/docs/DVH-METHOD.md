# DVH method

Every dose number `rtdose-js` returns depends on three choices. A treatment planning
system (TPS) makes the same three choices, sometimes differently, and that is the usual
reason two DVHs of "the same" plan and structure disagree. This document states what
`rtdose-js` does. The `method` object on every metric return reports it per call.

> Reminder: this library is research/QA tooling, not a TPS, and 0.1.0 is not yet validated
> against a reference implementation. See the README.

## 1. Resampling direction

Dose grids and CT/structure grids almost never coincide — RTDOSE is typically 2–3 mm with
its own extent and sometimes its own orientation. So **every** D/V/mean/DVH query crosses
grids.

`rtdose-js` **samples the dose at the structure's voxel centres**: the dose
`ScalarField3D` is resampled onto the structure mask's `GridGeometry`, once, then the
histogram runs on that grid. The structure grid is never moved onto the dose grid.

- `method.resampling` is always `"dose-sampled-at-structure-voxel-centres"`.
- `method.resampledToMaskGrid` is `false` only when the dose grid already equals the mask
  grid (`GridGeometry.equals`), so no resample was needed.
- The resample is memoised per `(mask geometry, interpolation)` — one resample per ROI,
  not one per query.
- If the dose grid and the mask declare different `FrameOfReferenceUID`s, the query throws
  `FrameOfReferenceMismatchError` rather than resample across physically incomparable
  coordinate systems.

The reverse direction (resample the structure onto the dose grid) is a legitimate
alternative that some TPS vendors use; `rt-geometry-js` exposes `resampleMask` for callers
who want it, but `rtdose-js` 0.1.0 does not offer it as a mode.

## 2. Interpolation

**Trilinear by default.** Exact for a locally linear dose field, and smooth under a moving
cursor for `dose.sample()`. Pass `{ method: "nearest" }` to any query (or `sample`) to use
nearest-neighbour instead; `method.interpolation` reports which ran.

At the dose grid boundary the trilinear stencil is corner-clamped (an edge voxel is not
pulled toward zero by a missing neighbour). A point more than half a voxel outside the
dose grid reads as **0 Gy** — dose is taken to be zero beyond the stored extent.

Interpolation happens along the plane axis by the planes' **projected positions**, so an
irregularly spaced dose or structure stack is handled correctly rather than assuming a
constant pitch.

## 3. Partial volume and supersampling

### Default — whole-voxel binary

A structure voxel is either in the ROI or not; there is no fractional edge weight.
`method.volumePolicy` is `"whole-voxel-binary"` and one dose sample is taken per voxel.

Each voxel contributes its full physical volume, computed as
`pixelSpacing[0] · pixelSpacing[1] · planeThicknessMm(k)` on the **structure** grid, where
`planeThicknessMm` is the average distance to the neighbouring planes (so irregular slice
spacing is accounted for). This is `rt-geometry-js`'s `Mask3D.volume({ method: "voxel" })`.

### `volumePolicy: "supersample"` (0.2.0)

Pass `{ volumePolicy: "supersample", supersampling: k }` (`k` an integer in `[2, 4]`,
default `2`) to any of `statistics` / `getD` / `getV` / `calculateDVH`. Each occupied
structure voxel is split into `k³` sub-voxels; the **raw** dose field is point-sampled
(same interpolation as §2) at every sub-voxel centre, and each sub-voxel carries
`1/k³` of the voxel's physical volume. The returned `method` then reads
`volumePolicy: "supersampled"`, `resampling: "dose-sampled-at-structure-subvoxel-centres"`,
`supersampling: k`, `resampledToMaskGrid: false` (there is no resample — the dose is
sampled directly).

This resolves a steep dose gradient *across* a voxel that a single centre sample misses.
On a small structure it moves D95 and V20 — a single voxel straddling a 40 Gy/mm gradient
reports min = max = its centre dose under the default, but a spread of ±(half a voxel × the
gradient) under `k = 2`. It does **not** recover sub-voxel *boundary* coverage: the mask is
already binary, so a partially-included edge voxel is still all-or-nothing. Cost scales as
`k³` × the sample count. The whole-voxel path is unchanged and remains the default (it is
what the `dicompyler-core` validation in `VALIDATION.md` covers).

## 4. Derived quantities

Given the resampled dose field `f` and the structure mask `m` on the same grid:

- **`statistics(m)`** — `minGy`/`maxGy` are the raw extremes over occupied voxels;
  `meanGy` is volume-weighted, `Σ(vᵢ·dᵢ) / Σvᵢ`.
- **`getD(p, m)`** — `valueAtVolumeFraction(f, m, p/100)`: sort occupied voxels by dose
  descending, walk the cumulative volume, return the dose at which it first reaches
  `p/100` of the total. `getD(0)` is the max dose in the mask, `getD(100)` the min.
- **`getV(d, m)`** — `volumeAboveThreshold(f, m, d)`: total physical volume of occupied
  voxels with dose `≥ d` (threshold inclusive), plus that as a fraction of the structure
  volume.
- **`calculateDVH(m, { bins })`** — `bins` equal-width dose bins over `[0, maxDose]`; each
  output point `(doseGy = binEdge, volumeMm3)` is the volume receiving **at least** that
  dose, so the curve is non-increasing. The first point is at 0 Gy with the full structure
  volume; the last is at the max dose with volume 0. `meanDoseGy` on the result is the same
  volume-weighted mean as `statistics`.

By default all four reduce to a single pass over the occupied voxels of the resampled
field; none of them re-interpolate per query. Under `volumePolicy: "supersample"` the same
four run over the `k³`-per-voxel sub-sample list instead (`getD`/`getV` with the identical
sort-and-walk / threshold logic, `calculateDVH` binning the sub-samples the same way
`histogram` bins voxels), and the dose is sampled from the raw field at each sub-centre
rather than read from a resample.
