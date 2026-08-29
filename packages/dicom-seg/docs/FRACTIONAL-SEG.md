# FRACTIONAL segmentations

A FRACTIONAL SEG stores one 8-bit value per voxel per segment. `dicom-seg-js` rescales it
to `[0, 1]` with `MaximumFractionalValue` (`field(n)`) and also gives you the raw integers
(`rawField(n)`). What that number *means* is the subject of this document.

## 1. PROBABILITY and OCCUPANCY are different quantities

`SegmentationFractionalType` (0062,0010) declares one of two meanings:

| | 0.5 means |
|---|---|
| **PROBABILITY** | "there is a 50% chance the segmented property is present at this voxel" |
| **OCCUPANCY** | "the segmented property fills 50% of this voxel's volume" |

They are not interchangeable. A partial-volume boundary voxel that is genuinely half tumour
has OCCUPANCY 0.5 and (if the model is certain) PROBABILITY ≈ 1.0. A voxel the model is
unsure about has PROBABILITY 0.5 and OCCUPANCY that is either 0 or 1 (the tumour is either
there or not — the model just doesn't know which).

`dicom-seg-js` therefore:

- exposes `seg.fractionalType` and **never defaults it** — an absent
  `SegmentationFractionalType` reads back as `undefined` with a `FRACTIONAL_TYPE_ABSENT`
  diagnostic, not as PROBABILITY;
- (planned) emits a diagnostic when the value distribution contradicts the declared type —
  e.g. an OCCUPANCY field that is bimodal at 0 and `MaximumFractionalValue` with almost
  nothing in between, which is a thresholded probability mask mislabelled.

If your pipeline needs one specific meaning, check `seg.fractionalType` and reject the
file when it is `undefined` or wrong. Do not let the library pick for you, because it
can't.

## 2. Confidence is not accuracy

A per-voxel PROBABILITY is the model's **confidence** at that location. It is not the
accuracy of the segmentation:

- **Accuracy needs ground truth**, which does not exist at inference time. Averaging
  confidence over a segment tells you how sure the model was, not how often it was right.
- **Most model outputs are uncalibrated.** A softmax value of 0.9 does not mean 90% of
  voxels with that value are correct; networks are typically overconfident, and the
  mapping from score to empirical frequency is model- and dataset-specific. Calibration
  (temperature scaling, isotonic regression, …) is a separate step that the SEG file does
  not record.

So `dicom-seg-js` exposes honest quantities only, via the re-exported `rt-geometry-js`
functions:

```ts
import { readSeg, meanValue, volumeAboveThreshold, thresholdSensitivity } from "dicom-seg-js";

const seg = readSeg(bytes);
const field = seg.field(1);
const support = seg.support(1);                     // voxels the model marked at all

meanValue(field, support);                          // mean confidence over that region
volumeAboveThreshold(field, support, 0.7);          // mm³ at confidence >= 0.7
thresholdSensitivity(field, support, [0.3, 0.5, 0.7, 0.9]);
//   how much the segmented volume moves as the confidence cut moves — a flat curve
//   means the threshold barely matters, a steep one means it dominates the result
```

There is deliberately **no** `accuracy()`, `percentCorrect()`, `reliability()`, or single
summary "quality" number anywhere in the API.

## 3. Displaying confidence

`seg.sampleConfidence(n, point)` gives an interpolated value for a cursor tooltip (§7.3) —
the same call as `dose.sample()` on a different field.

Presenting that value as "**87% confidence**" implies the model is calibrated, which it
usually is not. Unless you have calibrated the model yourself, prefer relative
presentation: a heatmap, or high/medium/low banding. This is a UI obligation on the
consumer, not something the library can enforce.

## 4. Validation

`dicom-seg-js`'s reconstruction was checked against
[`highdicom`](https://github.com/ImagingDataCommons/highdicom) 0.28 on real SEG files from
TCIA. Full method and the harness are in
[`../VALIDATION.md`](../VALIDATION.md) / [`../scripts/validation/`](../scripts/validation/);
the headline:

| File (TCIA) | Type | Segments | Result |
|---|---|---|---|
| C4KC-KiTS `KiTS-00007` | BINARY | 2 (Kidney, Mass) | **voxel-exact** — 122/122 slice checksums identical |
| NSCLC-Radiomics `LUNG1-005` | BINARY | 6 (Esophagus, GTV, Heart, L/R Lung, Cord) | **voxel-exact** — 546/546 |
| ISPY1 `ISPY1_1004` | FRACTIONAL / OCCUPANCY | 1 (PE Tumor) | **voxel-exact** — 60/60; raw value sum 22 876 305 matched exactly |

728 `(segment, plane)` slices, every one byte-for-byte identical to highdicom's
reconstruction (BINARY bit-unpacking included).

### Fractional types in the wild

Of the TCIA collections that publish DICOM SEG, most are `BINARY`. `FRACTIONAL` appears
mainly in the breast-MRI collections (ISPY1/ISPY2, ACRIN-6698). In the sample checked, the
declared fractional type was **`OCCUPANCY`** — but the `ISPY1_1004` file's non-zero values
are **all exactly 255**: it is a binary mask stored as FRACTIONAL, not a graded occupancy
field. `dicom-seg-js` emits a `FRACTIONAL_VALUES_LOOK_BINARY` diagnostic for exactly this
case (≥ 98% of non-zero values pinned at `MaximumFractionalValue`). No genuinely graded
`PROBABILITY` field turned up in the sample; that is consistent with FRACTIONAL SEG being
rare and usually a thresholded export rather than a raw model head. Treat a FRACTIONAL SEG
as graded only after checking its value distribution (`thresholdSensitivity`, or the
diagnostic).
