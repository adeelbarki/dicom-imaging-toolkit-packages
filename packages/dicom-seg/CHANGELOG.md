# Changelog

## [0.1.0] - 2026-08-29

First release. DICOM Segmentation (SEG) **read and write** — `BINARY` masks and
`FRACTIONAL` probability/occupancy fields — built on `rt-geometry-js` `^0.1.2` (peer
dependency). Part of the `dicom-imaging-toolkit-packages` monorepo (roadmap v2, Phase F,
PRs 2–4).

**Validated voxel-exact against `highdicom`** on real TCIA SEG files (2- and 6-segment
BINARY, one FRACTIONAL): 728 / 728 per-slice checksums identical. See `VALIDATION.md`.

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
- `FRACTIONAL_VALUES_LOOK_BINARY` diagnostic — a FRACTIONAL field with ≥ 98% of its
  non-zero values pinned at `MaximumFractionalValue` is a binary mask stored as FRACTIONAL,
  not a graded field (roadmap §7.1). Fires on a real ISPY1 "OCCUPANCY" file.
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
- `writeSeg({ segmentationType, segments, ... })` — a `Mask3D` per BINARY segment or a
  `ScalarField3D` per FRACTIONAL segment, all on one shared `GridGeometry`:
  - **`fractionalType` is required** for FRACTIONAL — no default (roadmap §7.1); omitting
    it is a `TypeError`.
  - `maximumFractionalValue` (default 255) scales `[0, 1]` field values on write;
    `fieldScale: "raw"` takes `[0, maximumFractionalValue]` integers instead.
  - Every segment must share one grid (`GridMismatchError` otherwise). One frame per
    `(segment, plane)` over the full grid, so `writeSeg` → `readSeg` is an exact round
    trip. `SegmentsOverlap` defaults to `NO` (one segment) / `UNDEFINED` (more).
  - Coded category / type / type-modifier, `TrackingID` / `TrackingUID`, algorithm
    type/name all round-trip.

### Performance

- BINARY continuous-bitstream unpack is memoised per parse (was re-unpacking the whole
  stream once per frame — O(frames²) on a large SEG). A 546-frame / 6-segment file now
  reconstructs in ~2 s.

### Known / deferred

- **Sparse writing** (omitting all-zero frames, as most real files do) — 0.2.0. Reading
  sparse SEGs is fully supported now.
- **LABELMAP** deferred to 0.2.0 (little real-world test data yet).
- Validation covers BINARY (2- and 6-segment) and one FRACTIONAL file; no genuinely graded
  `PROBABILITY` field or `SegmentsOverlap YES` file in the sample yet (`VALIDATION.md`).
- Per-frame `PlaneOrientationSequence` that varies from the shared one is flagged but not
  honoured (the shared orientation is used).
