# Changelog

## [0.1.0] - 2026-08-29

First release — **read only**. DICOM Segmentation (SEG) reading, built on `rt-geometry-js`
`^0.1.2` (peer dependency). Part of the `dicom-imaging-toolkit-packages` monorepo
(roadmap v2, Phase F, PR 2).

### Added

- `readSeg(bytes)` / `Segmentation.fromDicom(bytes)` — parse one SEG object:
  - `BINARY` and `FRACTIONAL` (`LABELMAP` → `UnsupportedSegmentationTypeError`, planned
    for 0.2.0).
  - One `GridGeometry` built from the Per-Frame / Shared Functional Groups, spanning every
    distinct frame position; planes sorted along the normal.
  - `NotSegmentationError` for a non-SEG SOP class; `MalformedSegmentationError` for an
    unassemblable object (missing `SegmentSequence` / shared `PixelMeasures` /
    `PlaneOrientation`, per-frame group count ≠ `NumberOfFrames`, a frame referencing an
    undeclared `SegmentNumber`, short `PixelData`).
- `seg.segments()` — number, label, `SegmentAlgorithmType` / `Name`, coded
  `SegmentedPropertyCategory` / `Type` / `TypeModifier`, `TrackingID` / `TrackingUID`,
  and the per-segment stored frame count.
- `seg.mask(n)` — `Mask3D` for a BINARY segment (bit-unpacked; the non-conformant
  byte-aligned-per-frame variant is detected and handled with a diagnostic).
- `seg.field(n)` — `ScalarField3D` for a FRACTIONAL segment, rescaled to `[0, 1]` by
  `MaximumFractionalValue`. `seg.rawField(n)` keeps the stored integers.
- `seg.fractionalType` — `PROBABILITY` / `OCCUPANCY`, **never defaulted** (absent →
  `undefined` + a `FRACTIONAL_TYPE_ABSENT` diagnostic; roadmap §7.1).
- `seg.segmentsOverlap` — `SegmentsOverlap` surfaced; `YES` also raises a diagnostic.
- `seg.support(n)` — `Mask3D` of a segment's footprint (the mask for BINARY; non-zero
  voxels for FRACTIONAL), for use as the `mask` argument to the honest metrics.
- `seg.sampleConfidence(n, point)` — interpolated confidence at a physical point (§7.3),
  the same call as `dose.sample()` against a different field.
- `mask()` on FRACTIONAL / `field()` on BINARY throw `SegmentationTypeMismatchError` — no
  implicit threshold.
- The full `rt-geometry-js` surface is re-exported, so `meanValue` /
  `volumeAboveThreshold` / `thresholdSensitivity` (from 0.1.2) are available from a single
  import. No "accuracy" / "% correct" metric anywhere (§7.2).

### Known / deferred

- **Read only** — `writeSeg` (BINARY + FRACTIONAL) is the next PR.
- **LABELMAP** deferred to 0.2.0 (little real-world test data yet).
- FRACTIONAL diagnostics so far: missing type, missing `MaximumFractionalValue`. The
  "OCCUPANCY field that is really a thresholded probability" heuristic (§7.1) and the
  validation table vs `pydicom-seg` / `highdicom` land with `docs/FRACTIONAL-SEG.md` in a
  later PR.
- Per-frame `PlaneOrientationSequence` that varies from the shared one is flagged but not
  honoured (the shared orientation is used).
