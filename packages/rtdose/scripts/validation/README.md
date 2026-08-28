# RTDOSE validation harness

Methodology scripts for [`../../VALIDATION.md`](../../VALIDATION.md) — roadmap §9, Phase E
PR 3. They compare `rtdose-js`'s D/V/mean numbers against
[`dicompyler-core`](https://github.com/dicompyler/dicompyler-core) on the same real
RTDOSE + RTSTRUCT pair. Nothing here ships (`files` in `package.json` is `dist/` only) and
nothing here is example code.

## What you need

- A folder with **one RTDOSE**, **one RTSTRUCT**, and the **CT/MR series** the RTSTRUCT was
  drawn on (all `.dcm`, flat in one directory). `rtdose-js` rasterizes the RTSTRUCT onto
  the CT grid; `dicompyler-core` only needs the RTDOSE + RTSTRUCT.
- No DICOM files live in this repo. Put them somewhere gitignored (`scratch/`) or outside
  the tree.
- A repo-root `npm install` **and `npm run build`** — the TS script resolves
  `rt-geometry-js` and `rtstruct-js` from their built `dist/` via the workspace symlinks.
- Python with `pip install dicompyler-core pydicom` (tested against dicompyler-core
  ≥ 0.5.5).

## Run

```sh
# from packages/rtdose/
npx tsx scripts/validation/metrics-rtdose-js.ts   <folder> --method trilinear
npx tsx scripts/validation/metrics-rtdose-js.ts   <folder> --method nearest      # optional, for the method-difference column
python3   scripts/validation/metrics-dicompyler.py <folder>

node scripts/validation/compare.mjs \
  <folder>/dvh-rtdose-js.trilinear.json \
  <folder>/dvh-dicompyler-core.json
```

Each `metrics-*` script writes a JSON report (`volumeCm3`, `meanGy`/`minGy`/`maxGy`,
`dGy` = D2/D50/D95, `vCm3`/`vPct` = V5Gy/V20Gy/V30Gy per ROI). `compare.mjs` joins them by
ROI name (trimmed, case-insensitive), prints a Markdown agreement table with Δ (candidate −
reference) and Δ%, and flags anything outside tolerance — dose ±max(0.5 Gy, 2%), volume
±max(1 cm³, 2%), V% ±2 pp.

## The expected disagreement

`rtdose-js` and `dicompyler-core` resample in **opposite directions**:

| | `rtdose-js` (default) | `dicompyler-core` (`dvhcalc.get_dvh` default) |
|---|---|---|
| grid the histogram runs on | the **structure** grid | the **dose** grid |
| dose interpolation | trilinear | nearest dose plane, no in-plane upsampling |
| boundary voxels | whole-voxel binary | whole-voxel binary |

So on a structure grid finer than the dose grid, `rtdose-js` produces a smoother curve and
the two will differ most on small structures and steep gradients. Run the `--method
nearest` variant too: it removes the interpolation axis of the difference and leaves only
the resampling-direction axis. Read `VALIDATION.md` before filing any flagged row as a bug.
