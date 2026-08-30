# rt-convert-js round-trip validation

Methodology for [`../../VALIDATION.md`](../../VALIDATION.md).

There is **no external reference tool for the conversion itself**. The primitives it
composes are validated elsewhere:

- the contour ⇄ mask rasterize/vectorize in `rtstruct-js` (`packages/rtstruct/VALIDATION.md`
  — 5 vendors, 2 498 contours),
- the SEG read/write in `dicom-seg-js` vs `highdicom` (`packages/dicom-seg/VALIDATION.md` —
  728 / 728 voxel-exact).

So what this harness checks is **self-consistency on real TCIA data**: does a conversion
preserve what it claims to, and does the fidelity it reports in `provenance.lossySteps`
match an independent re-measurement.

Nothing here ships (`files` in `package.json` is `dist/` + docs). No DICOM lives in the
repo; put it under the gitignored repo-root `scratch/`.

## What you need

- A repo-root `npm install` **and `npm run build`** (the peers resolve from their `dist/`).
- **rtstruct mode:** a folder with one `RT*`/`RS*` RTSTRUCT and the `CT*`/`MR*` series it
  was drawn on, flat, all `.dcm` — e.g. `scratch/data-real/<case>/`.
- **seg mode:** one SEG `.dcm` — e.g. `scratch/data-seg/<case>/SEG.dcm`. A `FRACTIONAL` SEG
  needs `--threshold N`.

## Run

```sh
# from packages/convert/
npx tsx scripts/validation/roundtrip.ts rtstruct ../../scratch/data-real/LCTSC-Train-S1-006
npx tsx scripts/validation/roundtrip.ts seg      ../../scratch/data-seg/C4KC-KiTS-KiTS-00007/SEG.dcm
npx tsx scripts/validation/roundtrip.ts seg      ../../scratch/data-seg/ISPY1-ISPY1_1004/SEG.dcm --threshold 0.5
```

## What each mode does

**`rtstruct`** — `readSeriesGeometry(series)` → `RTStruct.load` → for every non-empty ROI:
`rtstructToSeg(rt, roi)` → `readSeg(bytes)` → `seg.mask(1)`, compared to `rt.getMask(roi)`.
This direction is a **voxel copy** (`provenance.lossySteps` empty), so the pass condition is
`voxelDisagreement === 0` for every ROI; the script exits non-zero otherwise.

**`seg`** — `readSeg` → for every segment: `segToRtstruct(seg, n[, {threshold}])` →
`RTStruct.load({ geometry: seg.geometry })` → `rt.getMask(roi)`, compared to the mask that
was vectorized. This direction is a **vectorization** — `voxelDisagreement > 0` on curved
boundaries is expected and not a failure. The script prints the `mask-vectorization` step's
`voxelsBefore/After`, `voxelDisagreement`, `dice`, and (for BINARY) an independent
re-measurement that must match the provenance figure.
