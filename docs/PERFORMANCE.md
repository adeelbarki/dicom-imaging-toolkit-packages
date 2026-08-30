# Performance

Numbers you can plan around for browser and Node use. Every package has a
`bench/` suite (`npm run bench` in that package, `vitest bench`); the figures
below are its median (`mean`) times.

**Measured on:** Apple M3 Max, Node v20.10.0, single-threaded. A mid-range laptop
or a browser tab is roughly 1.5–3× slower. These are wall-clock medians over
8–200 samples; treat them as order-of-magnitude, not guarantees.

Every per-voxel operation here is **O(voxels)** and every contour operation is
**O(points)**, so scaling to a different grid is close to linear — a
512 × 512 × 200 volume (≈ 52M voxels) is ≈ 12× the 4.2M-voxel bench grid, so
multiply accordingly.

## Memory

Storage is dense, one array over the whole volume:

| Type | Backing | Bytes per voxel | 256²×64 (4.2M) | 512²×200 (52M) |
|---|---|--:|--:|--:|
| `Mask3D` | `Uint8Array` | 1 | ~4 MB | ~52 MB |
| `ScalarField3D` (dose, fractional SEG) | `Float32Array` | 4 | ~17 MB | ~210 MB |

A `ScalarField3D` for a 512³-class dose grid is the item to watch in a browser
tab. `getSliceBuffer()` returns a **view** into that one backing buffer (no
copy); copy a slice before mutating it, and see [Web Workers](#web-workers).

## rt-geometry-js — grid 256 × 256 × 64 (4.2M voxels)

| Operation | Median | Notes |
|---|--:|---|
| `resampleField` dose(110²×44) → structure(256²×64), trilinear | **~1730 ms** | ~410 ns/voxel. The dominant cost whenever dose and structure grids differ. A 52M-voxel target ≈ 21 s single-threaded — a Web Worker case. |
| `histogram(field, mask, 256 bins)` | ~13 ms | |
| `valueAtVolumeFraction` (D95-style) | ~60 ms | sorts the masked values |
| `volumeAboveThreshold` (V20-style) | ~9 ms | single pass |
| `dice(a, b)` | ~8.5 ms | |
| `voxelDisagreement(a, b)` | ~8.5 ms | |
| `spherePhantom` r=60 | ~216 ms | per-plane scan fill |

## rtstruct-js — grid 256 × 256 × 64, sphere ROI (~60 planar contours)

| Operation | Median | Notes |
|---|--:|---|
| `vectorize` (mask → contours) | ~13 ms | |
| `rasterize` (contours → mask) | **~1820 ms** | even-odd scanline fill; markedly slower than the trace. A known optimisation target — not yet tuned. Scales with voxels, so budget accordingly for 512²×200. |

## rtdose-js — dose grid 128 × 128 × 80 (1.3M voxels), PTV ~200k voxels, no resample

| Operation | Median |
|---|--:|
| parse RTDOSE bytes → `DoseGrid` | ~4.9 ms |
| `calculateDVH(mask, 256 bins)` | ~4.8 ms |
| `getD(95, mask)` | ~13.6 ms |
| `getV(20, mask)` | ~3.9 ms |
| `statistics(mask)` | ~2.2 ms |

When the dose and structure grids differ, add one `resampleField` (memoised per
ROI, so it is paid once, not per query) — see the rt-geometry-js row above.

## dicom-seg-js — BINARY SEG 256 × 256 × 200 (13M voxels, 200 frames, ~1.6 MB bitstream)

| Operation | Median | Notes |
|---|--:|---|
| `readSeg` (parse + geometry from Functional Groups) | ~15 ms | O(frames) |
| `readSeg` + `seg.mask(1)` (full `BitArray` unpack → dense `Mask3D`) | ~82 ms | O(voxels); memoised per segment |
| `writeSeg` (`Mask3D` → BINARY bytes) | ~169 ms | |

## Web Workers

The scalar-heavy work (`resampleField`, large-field histograms, SEG unpack) is
the candidate for a worker. The libraries are worker-*safe* — no package owns
worker orchestration, that belongs to the consuming app. Prefer transferring the
`ArrayBuffer` over structured cloning; note `getSliceBuffer()` returns a view
into a larger buffer, so transfer the whole backing buffer or copy the slice
first.

## Reproducing

```sh
npm run bench --workspace rt-geometry-js
npm run bench --workspace rtstruct-js
npm run bench --workspace rtdose-js
npm run bench --workspace dicom-seg-js
```

The heavier benches (`resampleField`, `rasterize`) take ~30 s each because
`vitest bench` runs a minimum sample count; the suite is a manual / nightly tool,
not part of the required CI gate.
