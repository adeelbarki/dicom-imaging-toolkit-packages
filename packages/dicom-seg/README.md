# dicom-seg-js

DICOM **Segmentation (SEG)** reading and writing for JavaScript/TypeScript, built on
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js). Part of the
[DICOM imaging toolkit](https://github.com/adeelbarki/dicom-imaging-toolkit-packages).

**Status:** published — [`dicom-seg-js`](https://www.npmjs.com/package/dicom-seg-js) 0.2.0 on npm. Reads **and writes** `BINARY` masks, `FRACTIONAL`
probability/occupancy fields, and **`LABELMAP`** (PS3.3 Sup 243) — one label per pixel,
`seg.mask(n)` returns the voxels whose label is `n`. `writeSeg` also takes
`frameCoverage: "sparse"` to omit all-background frames. Requires the peer
dependency [`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js) (`^1.0.0`);
`npm install dicom-seg-js rt-geometry-js`.

**Validated against real DICOM files**, not just its own fixtures — `dicom-seg-js`'s
reconstruction is **voxel-exact vs `highdicom`** on real TCIA SEG files (C4KC-KiTS 2-segment
BINARY, NSCLC-Radiomics 6-segment BINARY, ISPY1 FRACTIONAL): 728 / 728 per-slice checksums
identical. See
[VALIDATION.md](https://github.com/adeelbarki/dicom-imaging-toolkit-packages/blob/main/packages/dicom-seg/VALIDATION.md)
(this link works from both GitHub and the npm page).

**Standard pinned (for doc references):** DICOM PS3.3 **2026c**.

> **FRACTIONAL values are per-voxel model *confidence*, not accuracy.** Averaging them does
> not give you an accuracy figure, and most model outputs are uncalibrated (a softmax 0.9
> is not "90% of such voxels are correct"). This library exposes honest quantities only —
> `meanValue`, `volumeAboveThreshold`, `thresholdSensitivity` (from `rt-geometry-js`) — and
> no "accuracy" or "% correct" number anywhere. See
> [`docs/FRACTIONAL-SEG.md`](docs/FRACTIONAL-SEG.md).

## Install

```sh
npm install dicom-seg-js rt-geometry-js
```

## Use

```ts
import { readSeg, meanValue, volumeAboveThreshold } from "dicom-seg-js";

const seg = readSeg(segBytes);          // ArrayBuffer -> parsed Segmentation
seg.type;                                // "BINARY" | "FRACTIONAL"
seg.segments();                          // [{ number, label, category, propertyType, algorithmType, ... }]
seg.geometry;                            // the SEG's own GridGeometry (from the Functional Groups)
seg.segmentsOverlap;                     // "YES" | "NO" | "UNDEFINED"
seg.diagnostics;                         // non-fatal issues found while parsing

// BINARY:
const mask = seg.mask(1);               // Mask3D on seg.geometry

// FRACTIONAL:
seg.fractionalType;                     // "PROBABILITY" | "OCCUPANCY" | undefined (never assumed)
const field = seg.field(1);            // ScalarField3D, rescaled to 0..1 by MaximumFractionalValue
const raw = seg.rawField(1);           // the stored integers, unscaled
const support = seg.support(1);        // Mask3D of voxels with non-zero confidence

meanValue(field, support);             // mean confidence over the marked region
volumeAboveThreshold(field, support, 0.7);   // mm³ the model is >= 70% confident about
seg.sampleConfidence(1, [x, y, z]);   // interpolated confidence at a physical point (§7.3)
```

`mask()` on a FRACTIONAL SEG and `field()` on a BINARY one both throw
`SegmentationTypeMismatchError` — there is no safe default threshold to turn a probability
field into a mask, so the caller must pick one.

## Write

```ts
import { writeSeg } from "dicom-seg-js";

// BINARY — one Mask3D per segment, all on one GridGeometry
const bytes = writeSeg({
  segmentationType: "BINARY",
  segments: [
    { number: 1, label: "Liver", mask: liverMask,
      category: { value: "T-D0050", scheme: "SRT", meaning: "Tissue" },
      propertyType: { value: "T-62000", scheme: "SRT", meaning: "Liver" } },
    { number: 2, label: "Tumor", mask: tumorMask },
  ],
});

// FRACTIONAL — fractionalType is REQUIRED, there is no default (see FRACTIONAL-SEG.md §1)
const probBytes = writeSeg({
  segmentationType: "FRACTIONAL",
  fractionalType: "PROBABILITY",
  maximumFractionalValue: 255,        // optional, default 255
  segments: [{ number: 1, label: "Tumor", field: probField }],  // values in 0..1
});
```

`writeSeg` derives the SEG grid from the first segment's mask/field; every other segment
must be on the same grid (`GridMismatchError` otherwise). By default (`frameCoverage:
"full"`) one frame is written per `(segment, plane)` across the whole grid, so `writeSeg` →
`readSeg` is an exact round trip. `frameCoverage: "sparse"` omits a frame whose slice is
all-background — smaller output, matching how real files are stored, but the reader can
only reconstruct the grid across planes that have a frame (empty-plane extent is not
preserved). Pass `fieldScale: "raw"` when your `field` values are already integers in
`[0, maximumFractionalValue]` rather than `[0, 1]`.

**LABELMAP** (`segmentationType: "LABELMAP"`) writes one integer-per-pixel frame per plane,
each pixel a `SegmentNumber` (`0` = background); 8-bit unless a segment number exceeds 255,
then 16-bit. It is a **partition** — overlapping input masks raise `LabelmapOverlapError`.
LABELMAP is multi-*segment*, a different axis from FRACTIONAL's multi-*confidence*; there
is no `seg.field()` for it.

## What it reads

| Element | Handling |
|---|---|
| `SegmentationType` (0062,0001) | `BINARY` → `mask(n)`; `FRACTIONAL` → `field(n)` / `rawField(n)`; `LABELMAP` → `mask(n)` (voxels whose label is `n`). An unknown value → `UnsupportedSegmentationTypeError` |
| `SegmentSequence` (0062,0002) | number, label, algorithm type/name, coded `SegmentedPropertyCategory` / `Type` / `TypeModifier`, `TrackingID` / `TrackingUID` |
| `SegmentationFractionalType` (0062,0010) | surfaced on `seg.fractionalType`; **never defaulted** — absent is `undefined` + a diagnostic. A field whose non-zero values are ≥ 98% at the max raises `FRACTIONAL_VALUES_LOOK_BINARY` (a binary mask stored as FRACTIONAL) |
| `MaximumFractionalValue` (0062,000E) | used to rescale `field(n)` to 0..1; `rawField(n)` keeps the integers. Absent → assumed 255 + a diagnostic |
| `SegmentsOverlap` (0062,0013) | surfaced on `seg.segmentsOverlap`; `YES` also raises a diagnostic |
| Per-Frame / Shared Functional Groups | plane positions, orientation, pixel spacing → one `GridGeometry` spanning every frame position |
| `PixelData` | BINARY bit-unpacked (continuous bitstream; the byte-aligned-per-frame variant is detected and handled with a diagnostic). FRACTIONAL 8-bit. LABELMAP 8- or 16-bit little-endian integers |

The SEG's grid is **not** required to match any source image series. To compare a segment
against a CT or a dose grid, resample it — `resampleMask` / `resampleField` from
`rt-geometry-js` are re-exported here.

Parsing raises `NotSegmentationError` for a non-SEG SOP class,
`UnsupportedSegmentationTypeError` for an unknown `SegmentationType`, and
`MalformedSegmentationError` when the object can't be assembled (missing `SegmentSequence`
/ shared functional groups, per-frame count ≠ `NumberOfFrames`, a frame referencing an
undeclared segment, short `PixelData`, LABELMAP `BitsAllocated` not 8/16).

## License

[MIT](../../LICENSE)
