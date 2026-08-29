# Validation against real DICOM files

`dicom-seg-js`'s unit suite (`tests/unit/`) uses SEG files built by its own `writeSeg`, so
`writeSeg` → `readSeg` round trips only prove the two halves agree with **each other**.
They prove nothing about reading a SEG written by a *different* tool — a real one, with a
real bit-packed BINARY stream, real Per-Frame Functional Groups, and a real
`Manufacturer` tag.

This document reports what happened when real, de-identified DICOM SEG files from
[The Cancer Imaging Archive (TCIA)](https://www.cancerimagingarchive.net/) were read by
`dicom-seg-js` and compared, voxel for voxel, against
[`highdicom`](https://github.com/ImagingDataCommons/highdicom)'s reconstruction of the same
files. No DICOM files are included in this repository or redistributed anywhere — every
number below is a derived, aggregate figure computed from files downloaded directly from
TCIA's public API at analysis time. TCIA collections are pre-de-identified before
publication.

**Reproduce this**: the scripts that produced every number below live in
[`scripts/validation/`](scripts/validation/) — `metrics-dicom-seg-js.ts`,
`metrics-highdicom.py`, `compare.mjs` — and are runnable against any local `.dcm` SEG file
(see that directory's README for usage, including the `pip install highdicom` note;
`pydicom-seg` turned out to be unusable, it needs `pydicom < 2.4`). They are not part of
the published npm package (only `dist/` ships).

## Data sources

| Collection | File(s) | Authoring tool (per file's `Manufacturer` / `SegmentAlgorithmType`) | License | Citation |
|---|---|---|---|---|
| C4KC-KiTS | 1 (`KiTS-00007`, 2 segments) | QIICR `dcmqi` converter; `SEMIAUTOMATIC` | CC BY 3.0 | https://doi.org/10.7937/TCIA.2019.IX49E8NX |
| NSCLC-Radiomics | 1 (`LUNG1-005`, 6 segments) | QIICR `dcmqi` converter; `MANUAL` + `SEMIAUTOMATIC` (region-growing) | CC BY-NC 3.0 | https://doi.org/10.7937/K9/TCIA.2015.PF0M9REI |
| ISPY1 | 1 (`ISPY1_1004`, 1 segment) | GE workstation; `SEMIAUTOMATIC` (PE threshold + connectivity), `SeriesDescription` "PE Segmentation thresh=90" | CC BY 3.0 | https://doi.org/10.7937/K9/TCIA.2016.HdHpgJLK |

3 files, 9 segments, 3 distinct authoring pipelines, **728 individual `(segment, plane)`
slices** compared. Two `BitsAllocated 1` BINARY files (2- and 6-segment, 512×512, 61 and
91 planes) and one 8-bit `FRACTIONAL` file (256×256, 60 planes). One collection is CC BY-NC
(NonCommercial) — only aggregate, derived statistics from it appear here; no data is
redistributed. NSCLC-Radiomics is the same collection as the `rtstruct-js` keyhole scan.

## Method

Each side reconstructs the segmentation and emits, **per segment, per plane** (keyed by the
plane's physical position along the grid normal, rounded to 3 dp): an FNV-1a checksum of
the row-major slice bytes (0/1 for BINARY, raw 8-bit for FRACTIONAL), the non-zero voxel
count, and per-segment `nonzeroVoxelCount` / raw-value sum / raw-value max.
`compare.mjs` joins segments by number, slices by rounded z, and checks every matched
checksum. **Voxel-exact** = every matched `(segment, z)` checksum identical and every count
delta zero — the two libraries unpacked and assembled the same array.

`highdicom` supplies the reference BINARY bit-unpacking (`seg.pixel_array`) and
functional-group parse; the FNV-1a and byte order are identical on both sides, so a
checksum match is a real match, not a coincidence of two loose reconstructions.

## Finding 1: BINARY reconstruction is voxel-exact

| File | Segments | Slices compared | Checksum-identical | Σ\|count Δ\| |
|---|---|--:|--:|--:|
| C4KC-KiTS `KiTS-00007` | Kidney, Mass | 122 | 122 | 0 |
| NSCLC-Radiomics `LUNG1-005` | Esophagus, GTV, Heart, Lung-L, Lung-R, Spinal cord | 546 | 546 | 0 |

668 slices, no disagreement. dcmjs's `BitArray.unpack` over the continuous bitstream, plus
`dicom-seg-js`'s frame → `(segment, plane)` assembly, produces the same 0/1 array highdicom
does — across a 2-segment and a 6-segment file. Confirms the continuous-bitstream
interpretation (no inter-frame byte padding) against real `dcmqi`-generated exports.

## Finding 2: FRACTIONAL 8-bit reconstruction is voxel-exact

| File | Segment | Slices | Checksum-identical | raw value sum | raw value max |
|---|---|--:|--:|--:|--:|
| ISPY1 `ISPY1_1004` | PE Tumor | 60 | 60 | 22 876 305 (= ref) | 255 (= ref) |

`rawField(n)` and the non-zero footprint match highdicom exactly, per-slice byte order
included.

## Finding 3: a real "OCCUPANCY" SEG that is actually a binary mask

`ISPY1_1004` declares `SegmentationFractionalType OCCUPANCY`, but every one of its 89 711
non-zero voxels is **exactly 255** (`22 876 305 / 89 711 = 255.0`). Its `SeriesDescription`
is "PE Segmentation thresh=90" — it is a thresholded percent-enhancement mask stored in a
FRACTIONAL container, not a graded occupancy field. `dicom-seg-js` fires
`FRACTIONAL_VALUES_LOOK_BINARY` for it (≥ 98% of non-zero values at
`MaximumFractionalValue`). This is the mislabelled-fractional case the roadmap
(`docs/FRACTIONAL-SEG.md` §1, roadmap §7.1) anticipated — found on the first FRACTIONAL
file sampled.

## Finding 4: fractional types in the wild

Of TCIA's ~34 collections that publish DICOM SEG, the large majority are `BINARY`.
`FRACTIONAL` shows up mainly in the breast-MRI collections (ISPY1/ISPY2, ACRIN-6698). In
the sample checked the one FRACTIONAL file was `OCCUPANCY` — and, per Finding 3, actually
binary. No genuinely graded `PROBABILITY` field (a raw model head) turned up, consistent
with FRACTIONAL SEG being rare and usually a thresholded export. **Treat a FRACTIONAL SEG
as graded only after checking its value distribution** (`thresholdSensitivity`, or the
`FRACTIONAL_VALUES_LOOK_BINARY` diagnostic).

## Finding 5: geometry matches

Rows, columns, plane count, pixel spacing, and every plane z-position agree between the two
reconstructions on all three files. `dicom-seg-js`'s `GridGeometry` — built from the
distinct Per-Frame `ImagePositionPatient` values, deduped and sorted along the normal — is
the grid highdicom reconstructs onto.

## What this does not prove

- **LABELMAP** — out of scope for 0.1.0 (→ 0.2.0); not exercised.
- **Graded PROBABILITY / OCCUPANCY** — no genuinely graded FRACTIONAL file in the sample.
  `rawField` / `field` rescaling is covered by the round-trip unit tests, not by real data.
- **`SegmentsOverlap YES`** — not present in the sampled files.
- **The byte-aligned-per-frame BINARY variant** (`BINARY_FRAMES_BYTE_ALIGNED`) — synthetic
  coverage only; not seen in the wild yet.
- **Writing** — `writeSeg` output was not round-tripped through highdicom here; that is a
  candidate for a follow-up.
