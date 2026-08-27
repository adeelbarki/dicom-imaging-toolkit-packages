# Examples

Runnable scripts against the real implementation in `src/`. They import via relative paths
(`../src/...`), same as the tests, since they live inside this repo — anywhere else, import
from `"rtstruct-js"` instead (see the root README).

No runner is bundled in this project's own dependencies; the quickest way to run one is:

```sh
npx tsx examples/01-build-and-inspect-mask.ts
```

`npx tsx` downloads a small TypeScript runner on the fly and doesn't touch this project's
`package.json` or lockfile. If you'd rather not fetch anything on demand, `ts-node --esm`
or compiling with `tsc` first both work too.

- **01-build-and-inspect-mask.ts** — build a grid, generate a sphere phantom, read voxel count/volume.
- **02-dicom-roundtrip.ts** — the core workflow: mask → real DICOM RTSTRUCT bytes → mask.
- **03-compare-masks.ts** — Dice, voxel disagreement, and centroid displacement between two masks.
- **04-diagnostics-and-redaction.ts** — tolerant reading of an empty ROI, and `redact()` before logging.
- **05-series-geometry.ts** — building a `GridGeometry` from real CT/MR slice files instead of hand-building one.
