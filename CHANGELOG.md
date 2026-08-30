# Changelog — dicom-imaging-toolkit-packages

Monorepo-level events and a release index. Each package keeps its own detailed
changelog:
[`rt-geometry-js`](packages/geometry/CHANGELOG.md) ·
[`rtstruct-js`](packages/rtstruct/CHANGELOG.md) ·
[`rtdose-js`](packages/rtdose/CHANGELOG.md) ·
[`dicom-seg-js`](packages/dicom-seg/CHANGELOG.md) ·
[`rt-convert-js`](packages/convert/CHANGELOG.md).

## Current versions

| Package | Version | npm |
|---|---|---|
| `rt-geometry-js` | 1.1.0 | published |
| `rtstruct-js` | 0.4.0 | published |
| `rtdose-js` | 0.1.1 | published |
| `dicom-seg-js` | 0.2.0 | published |
| `rt-convert-js` | 0.1.0 | not yet published |

## 2026-08-30 — SEG LABELMAP + sparse write

- **`dicom-seg-js` → 0.2.0** (additive): `LABELMAP` (PS3.3 Sup 243) read and
  write — one label per pixel, `seg.mask(n)` returns the voxels whose label is
  `n`; overlapping input to a LABELMAP write throws `LabelmapOverlapError`.
  `writeSeg({ frameCoverage: "sparse" })` omits all-background frames.
  `Segmentation.numberOfFrames` added. `UnsupportedSegmentationTypeError` now
  only for an unknown type. Peer stays `rt-geometry-js ^1.0.0`.

## 2026-08-30 — RTSTRUCT SOP-reference slice association

- **`rtstruct-js` → 0.4.0**: `RTStruct.load` accepts a `SeriesGeometry` and uses
  each contour's `ContourImageSequence` `ReferencedSOPInstanceUID` for
  authoritative contour → slice association, falling back to nearest-plane
  geometry only where a reference is absent or unresolvable. `RoiHandle` gains
  `sliceAssociation` / `sliceAssociationDetail`. Backward-compatible — a bare
  `GridGeometry` behaves exactly as before. Peer stays `rt-geometry-js ^1.0.0`.

## 2026-08-30 — mask operations

- **`rt-geometry-js` → 1.1.0** (additive): boolean masks (`union` / `intersection`
  / `subtract` / `xor` / `complement`), physical morphology (`distanceTransformMm`,
  `dilateMm` / `erodeMm`), single-mask `centroid` / `boundingBox`, `crop` / `pad`,
  and connected components (`connectedComponents` / `largestComponent`). 41 new
  tests. `^1.0.0` covers it — domain packages unchanged. This is the geometry
  half of what both reviews asked for.

## 2026-08-30 — stability + hygiene pass

- **`rt-geometry-js` → 1.0.0.** The shared core is promoted to a stable major so
  the toolkit has a real SemVer boundary. No code change from 0.1.2. New
  [`CONTRACT.md`](packages/geometry/CONTRACT.md) states what the guarantee covers
  and that `Mask3D` / `ScalarField3D` internal storage is explicitly outside it.
- **Domain packages repinned** to `rt-geometry-js` `^1.0.0`: `rtstruct-js`
  0.3.1 → 0.3.2, `rtdose-js` 0.1.0 → 0.1.1, `dicom-seg-js` 0.1.0 → 0.1.1. No API
  changes.
- **`npm audit` is clean.** Root `overrides` pins the transitive `adm-zip` to
  the patched 0.6.0; `vitest` bumped 2 → 3.2.7 (dev-only).
- **`.claude/` planning docs are no longer tracked** — kept local.
- CI badge + per-package npm version badges on the root README.

## Prior history

See each package's own `CHANGELOG.md`. In brief: `rt-geometry-js` was extracted
from `rtstruct-js` 0.2.1 (2026-08-27) as the shared core; `rtstruct-js` 0.3.0
(monorepo split + topology pass); `rtdose-js` 0.1.0 (2026-08-28, DVH engine,
validated vs dicompyler-core); `dicom-seg-js` 0.1.0 (2026-08-29, BINARY +
FRACTIONAL read/write, validated vs highdicom); `rt-convert-js` scaffolded and
both conversion directions implemented (2026-08-29–30).
