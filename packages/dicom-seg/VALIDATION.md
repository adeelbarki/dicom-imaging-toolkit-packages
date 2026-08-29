# Validation against real DICOM files

`dicom-seg-js`'s unit suite (`tests/unit/`) uses SEG files built by its own `writeSeg`, so
`writeSeg` → `readSeg` round trips prove the two halves are consistent with each other.
They prove nothing about reading a SEG written by a *different* tool — a real one, with a
real bit-packed BINARY stream and real functional groups.

This document is that check: `dicom-seg-js` vs
[`highdicom`](https://github.com/ImagingDataCommons/highdicom) on real SEG files from
[TCIA](https://www.cancerimagingarchive.net/). Same pattern as `rtstruct-js`'s keyhole scan
and `rtdose-js`'s DVH table — reconstruct the same object two ways and diff, voxel for
voxel.

No DICOM files are in this repository. Every number here is derived from files downloaded
from TCIA's public API at analysis time; TCIA collections are pre-de-identified.

**Reproduce this**: [`scripts/validation/`](scripts/validation/) —
`metrics-dicom-seg-js.ts`, `metrics-highdicom.py`, `compare.mjs`. See that directory's
README. Not part of the published npm package.

## Method

Each side reconstructs the segmentation and emits, **per segment, per plane** (keyed by the
plane's physical z along the grid normal): an FNV-1a checksum of the row-major slice bytes
(0/1 for BINARY, raw 8-bit for FRACTIONAL) and the non-zero voxel count, plus per-segment
`nonzeroVoxelCount` / raw-value sum / raw-value max. `compare.mjs` joins segments by number,
slices by rounded z, and checks every matched checksum. **Voxel-exact** = every matched
`(segment, z)` checksum identical and every count delta zero.

`highdicom` provides the reference BINARY bit-unpacking (`seg.pixel_array`) and
functional-group parse. The FNV-1a and byte order are identical on both sides, so a
checksum match is a real match.

## Data sources

| Collection | File | Type | Segments | License |
|---|---|---|---|---|
| [C4KC-KiTS](https://doi.org/10.7937/TCIA.2019.IX49E8NX) | `KiTS-00007` | BINARY | Kidney, Mass | CC BY 3.0 |
| [NSCLC-Radiomics](https://doi.org/10.7937/K9/TCIA.2015.PF0M9REI) | `LUNG1-005` | BINARY | Esophagus, GTV, Heart, Lung-L, Lung-R, Spinal cord | CC BY-NC 3.0 |
| [ISPY1](https://doi.org/10.7937/K9/TCIA.2016.HdHpgJLK) | `ISPY1_1004` | FRACTIONAL / OCCUPANCY | PE Tumor | CC BY 3.0 |

Two `BitsAllocated 1` BINARY files (2- and 6-segment, 512×512, 61 and 91 planes) and one
8-bit FRACTIONAL file (256×256, 60 planes). NSCLC-Radiomics is the same collection as the
`rtstruct-js` keyhole scan.

## Agreement table

| File | Type | Slices compared | Checksum-identical | Σ\|count Δ\| | Result |
|---|---|--:|--:|--:|---|
| C4KC-KiTS `KiTS-00007` | BINARY | 122 | 122 | 0 | **voxel-exact** |
| NSCLC-Radiomics `LUNG1-005` | BINARY | 546 | 546 | 0 | **voxel-exact** |
| ISPY1 `ISPY1_1004` | FRACTIONAL | 60 | 60 | 0 | **voxel-exact** (raw sum 22 876 305 = 22 876 305, max 255) |

**728 / 728** matched `(segment, plane)` slices byte-for-byte identical to highdicom.

## Findings

**1. BINARY reconstruction is exact.** dcmjs's `BitArray.unpack` over the continuous
bitstream, plus `dicom-seg-js`'s frame → (segment, plane) assembly, produces the same 0/1
array highdicom does — across a 2-segment and a 6-segment file, 668 slices, no
disagreement. Confirms the continuous-bitstream interpretation (no inter-frame byte
padding) against real Varian/3D-Slicer/nnU-Net-style exports.

**2. FRACTIONAL 8-bit reconstruction is exact.** The raw stored values (`rawField(n)`) and
the non-zero footprint match highdicom exactly, including the per-slice byte order.

**3. A real "OCCUPANCY" SEG that is actually binary.** `ISPY1_1004` declares
`SegmentationFractionalType OCCUPANCY` but every non-zero voxel is exactly 255 — it is a
binary mask stored as FRACTIONAL, not a graded occupancy field. `dicom-seg-js` fires
`FRACTIONAL_VALUES_LOOK_BINARY` for it (§7.1 / `docs/FRACTIONAL-SEG.md` §4). This is the
mislabelled-fractional case the roadmap anticipated, found on the first FRACTIONAL file
sampled.

**4. Geometry matches.** Rows, columns, plane count, pixel spacing and plane z-positions
agree between the two reconstructions on all three files.

### Not yet covered

- No genuinely graded `PROBABILITY` field in the sample (FRACTIONAL SEG is rare in TCIA and
  usually a thresholded export). If one surfaces, add it here.
- No `SegmentsOverlap YES` file in the sample.
- The byte-aligned-per-frame BINARY variant (`BINARY_FRAMES_BYTE_ALIGNED`) has synthetic
  coverage only — not seen in the wild yet.
- LABELMAP is out of scope for 0.1.0 (→ 0.2.0).
