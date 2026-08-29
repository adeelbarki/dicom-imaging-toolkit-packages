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

*(Implemented in a later PR — this section describes the intended contract.)*

Two lossy steps, in order:

1. **`fractional-threshold`** (FRACTIONAL SEG only). RTSTRUCT has no per-voxel value, so a
   `FRACTIONAL` field must be cut to a binary mask at a caller-supplied `threshold`. There
   is **no default** — `segToRtstruct` throws `MissingThresholdError` if the SEG is
   `FRACTIONAL` and no threshold is given. The step records the threshold, its scale
   (`unit` against the rescaled `[0,1]` field, or `raw` against the stored integers), the
   SEG's declared `SegmentationFractionalType` (a value means something different under
   PROBABILITY vs OCCUPANCY), `MaximumFractionalValue`, and the voxel count before/after.

2. **`mask-vectorization`**. The binary mask is traced to polygon contours, one per
   connected component per plane, holes handled as `rtstruct-js` handles them. This is the
   inverse of rasterization and is not exact: re-rasterizing the contours onto the same
   grid can differ from the source mask by boundary voxels. The step records that it ran;
   the magnitude for real data is reported in `VALIDATION.md`.
