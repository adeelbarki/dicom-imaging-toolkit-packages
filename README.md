# dicom-imaging-toolkit-packages

A small family of JavaScript/TypeScript packages for working with the
**radiotherapy and segmentation objects** in DICOM — RT Structure Sets, RT Dose,
and Segmentation — built on one shared, **standard-agnostic geometry core**.

The organising idea: *the geometry is not the DICOM.* A sampling grid, a boolean
mask, and a scalar field are physical objects that exist whether they came from a
CT series, an AI model, a NIfTI volume, or a synthetic phantom. That layer
([`rt-geometry-js`](packages/geometry/)) has **no DICOM, network, or filesystem
dependency**. Each domain package adds one DICOM object on top of it and depends
on the core as a **peer**, so a `Mask3D` built by `rtstruct-js` meets the exact
same `GridGeometry` implementation inside `rtdose-js` — no conversion, no second
copy.

## Packages

| Package | Version | What it is |
|---|---|---|
| [`rt-geometry-js`](packages/geometry/) | 0.1.2 | The shared core. `GridGeometry` / `Mask3D` / `ScalarField3D`, plane sorting, cross-grid resampling, a histogram/DVH engine, analytic phantoms (cube/sphere/torus with closed-form volumes), and comparison metrics (Dice, voxel disagreement, centroid displacement). No DICOM. |
| [`rtstruct-js`](packages/rtstruct/) | 0.3.0 | DICOM **RT Structure Set** (RTSTRUCT) read + write. Contour → mask rasterization that handles all three hole encodings (nested `CLOSED_PLANAR`, `CLOSEDPLANAR_XOR`, self-touching keyhole) identically. Round-trip volume fidelity checked against phantom closed-form volumes. |
| [`rtdose-js`](packages/rtdose/) | 0.1.0 | DICOM **RTDOSE** read + dose-volume histograms. D/V/mean/min/max queries against a structure mask, dose sampled at a physical point, cumulative DVH. Every result carries the resampling / interpolation / partial-volume method used to compute it. **Research and QA tooling — not a treatment planning system.** |
| [`dicom-seg-js`](packages/dicom-seg/) | 0.1.0 | DICOM **Segmentation (SEG)** read + write. `BINARY` masks and `FRACTIONAL` probability/occupancy fields, on the SEG's own grid from the Functional Groups. Exposes honest quantities only (`meanValue`, `volumeAboveThreshold`, `thresholdSensitivity`) — no "accuracy" number anywhere. `LABELMAP` lands in 0.2.0. |
| `rt-convert-js` | — | *Planned.* RTSTRUCT ↔ SEG conversion. The only package allowed to depend on two domain packages; both directions are lossy and record the loss in provenance. |

All four published packages are on npm. `dcmjs` is the only runtime dependency of
each domain package; `rt-geometry-js` has no runtime dependencies at all.

## The dependency rule

```
rt-geometry-js          (no workspace dependencies, no DICOM)
   ▲     ▲     ▲
   │     │     │         each domain package peers on rt-geometry-js
rtstruct rtdose dicom-seg   and never on another domain package
   ▲     ▲
   └──┬──┘
  rt-convert-js          (the one package that may depend on two domain packages)
```

`rt-geometry-js` imports no workspace package. No domain package imports another.
This is enforced in CI by [`scripts/check-dependency-rule.mjs`](scripts/check-dependency-rule.mjs).

Domain packages declare `rt-geometry-js` as a **peer dependency** (with a matching
`devDependency` for local work). That guarantees exactly one installed copy, so
the geometry objects the packages hand each other are identical at the identity
level. From **1.0.0** the core follows strict SemVer;
[`packages/geometry/CONTRACT.md`](packages/geometry/CONTRACT.md) states what the
stability guarantee covers. **Publish order:** the core goes to npm before any
domain package that raised its peer range.

## Validation

Correctness is established two ways, and the distinction is kept explicit:

- **Phantoms** — every geometric operation is checked against cube / sphere /
  torus phantoms with known closed-form volumes. No vendor DICOM is committed to
  this repo (no PHI, no licensing question, and a vendor file carries no ground
  truth anyway).
- **Real DICOM, against a reference implementation** — each domain package has a
  `VALIDATION.md` recording a cross-check on real TCIA data:
  - `rtstruct-js` — [VALIDATION.md](packages/rtstruct/VALIDATION.md): 5 vendors/tools, real keyhole/nested contour distributions and round-trip fidelity.
  - `rtdose-js` — [VALIDATION.md](packages/rtdose/VALIDATION.md): D/V/mean/min/max vs `dicompyler-core` on real RTDOSE + RTSTRUCT + CT triples — 194 / 195 comparisons within tolerance.
  - `dicom-seg-js` — [VALIDATION.md](packages/dicom-seg/VALIDATION.md): reconstruction voxel-exact vs `highdicom` on BINARY and FRACTIONAL SEG files — 728 / 728 per-slice checksums identical.

Reference-implementation agreement is **not** clinical validation. `rtdose-js` in
particular is not for making or checking treatment decisions — see its README.

**Standard pinned (for doc references):** DICOM PS3.3 **2026c**.

## Repository layout

```
packages/
  geometry/     -> rt-geometry-js     the shared core
  rtstruct/     -> rtstruct-js
  rtdose/       -> rtdose-js
  dicom-seg/    -> dicom-seg-js
  convert/      -> rt-convert-js      RTSTRUCT <-> SEG conversion
scripts/
  check-dependency-rule.mjs           package-boundary check, run in CI
  bundle-smoke.mjs                    browser-bundle smoke test, run in CI
scratch/                              real DICOM for validation (gitignored)
```

## Working in the repo

```sh
npm ci                 # install all workspaces
npm run build          # build every package (tsc)
npm test               # dependency-rule check + every package's vitest suite
npm run typecheck
```

Node ≥ 20 (CI covers 20 and 22). Each package builds with `tsconfig.build.json`
so the published output emits bare specifiers; a `paths` alias resolves the core
from source during local dev and tests.

Publishing is per-package (`npm publish --workspace <name>`), core first when its
peer range moved.

## License

[MIT](LICENSE)
