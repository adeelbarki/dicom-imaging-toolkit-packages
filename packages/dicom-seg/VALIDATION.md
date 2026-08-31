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
`pydicom-seg` as a reference *reader* was unusable — it needs `pydicom < 2.4` — though a
`pydicom-seg`-*written* file is one of the inputs below). Not part of the published npm
package (only `dist/` ships). The newer files were pulled with
[`scripts/nbia-download.mjs`](../../scripts/nbia-download.mjs) (guest token, no TCIA
account).

## Data sources

| Collection | File(s) | Authoring tool (per file's `Manufacturer` / `SegmentAlgorithmType`) | License | Citation |
|---|---|---|---|---|
| C4KC-KiTS | 1 (`KiTS-00007`, 2 segments) | QIICR `dcmqi` converter; `SEMIAUTOMATIC` | CC BY 3.0 | https://doi.org/10.7937/TCIA.2019.IX49E8NX |
| NSCLC-Radiomics | 1 (`LUNG1-005`, 6 segments) | QIICR `dcmqi` converter; `MANUAL` + `SEMIAUTOMATIC` (region-growing) | CC BY-NC 3.0 | https://doi.org/10.7937/K9/TCIA.2015.PF0M9REI |
| ISPY1 | 1 (`ISPY1_1004`, 1 segment) | GE workstation; `SEMIAUTOMATIC` (PE threshold + connectivity), `SeriesDescription` "PE Segmentation thresh=90" | CC BY 3.0 | https://doi.org/10.7937/K9/TCIA.2016.HdHpgJLK |
| EAY131 | 1 (`EAY131-7617225`, 1 segment, PET/CT) | **`highdicom`** (`Manufacturer` = `highdicom`); BINARY, explicit `SegmentsOverlap NO` | (per-series) | https://doi.org/10.7937/q9rn-m510 |
| CT4Harmonization-Multicentric | 1 (`liver`, **6 segments**) | **`pydicom-seg`** (`Manufacturer` = `pydicom-seg`); BINARY liver-lesion partition, `SegmentsOverlap NO` | CC BY 4.0 | https://doi.org/10.7937/M0PB-BH69 |
| ACRIN-6698 | 2 (`373346` VOLSER 72-plane, `782716` DWI 4-plane) | GE workstation; **`FRACTIONAL` / `OCCUPANCY`** — `373346` genuinely graded (7 distinct raw values 1–49, 4.7 M voxels), `782716` all-`1` | CC BY 4.0 | https://doi.org/10.7937/tcia.kk02-6d95 |

7 files, 18 segments, **4 distinct SEG writer libraries** (QIICR `dcmqi`, GE workstation,
`highdicom`, `pydicom-seg`), **983 `(segment, plane)` slices** compared. BINARY:
`BitsAllocated 1` continuous bitstream (dcmqi 2- and 6-segment; `highdicom` 1-segment) and
byte-aligned (`pydicom-seg` 6-segment). FRACTIONAL: 8-bit, `OCCUPANCY` — one genuinely
graded field (ACRIN-6698 VOLSER) and three effectively-binary (ISPY1 at 255, ACRIN-6698 DWI
at 1). Two collections are CC BY-NC / CC BY 3.0 NonCommercial — only aggregate derived
statistics appear here, no data redistributed. NSCLC-Radiomics is the same collection as
the `rtstruct-js` keyhole scan; the newer files were pulled with `scripts/nbia-download.mjs`
(guest token, no account).

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

| File | Writer | Segments | Slices | Checksum-identical | Σ\|count Δ\| |
|---|---|---|--:|--:|--:|
| C4KC-KiTS `KiTS-00007` | dcmqi | Kidney, Mass | 122 | 122 | 0 |
| NSCLC-Radiomics `LUNG1-005` | dcmqi | Esophagus, GTV, Heart, Lung-L, Lung-R, Spinal cord | 546 | 546 | 0 |
| EAY131 `7617225` | `highdicom` | PANCREAS-1 | 49 | 49 | 0 |
| CT4Harmonization `liver` | `pydicom-seg` | normal×2, cyst×2, hemangioma, metastasis | 130 | 130 | 0 |

847 slices, no disagreement, across **four writer libraries**. `dicom-seg-js`'s
continuous-bitstream unpack + frame → `(segment, plane)` assembly produces the same 0/1
array `highdicom` does for dcmqi (2- and 6-segment), `highdicom` (1-segment), and
`pydicom-seg` (6-segment) exports alike — all four write a continuous `BitsAllocated 1`
stream, none triggered `BINARY_FRAMES_BYTE_ALIGNED`. The `pydicom-seg` liver file also
confirms a 6-way BINARY partition reads back with the right per-segment identities and
coded types.

## Finding 2: FRACTIONAL 8-bit reconstruction is voxel-exact — including a genuinely graded field

| File | Segment | Slices | Checksum-identical | distinct raw values | raw max |
|---|---|--:|--:|--:|--:|
| ISPY1 `ISPY1_1004` | PE Tumor | 60 | 60 | 1 (all 255) | 255 |
| ACRIN-6698 `373346` | VOLSER Analysis Mask | 72 | 72 | **7 (1–49)** | 49 |
| ACRIN-6698 `782716` | DWI Tumor Mask | 4 | 4 | 1 (all 1) | 1 |

`rawField(n)` and the non-zero footprint match `highdicom` exactly on all three, per-slice
byte order included. **ACRIN-6698 `373346` is the graded case the earlier sample lacked** —
a 4.7 M-voxel VOLSER occupancy map with intermediate values (1, 2, 17, 32, 33, 34, 49), not
a threshold. `field(n)` rescales it by `MaximumFractionalValue` (255) to `[0, 1]`; the raw
integers round-trip exactly.

## Finding 3: a real "OCCUPANCY" SEG that is actually a binary mask

`ISPY1_1004` declares `SegmentationFractionalType OCCUPANCY`, but every one of its 89 711
non-zero voxels is **exactly 255** (`22 876 305 / 89 711 = 255.0`). Its `SeriesDescription`
is "PE Segmentation thresh=90" — it is a thresholded percent-enhancement mask stored in a
FRACTIONAL container, not a graded occupancy field. `dicom-seg-js` fires
`FRACTIONAL_VALUES_LOOK_BINARY` for it (≥ 98% of non-zero values at
`MaximumFractionalValue`). This is the mislabelled-fractional case the roadmap
(`docs/FRACTIONAL-SEG.md` §1, roadmap §7.1) anticipated.

**ACRIN-6698 `782716` (DWI Tumor Mask) is also effectively binary** — every non-zero voxel
is `1` — but `FRACTIONAL_VALUES_LOOK_BINARY` does **not** fire, because the heuristic keys
on clustering at `MaximumFractionalValue` (255), and this file clusters at the *minimum*
(1/255). A binary mask stored as FRACTIONAL can sit at either end. Broadening the heuristic
to "one distinct non-zero value" is a noted follow-up (see below); the reconstruction
itself is voxel-exact regardless.

## Finding 4: fractional types in the wild

Of TCIA's ~34 collections that publish DICOM SEG, the large majority are `BINARY`.
`FRACTIONAL` shows up mainly in the breast-MRI collections (ISPY1/ISPY2, ACRIN-6698), and
every FRACTIONAL file seen is `OCCUPANCY` — none `PROBABILITY`. Of the three FRACTIONAL
files now checked, **one is genuinely graded** (ACRIN-6698 VOLSER, 7 distinct values) and
two are binary masks in a FRACTIONAL container (ISPY1 at max, ACRIN-6698 DWI at min). A
raw, un-thresholded `PROBABILITY` model head still hasn't turned up on TCIA — consistent
with those living in research repos, not clinical archives. **Treat a FRACTIONAL SEG as
graded only after checking its value distribution** (`thresholdSensitivity`, or the
`FRACTIONAL_VALUES_LOOK_BINARY` diagnostic — with the min-clustering caveat in Finding 3).

## Finding 5: geometry matches

Rows, columns, plane count, pixel spacing, and every plane z-position agree between the two
reconstructions on all 7 files (grids from 256×256×4 to 512×512×91). `dicom-seg-js`'s
`GridGeometry` — built from the distinct Per-Frame `ImagePositionPatient` values, deduped
and sorted along the normal — is the grid `highdicom` reconstructs onto.

## What this does and does not prove

Covered now: 4 writer libraries (QIICR `dcmqi`, GE workstation, `highdicom`, `pydicom-seg`),
BINARY 1- to 6-segment, one genuinely graded FRACTIONAL/OCCUPANCY field, geometry on grids
from 4 to 91 planes. Not covered:

- **Graded `PROBABILITY`** — a raw model-head SEG (as opposed to graded `OCCUPANCY`, now
  covered). None on TCIA; `field` rescaling for PROBABILITY is round-trip-unit-tested only.
- **`SegmentsOverlap YES`** — the sampled files are all `NO` / `UNDEFINED`.
- **LABELMAP against a third-party writer** — 0.2.0 `readSeg` handles it, but no non-`writeSeg`
  LABELMAP file has been checked (they are scarce on TCIA).
- **The byte-aligned-per-frame BINARY variant** (`BINARY_FRAMES_BYTE_ALIGNED`) — all real
  files sampled use the continuous bitstream; synthetic coverage only.
- **Old 3D Slicer / QIN-challenge SEG** (`1.2.276.0.7230010…` UIDs, ~2014) — one such file
  (`LIDC-IDRI-0314`, "QIN CT challenge alg01") omits the per-frame
  `SegmentIdentificationSequence`; `dicom-seg-js` rejects it with `MalformedSegmentationError`
  and **`highdicom` 0.28 also fails** (an internal duplicate-SOP-UID error). Treated as a
  malformed file, not a reader gap; a lenient single-segment fallback is a possible
  follow-up.
- **Writing** — `writeSeg` output was not round-tripped through `highdicom` here.

### Follow-ups noted

- Broaden `FRACTIONAL_VALUES_LOOK_BINARY` to also fire when a FRACTIONAL field has a single
  distinct non-zero value at the low end (ACRIN-6698 DWI: all `1`), not only near
  `MaximumFractionalValue`.
- Consider a single-segment fallback when a non-LABELMAP frame omits
  `SegmentIdentificationSequence` (old Slicer/QIN files), behind a `warning` diagnostic.
