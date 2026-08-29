# dicom-seg-js

DICOM **Segmentation (SEG)** reading for JavaScript/TypeScript, built on
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js). Part of the
[DICOM imaging toolkit](https://github.com/adeelbarki/dicom-imaging-toolkit-packages).

**Status:** 0.1.0 — first release, **read only**. `BINARY` masks and `FRACTIONAL`
probability/occupancy fields. `LABELMAP` (PS3.3 Sup 243) and `writeSeg` land in later
releases. Requires the peer dependency
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js) (`^0.1.2`);
`npm install dicom-seg-js rt-geometry-js`.

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

## What it reads

| Element | Handling |
|---|---|
| `SegmentationType` (0062,0001) | `BINARY` → `mask(n)`; `FRACTIONAL` → `field(n)` / `rawField(n)`. `LABELMAP` → `UnsupportedSegmentationTypeError` (0.2.0) |
| `SegmentSequence` (0062,0002) | number, label, algorithm type/name, coded `SegmentedPropertyCategory` / `Type` / `TypeModifier`, `TrackingID` / `TrackingUID` |
| `SegmentationFractionalType` (0062,0010) | surfaced on `seg.fractionalType`; **never defaulted** — absent is `undefined` + a diagnostic |
| `MaximumFractionalValue` (0062,000E) | used to rescale `field(n)` to 0..1; `rawField(n)` keeps the integers. Absent → assumed 255 + a diagnostic |
| `SegmentsOverlap` (0062,0013) | surfaced on `seg.segmentsOverlap`; `YES` also raises a diagnostic |
| Per-Frame / Shared Functional Groups | plane positions, orientation, pixel spacing → one `GridGeometry` spanning every frame position |
| `PixelData` | BINARY bit-unpacked (continuous bitstream; the byte-aligned-per-frame variant is detected and handled with a diagnostic). FRACTIONAL 8-bit |

The SEG's grid is **not** required to match any source image series. To compare a segment
against a CT or a dose grid, resample it — `resampleMask` / `resampleField` from
`rt-geometry-js` are re-exported here.

Parsing raises `NotSegmentationError` for a non-SEG SOP class,
`UnsupportedSegmentationTypeError` for LABELMAP, and `MalformedSegmentationError` when the
object can't be assembled (missing `SegmentSequence` / shared functional groups, per-frame
count ≠ `NumberOfFrames`, a frame referencing an undeclared segment, short `PixelData`).

## License

[MIT](../../LICENSE)
