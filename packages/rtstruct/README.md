# rtstruct-js

DICOM RT Structure Set (RTSTRUCT) reading and writing for JavaScript/TypeScript.
Correctness is checked against analytic phantoms (cube, sphere, torus) with
known closed-form volumes, not against vendor fixtures — there is no vendor
DICOM in this repository (no PHI, no licensing question, and vendor files
carry no ground truth anyway).

**Handles all three hole encodings the same way.** Nested `CLOSED_PLANAR`
contours, `CLOSEDPLANAR_XOR`, and a single self-touching keyhole contour all
rasterize to an identical mask — asserted voxel-for-voxel
(`voxelDisagreement() === 0`) in [`tests/unit/holes.test.ts`](tests/unit/holes.test.ts).
Round-trip volume fidelity is verified separately, against a torus phantom's
closed-form volume.

**Status:** published — [`rtstruct-js`](https://www.npmjs.com/package/rtstruct-js)
on npm, v0.3.0. Requires the peer dependency
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js) (`^0.1.0`);
`npm install rtstruct-js rt-geometry-js`. 144 tests green across both packages.

**Validated against real DICOM files**, not just phantoms — 5 vendors/tools, real
keyhole/nested contour distributions, real round-trip fidelity. See
[VALIDATION.md](https://github.com/adeelbarki/dicom-imaging-toolkit-packages/blob/main/packages/rtstruct/VALIDATION.md) for
the full findings (this link works from both GitHub and the npm page).

**Standard pinned:** DICOM PS3.3 **2026c**.

## Limitations

What this library does *not* do yet — read this before adopting:

- **You must supply the `GridGeometry` yourself.** The library never reads an
  image series implicitly. Build one with `createUniformGrid`/
  `createGridGeometry`, or `readSeriesGeometry` if you have real CT/MR slice
  files (see below) — there is no automatic "find the referenced series" path.
- `mask.volume({ method: "contour" })` is not implemented — voxel counting
  (`method: "voxel"`, the default) is the only supported method.
- No boolean mask operations (union/intersection/subtraction), no margin
  expansion, no single-mask centroid or bounding-box utility.
  `centroidDisplacementMm` compares *two* masks; it isn't a general centroid.
- Grid planes must be mutually parallel — `NonParallelPlanesError` otherwise.
  Gantry-tilted or otherwise non-parallel series aren't representable.
- Contour-to-slice association is always geometric (nearest-plane matching).
  `ContourImageSequence`'s SOP-instance references aren't read, so
  `Provenance.sliceAssociation` is always `"geometric-fallback"`, never
  `"sop-reference"`, even when the file declares an authoritative reference.

## Install

`rt-geometry-js` is a **peer dependency** (the shared geometry core), so install both:

```sh
npm install rtstruct-js rt-geometry-js
```

```ts
// geometry types/functions are re-exported from rtstruct-js — a single import still works
import { RTStruct, createUniformGrid, spherePhantom } from "rtstruct-js";
```

The peer dependency is declared rather than bundled so that `rtstruct-js`, and later
`rtdose-js` / `dicom-seg-js`, all share one `GridGeometry` / `Mask3D` implementation
instead of npm quietly installing two copies that disagree.

`RTStructImpl` is still exported as a deprecated alias of `RTStruct` (same class,
identical behavior) for anyone who adopted the name from v0.1 — it will be removed
in a future major version, so new code should use `RTStruct`.

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
import { RTStruct } from "rtstruct-js";

const bytes = await RTStruct.createFromMask({ mask, name: "Sphere" });
// bytes is an ArrayBuffer of real DICOM Part10 data — write it to a .dcm file, send it
// over the wire, whatever you'd do with any other DICOM object.

const rt = await RTStruct.load({ rtstruct: bytes, geometry: grid });
rt.getROINames();          // ["Sphere"] — may contain duplicates, ROIName is a label, not an ID
rt.getROINumbers();        // [1] — one entry per ROI, always unique
rt.getMask("Sphere");      // Mask3D, rasterized back onto `grid` — or rt.getMask(1) by ROINumber
rt.roi("Sphere");          // { name, roiNumber, interpretedType, provenance, diagnostics }
rt.diagnostics;            // every diagnostic across the whole document
rt.dicomVolume("Sphere");  // undefined unless the file itself declared ROI Volume (3006,002C) — never computed
```

`geometry` is the grid to rasterize the file's contours onto — normally the geometry of
the image series the RTSTRUCT references.

ROI identity is `ROINumber`, not `ROIName` — DICOM permits multiple ROIs with the same
name. `roi()`/`getMask()`/`getMaskSlice()`/`dicomVolume()` accept either: a `ROINumber` is
always unambiguous, but a name throws `AmbiguousRoiNameError` if more than one ROI shares
it. Use `rt.findROIsByName("Sphere")` to get every match instead of picking one.

### Build a grid from real CT/MR slice files

```ts
import { readSeriesGeometry } from "rtstruct-js";

// One ArrayBuffer per DICOM slice file (e.g. read via fs.readFileSync), any order —
// createGridGeometry sorts by physical position regardless of input order.
const { geometry, diagnostics } = readSeriesGeometry(sliceBytes);

geometry.grid;                 // GridGeometry — use it exactly like createUniformGrid()'s result
geometry.slices;                // DicomSliceReference[] — sopInstanceUID/imagePositionPatient per slice
geometry.frameOfReferenceUID;
diagnostics;                    // e.g. SLICE_ORDER_REVERSED if the input wasn't already sorted
```

Reads `SOPInstanceUID`, `ImagePositionPatient`, `ImageOrientationPatient`, `PixelSpacing`,
`Rows`, and `Columns` per instance. `Rows`/`Columns`/`PixelSpacing`/orientation must agree
across every instance — the grid model has exactly one value for each, not per-plane — a
mismatch throws `InconsistentSeriesError`; plane *position* can vary freely and doesn't
need to already be sorted.

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

All are thrown synchronously — no silent fallback.

Geometry construction (`createGridGeometry` / `createUniformGrid`): `RangeError` for
non-finite or non-positive `rows`/`columns`/`pixelSpacing`/`planeCount`/`sliceSpacingMm`,
or an empty `planePositions` array. `NonOrthogonalBasisError` if `rowDirection` and
`columnDirection` aren't orthogonal (within tolerance) — `patientToPixel()`'s inverse of
`indexToPatient()` only holds when they are. `NonParallelPlanesError` — v0.1 requires
mutually parallel planes.

Mask/phantom allocation: `ResourceLimitError` (oversized grid or mask, checked *before*
allocation) — the same check guards `Mask3D`, `vectorize()`, and `cubePhantom`/
`spherePhantom`/`torusPhantom`. `RangeError` for out-of-range `Mask3D.get()`/
`getSliceBuffer()` indices, or non-positive/non-finite phantom dimensions (e.g.
`spherePhantom(grid, -10)`); `torusPhantom` additionally requires `majorRadiusMm >
minorRadiusMm`. `IndeterminateVolumeError` — a single-plane grid has no derivable slice
thickness, so `mask.volume()` throws rather than returning 0.

Contours: `MalformedContourError` — a contour with fewer points than its geometric type
can represent, or `ContourData` whose length isn't a multiple of 3 (never silently
truncated). `XorHomogeneityError` (`CLOSEDPLANAR_XOR` mixed with other geometric types in
one ROI). `UnclosedContourError` — an internal `vectorize()` invariant failure (a boundary
trace that never closes), not something malformed input can trigger.

Series/frame of reference: `InconsistentSeriesError` (`readSeriesGeometry`'s instances
disagree on rows/columns/pixel spacing/orientation). `FrameOfReferenceMismatchError` — an
ROI's declared Frame of Reference doesn't match the geometry passed to `RTStruct.load`
under `strictness: "strict"` (see below), or `centroidDisplacementMm()` comparing masks
in different frames.

ROI identity: `AmbiguousRoiNameError` — `rt.roi(name)` / `rt.getMask(name)` throw if more
than one ROI shares that name (DICOM permits duplicate `ROIName` across distinct
`ROINumber`s); pass the `ROINumber` instead, or use `rt.findROIsByName(name)` to get every
match.

Metrics: `GridMismatchError` — `dice()`/`voxelDisagreement()` require both masks on an
equivalent `GridGeometry` (matching dimensions, spacing, orientation, plane positions, and
frame of reference); same array dimensions is not sufficient, since two grids can have
identical `rows`/`columns`/plane count and still represent different physical spacing.
`IndeterminateCentroidError` — an empty mask has no centroid; `centroidDisplacementMm()`
never fabricates `[0,0,0]`.

`LoadOptions.strictness` (`"warn"` by default, or `"strict"` / `"silent"`) controls what
happens when an ROI's `ReferencedFrameOfReferenceUID` disagrees with `geometry`'s own
`frameOfReferenceUID`: `"warn"` surfaces a `FRAME_OF_REFERENCE_MISMATCH` diagnostic and
loads anyway, `"strict"` throws `FrameOfReferenceMismatchError`, `"silent"` does neither.
If either side never declared a Frame of Reference, there's nothing to contradict, so no
diagnostic fires regardless of strictness. `GridGeometry.equals()` applies the same
logic: two grids with different, both-declared `frameOfReferenceUID`s are never equal,
no matter how loose the tolerance.

## Project structure

The geometry core lives in a sibling package, **`rt-geometry-js`** (`../geometry`),
declared here as a peer dependency. Everything it exports (`GridGeometry`, `Mask3D`,
`ScalarField3D`, phantoms, metrics, histograms, the geometry errors) is re-exported
from this package's entry point, so `import { ... } from "rtstruct-js"` keeps resolving.

```
src/
├── index.ts                public entry point — RTStruct, plus `export * from "rt-geometry-js"`
├── types.ts                RTSTRUCT-only types (SeriesGeometry, LoadOptions, RoiHandle, ...)
├── errors.ts               RTSTRUCT-only errors (geometry errors come from rt-geometry-js)
├── contour/                 contours <-> mask (rasterize, vectorize)
└── dicom/
    ├── port.ts                the only dcmjs importer — RTSTRUCT read/write
    └── series-geometry.ts     readSeriesGeometry: CT/MR slice files -> SeriesGeometry
tests/unit/                   spec tests, organized by area (CTR/RT/IO), plus
                               roundtrip.test.ts (the mask->RTSTRUCT->mask gate) and
                               series-geometry.test.ts
tests/fixtures.ts             builds DICOM bytes at test time via dicom/port.ts (no vendor files)
```

`contour/` must never import from `dicom/`, and no package may cross the monorepo
boundaries (the core imports nothing; domain packages don't import each other) —
enforced by `../../scripts/check-dependency-rule.mjs`, which runs before every
`npm test`. `dicom/port.ts`'s ROI read/write internals are never re-exported from the
public entry point — `RTStruct` is the one RTSTRUCT I/O surface. `readSeriesGeometry`
is exported, since there's no equivalent higher-level wrapper for it.

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

## Dependencies

`dcmjs` (the only DICOM dependency) pulls in a
high-severity transitive advisory via `adm-zip`, used only by dcmjs features this
library never touches (`dicom/port.ts` uses `DicomDict`/`DicomMessage`/
`DicomMetaDictionary` only) — accepted as a known tradeoff, revisit if dcmjs
ships a fix.

## License

[MIT](LICENSE)
