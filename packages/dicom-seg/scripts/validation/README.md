# SEG validation harness

Methodology scripts for [`../../VALIDATION.md`](../../VALIDATION.md) — roadmap §9, Phase F
PR 4. They check `dicom-seg-js`'s reconstruction of a real SEG against
[`highdicom`](https://github.com/ImagingDataCommons/highdicom)'s. Nothing here ships
(`files` in `package.json` is `dist/` only).

## What you need

- One or more real SEG `.dcm` files. No DICOM lives in this repo — put them in the
  repo-root `scratch/` (gitignored), e.g. `scratch/data-seg/<collection>-<patient>/SEG.dcm`.
  SEG is spatially self-describing, so no companion image series is needed.
- A repo-root `npm install` + `npm run build` (resolves `rt-geometry-js` from `dist/`).
- Python with `pip install highdicom pydicom numpy` (tested highdicom 0.28, pydicom 3.0).

## Run

```sh
# from packages/dicom-seg/
SEG=../../scratch/data-seg/<collection>-<patient>/SEG.dcm

npx tsx scripts/validation/metrics-dicom-seg-js.ts "$SEG"
python3   scripts/validation/metrics-highdicom.py  "$SEG"

node scripts/validation/compare.mjs \
  "${SEG%.dcm}.dicom-seg-js.json" \
  "${SEG%.dcm}.highdicom.json"
```

## How the comparison works

Each side reconstructs the segmentation and emits, **per segment, per plane** (keyed by the
plane's physical position along the grid normal, rounded to 3 dp): an FNV-1a checksum of
the row-major slice bytes (0/1 for BINARY, raw 8-bit for FRACTIONAL) plus the non-zero
voxel count; and per-segment invariants (`nonzeroVoxelCount`, and for FRACTIONAL the raw
value sum and max).

`compare.mjs` joins segments by number and slices by rounded z, then checks every matched
checksum. A **voxel-exact** result means every matched `(segment, z)` slice checksum is
identical and every count delta is zero — the two libraries unpacked and assembled the
same array, independent of internal layout. The two checksums are computed by the same
FNV-1a over the same byte order on both sides, so a match is meaningful.

`highdicom` supplies the authoritative BINARY bit-unpacking (`seg.pixel_array`) and
functional-group parse; the plane grouping (frames → segment + position) is trivial and
identical on both sides by construction.
