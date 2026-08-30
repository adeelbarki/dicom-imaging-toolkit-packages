# Changelog

## [0.1.0] - unreleased

First release. Convert between DICOM RT Structure Sets and DICOM Segmentation, with every
lossy step recorded in provenance.

### Added

- `rtstructToSeg(rt, roi, options?)` — one RTSTRUCT ROI → single-segment `BINARY` SEG.
  `rt` is an `RTStruct` already loaded onto a `GridGeometry`; the SEG is written on that
  same grid, voxel-for-voxel identical to `rt.getMask(roi)`. This direction has no lossy
  step (`provenance.lossySteps` is empty) — the contours were rasterized to voxels by
  `RTStruct.load`, before the conversion. Options carry `SegmentNumber` / `SegmentLabel` /
  coded `category` / `propertyType` / `FrameOfReferenceUID` / `ContentLabel`.
- `segToRtstruct(seg, segmentNumber, options?)` — one SEG segment → single-ROI RTSTRUCT
  on the SEG's own grid. Async. Returns `{ bytes, provenance }`.
  - **BINARY** — the mask is traced straight to contours.
  - **FRACTIONAL** — the field is first cut to a mask at `options.threshold` (a voxel is
    kept when its value is `>=` it). Required — `MissingThresholdError` if absent.
    `options.thresholdScale` is `"unit"` (default, against the `[0,1]` field) or `"raw"`
    (against the stored integers); out of range → `RangeError`.
  - `provenance.lossySteps` lists each step, in order: `fractional-threshold` (FRACTIONAL
    only — records threshold, scale, declared type, max, voxels before/after) then
    `mask-vectorization` (always — the **measured** round trip: `voxelsBefore`,
    `voxelsAfter`, `voxelDisagreement`, `dice`, from re-rasterizing what was written).
  - Options: `roiName` (default `SegmentLabel`, else `"Segment <n>"`), `interpretedType`
    (the SEG's coded category/type is not auto-translated), `referencedFrameOfReferenceUID`
    (default the SEG's frame of reference), `threshold`, `thresholdScale`.
- `ConversionResult` = `{ bytes, provenance }`. `ConversionProvenance` records the
  direction, the shared grid, the written voxel count, `lossySteps`, and free-text `notes`
  (including diagnostics carried across from the source object).
- Errors: `ConversionError` (base), `MissingThresholdError`, `SegmentNotFoundError`.

### Depends on

- `rt-geometry-js` `^0.1.2`, `rtstruct-js` `^0.3.1`, `dicom-seg-js` `^0.1.0` — all peer
  dependencies. This is the only toolkit package that depends on two domain packages.
