# Conversion method and its lossy steps

`rt-convert-js` converts between two DICOM representations of the same anatomy. Neither
direction is lossless in general. This document states where information is lost and how
each conversion records it, so a downstream disagreement is explicable.

Every conversion returns `{ bytes, provenance }`. `provenance.lossySteps` is an array of
typed steps; an empty array means the conversion was a voxel copy.

## Both objects share one grid — conversions never resample

A conversion operates on a single `GridGeometry`:

- `rtstructToSeg` writes the SEG on the grid the RTSTRUCT was loaded onto
  (`RTStruct.load({ geometry })`).
- `segToRtstruct` writes contours on the SEG's own grid (`Segmentation.geometry`).

If you need the result on a different grid, resample with `rt-geometry-js` before or after
converting. Bringing resampling into the converter would hide a second interpolation
inside a call that looks like a format change.

## RTSTRUCT → SEG

`RTStruct.load` rasterizes each ROI's contours to a boolean mask at load time.
`rtstructToSeg` writes **exactly that mask** as a `BINARY` segment. The SEG's per-voxel
content is identical to `rt.getMask(roi)` — `provenance.lossySteps` is empty.

Information was lost turning the original polygon contours into voxels, but that happened
in `rtstruct-js`, before this call. `rtstruct-js`'s own round-trip tests characterize it
(mask → contour → mask is exact for grid-aligned shapes; Dice ≥ 0.99 for curved phantoms).

`RTROIInterpretedType` is a free-text string; SEG's `SegmentedPropertyCategory` /
`SegmentedPropertyType` are coded concepts. There is no defensible automatic mapping, so
none is done — pass `category` / `propertyType` explicitly if you need them coded.
`SegmentAlgorithmType` defaults to `SEMIAUTOMATIC` (RT contours are usually
clinician-drawn or semi-automated); override it if you know better.

## SEG → RTSTRUCT

`segToRtstruct(seg, segmentNumber, options?)` writes one ROI on the SEG's own grid
(`Segmentation.geometry`). Up to two lossy steps apply, in order.

### 1. `fractional-threshold` — FRACTIONAL SEG only

RTSTRUCT has no per-voxel value, so a `FRACTIONAL` field must be cut to a binary mask
first. Pass `options.threshold`; a voxel is kept when its value is `>=` the threshold.
There is **no default** — a `FRACTIONAL` SEG with no threshold throws
`MissingThresholdError`.

`options.thresholdScale` picks what the number means:

- `"unit"` (default) — against the field rescaled to `[0, 1]` by `MaximumFractionalValue`.
  Valid range `(0, 1]`.
- `"raw"` — against the stored integers. Valid range `(0, MaximumFractionalValue]`.

Out-of-range throws `RangeError`. The step records `threshold`, `thresholdScale`, the
declared `SegmentationFractionalType` (`0.7` means something different under PROBABILITY vs
OCCUPANCY — a note is added if the SEG declared none), `maximumFractionalValue`, and
`voxelsBefore` (the segment's non-zero support) / `voxelsAfter` (kept). A threshold that
keeps nothing is allowed and noted — the ROI is written empty.

Choosing the threshold is a clinical judgement the library will not make for you; record
which value you used (it is in the provenance) alongside the result.

### 2. `mask-vectorization` — always

The binary mask is traced to polygon contours (one loop per connected component per plane;
holes handled as `rtstruct-js` handles them) and written as the ROI's `ContourSequence`.
This is the inverse of rasterization and is not exact — re-rasterizing the contours onto
the same grid can differ from the source mask by boundary voxels.

`segToRtstruct` **measures this round trip for your structure**: it re-loads the RTSTRUCT
it just wrote onto the SEG's grid and compares. The step carries `voxelsBefore`,
`voxelsAfter`, `voxelDisagreement` (symmetric), and `dice` (`1.0` for grid-aligned shapes;
a little below for curved boundaries). So the provenance reflects the actual fidelity of
the conversion you ran, not a generic figure. Aggregate numbers across real TCIA files are
in `VALIDATION.md`.

`RTROIInterpretedType` defaults to the writer's `"ORGAN"`. The SEG's coded
`SegmentedPropertyCategory` / `SegmentedPropertyType` is **not** auto-translated to it —
the vocabularies do not line up, and a guess would fabricate a clinical claim. Pass
`options.interpretedType` if you need a specific value. `ReferencedFrameOfReferenceUID`
defaults to the SEG's frame of reference.
