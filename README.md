# rtstruct-js

DICOM RT Structure Set (RTSTRUCT) reading and writing for JavaScript/TypeScript.
Correctness is checked against analytic phantoms (cube, sphere, torus) with
known closed-form volumes, not against vendor fixtures — there is no vendor
DICOM in this repository (no PHI, no licensing question, and vendor files
carry no ground truth anyway).

**Status:** published — [`rtstruct-js`](https://www.npmjs.com/package/rtstruct-js)
on npm, v0.1, all 44 tests green. `dcmjs` (the only DICOM dependency) pulls in a
high-severity transitive advisory via `adm-zip`, used only by dcmjs features this
library never touches (`dicom/port.ts` uses `DicomDict`/`DicomMessage`/
`DicomMetaDictionary` only) — accepted as a known tradeoff, revisit if dcmjs
ships a fix.

**Standard pinned:** DICOM PS3.3 **2026c**.

## Install

```sh
npm install rtstruct-js
```

```ts
import { RTStructImpl, createUniformGrid, spherePhantom } from "rtstruct-js";
```

## Develop (from a clone of this repo)

```sh
npm install
npm test          # vitest, dependency-rule check runs first (pretest)
npm run typecheck # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run build      # emits dist/ (declaration files included)
```

## Usage

[`examples/`](examples/) has four runnable scripts covering everything below
(they import via relative paths since they live inside this repo; anywhere
else, import from `"rtstruct-js"` as shown here).

### Build a grid and generate a phantom

```ts
import { createUniformGrid, spherePhantom, analyticVolumeMm3 } from "rtstruct-js";

const grid = createUniformGrid({
  rows: 64,
  columns: 64,
  planeCount: 32,
  pixelSpacing: [1, 1], // [row spacing mm, column spacing mm]
  sliceSpacingMm: 1,
});

const mask = spherePhantom(grid, 10); // radius in mm
mask.count();                 // filled voxels
mask.volume();                // { valueMm3, method: "voxel" }
analyticVolumeMm3.sphere(10); // closed-form ground truth, for comparison
```

`Mask3D` is an interface — `count()`, `getSliceBuffer(planeIndex)`, and `get(column, row,
planeIndex)` are the read paths; there's no public constructor, only `createEmptyMask`,
`maskFromDense`, and the phantom generators.

### Round-trip a mask through real DICOM bytes

This is the core workflow, and the only gate the library is validated against —
`mask -> RTSTRUCT -> mask`, never the reverse (rasterizing is lossy, so going the other
direction can never be identity):

```ts
import { RTStructImpl } from "rtstruct-js";

const bytes = await RTStructImpl.createFromMask({ mask, name: "Sphere" });
// bytes is an ArrayBuffer of real DICOM Part10 data — write it to a .dcm file, send it
// over the wire, whatever you'd do with any other DICOM object.

const rt = await RTStructImpl.load({ rtstruct: bytes, geometry: grid });
rt.getROINames();          // ["Sphere"]
rt.getMask("Sphere");      // Mask3D, rasterized back onto `grid`
rt.roi("Sphere");          // { name, roiNumber, interpretedType, provenance, diagnostics }
rt.diagnostics;            // every diagnostic across the whole document
rt.dicomVolume("Sphere");  // undefined unless the file itself declared ROI Volume (3006,002C) — never computed
```

`geometry` is the grid to rasterize the file's contours onto — normally the geometry of
the image series the RTSTRUCT references, which you'd build from that series' own DICOM
metadata (not covered here, since this library takes a `GridGeometry` as input rather
than reading image series itself).

### Compare two masks

```ts
import { dice, voxelDisagreement, centroidDisplacementMm } from "rtstruct-js";

dice(reference, predicted);                        // 0..1, higher is better
voxelDisagreement(reference, predicted);            // absolute count of mismatched voxels
centroidDisplacementMm(reference, predicted);       // mm between the two masks' centroids
```

Large structures should gate on Dice + volume error, but Dice is unstable for tiny
structures (under ~100 voxels) — gate those on absolute voxel disagreement and centroid
displacement instead. `dice`/`voxelDisagreement`/`centroidDisplacementMm` don't enforce
this tiering themselves; that judgment call is left to the caller.

### Diagnostics, provenance, and redaction

Diagnostics (`rt.diagnostics`, `roi.diagnostics`) are problems and ambiguities — tolerant
reading surfaces them instead of silently guessing. Provenance (`roi.provenance`) is
history — how a result was produced (e.g. `holeInterpretation`, whether slice association
fell back to geometric matching). Both carry `redact()`, which strips quasi-identifying
DICOM UIDs — call it before writing either into an application log:

```ts
for (const d of rt.diagnostics) console.log(d.severity, d.code, d.message);
console.log(rt.roi("Sphere").provenance.redact());
```

### Errors

`ResourceLimitError` (oversized grid, checked before allocation), `NonParallelPlanesError`
(v0.1 requires mutually parallel planes), and `XorHomogeneityError` (`CLOSEDPLANAR_XOR`
mixed with other geometric types in one ROI) are all thrown synchronously — no silent
fallback.

## Project structure

```
src/
├── index.ts                public entry point (RTStructImpl + everything re-exported)
├── types.ts                public type surface
├── errors.ts
├── metrics.ts               dice / voxelDisagreement / centroidDisplacement
├── geometry/
│   ├── vec3.ts
│   ├── tolerance.ts
│   ├── grid-geometry.ts    createGridGeometry, createUniformGrid
│   └── plane-sort.ts       sort by normal projection, dedupe, reject non-parallel
├── contour/                 contours <-> mask
├── mask/                    Mask3D implementation
├── diagnostics/
├── phantom/                  cube, sphere, torus + analytic volumes
└── dicom/port.ts             the only dcmjs importer
tests/unit/                   spec tests, organized by area (GEO/MSK/VOL/CTR/RT/IO/SEC)
tests/fixtures.ts             builds DICOM bytes at test time via dicom/port.ts (no vendor files)
```

`geometry/`, `contour/`, `mask/`, `roi/`, `phantom/` must never import from
`dicom/` — enforced by `scripts/check-dependency-rule.mjs`, which runs before
every `npm test`. This keeps a future package split possible and keeps the
geometry/mask/phantom core usable without DICOM at all. `dicom/port.ts` is
never re-exported from the public entry point either — `RTStructImpl` is the
one DICOM I/O surface.

`Mask3D` and `GridGeometry` are exported as **interfaces**, never classes —
the moment a consumer relies on dense `Uint8Array` storage, bit-packing
becomes a breaking change.

## Invariants

1. **ContourData defines the physical geometry of the ROI.** Image
   references and source-pixel-plane information describe association,
   sampling context, and provenance. They must not replace or alter the
   physical coordinates.
2. `equals()` is the authority for operation safety. `fingerprint()` is a
   cache hint; a hit must still be confirmed by `equals()`.
3. Tolerance equality is not transitive, and the library does not claim it
   is.
4. **Do not hide ambiguity.** If a slice was guessed, say so. If nesting
   semantics were applied, say so. If volume came from voxelization, say so.
5. Liberal in what is accepted, conservative in what is emitted — with
   diagnostics as the thing that stops that principle from laundering
   malformed input into confident output.
6. No network access, no filesystem access.
7. Not clinically validated. Not a treatment planning system.

## License

[MIT](LICENSE)
