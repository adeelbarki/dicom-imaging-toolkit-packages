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

## 3. Partial volume at the structure boundary

**Whole-voxel binary.** A structure voxel is either in the ROI or not; there is no
fractional edge weight. `method.volumePolicy` is always `"whole-voxel-binary"`.

Each voxel contributes its full physical volume, computed as
`pixelSpacing[0] · pixelSpacing[1] · planeThicknessMm(k)` on the **structure** grid, where
`planeThicknessMm` is the average distance to the neighbouring planes (so irregular slice
spacing is accounted for). This is `rt-geometry-js`'s `Mask3D.volume({ method: "voxel" })`.

On a small structure — a few voxels across — this policy moves D95 and V20 visibly versus
a TPS that supersamples or weights boundary voxels by fractional coverage. Supersampling is
deferred to a later minor version.

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

All four reduce to a single pass over the occupied voxels of the resampled field; none of
them re-interpolate per query.
