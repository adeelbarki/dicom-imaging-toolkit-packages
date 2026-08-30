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
| `rt-geometry-js` | 1.0.0 | published |
| `rtstruct-js` | 0.3.2 | published |
| `rtdose-js` | 0.1.1 | published |
| `dicom-seg-js` | 0.1.1 | published |
| `rt-convert-js` | 0.1.0 | published |

## 2026-08-30 — `rt-convert-js` 0.1.0 published

- **`rt-convert-js` 0.1.0 is on npm** — RTSTRUCT ↔ SEG conversion, both directions,
  every lossy step measured and recorded in provenance. Peers on `rt-geometry-js`
  `^1.0.0`, `rtstruct-js` `^0.3.2`, `dicom-seg-js` `^0.1.1` (all live). Round-trip
  validated on real TCIA data — see [`packages/convert/VALIDATION.md`](packages/convert/VALIDATION.md).
  Completes Phase G. All five packages are now published with a resolving peer chain.

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
