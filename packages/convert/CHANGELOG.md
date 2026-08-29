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
- `ConversionResult` = `{ bytes, provenance }`. `ConversionProvenance` records the
  direction, the shared grid, the written voxel count, `lossySteps`, and free-text `notes`
  (including diagnostics carried across from the source object).
- Errors: `ConversionError` (base), `MissingThresholdError`, `SegmentNotFoundError`.

### Depends on

- `rt-geometry-js` `^0.1.2`, `rtstruct-js` `^0.3.1`, `dicom-seg-js` `^0.1.0` — all peer
  dependencies. This is the only toolkit package that depends on two domain packages.
