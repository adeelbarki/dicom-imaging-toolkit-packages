# Spec staging

Source-of-truth materials for v0.1, copied in from the sibling folder before
any implementation existed. Not yet wired into a buildable project.

- `IMPLEMENTATION_PLAN.md` — phase order, scope freeze, invariants.
- `spec/src/types.ts` — the public type surface (`GridGeometry`, `Mask3D`,
  `Provenance`, `Diagnostic`, ...). Belongs at `src/types.ts` at repo root.
- `spec/tests/unit/*.test.ts` — the 9 "Phase 0" spec files (44 tests per the
  plan). Import paths (`../../src/...`, `../helpers.js`) assume they land at
  `tests/unit/*.test.ts` in a repo with `src/` and `tests/helpers.ts` at the
  root — i.e. this `spec/` folder's layout should be copied up as-is.

## Status

The real tree now exists at the repo root (`src/`, `tests/`, `package.json`,
`tsconfig.json`, `vitest.config.ts`, `scripts/check-dependency-rule.mjs`) —
this `spec/` folder is kept only as the original staged snapshot.

Phase 1 (geometry core) is implemented and green: `vec3.ts`, `tolerance.ts`,
`grid-geometry.ts`, `plane-sort.ts`.

Phase 2 (mask and phantoms) is implemented and green: `mask/mask3d.ts`
(`createEmptyMask`/`maskFromDense`, with the SEC-01 voxel-count check run
*before* allocation) and `cubePhantom` in `phantom/index.ts`. Per-plane
thickness is the average distance to neighboring planes (falls back to the
single-neighbor distance at the ends of the stack), which reduces to the
uniform slice spacing for `createUniformGrid` grids — confirmed exactly by
VOL-01/VOL-02. VOL-04 now genuinely exercises `cubePhantom` before hitting
the intended `NotImplementedError` on `{method: "contour"}`, no longer a
technicality.

Phase 3 (rasterization and holes) is implemented and green:
`contour/rasterize.ts`. All three hole encodings (nested `CLOSED_PLANAR`,
`CLOSEDPLANAR_XOR`, keyhole) reduce to one algorithm — combine every
fillable contour's edges on a plane into a single list and run an even-odd
ray-cast with the half-open rule (`y0 <= y < y1`) per pixel center. Parity
is direction- and winding-independent, so nested rings and XOR pairs are
handled identically; a keyhole's out-and-back channel edges cancel exactly
under the half-open rule instead of double-counting and filling the hole
solid. `holeInterpretation` is recorded as a provenance label only — it
does not change which algorithm runs.

Phase 4 (vectorization and round trip) is implemented and green:
`contour/vectorize.ts`, `metrics.ts`, `spherePhantom`/`torusPhantom`, and
`RTStructImpl.load`/`.createFromMask` in `src/index.ts`.

`vectorize()` traces each filled cell's boundary edges in the unit-square
lattice (a cell at (row, column) occupies the square centered on it, with
corners at half-integer offsets) and stitches them into closed loops —
this is the exact inverse of `rasterize()`'s point-sampling: boundaries
always sit at half-integer coordinates, so they never touch the integer
sample points rasterize() tests, and the round trip is exact rather than
approximate for a single mask <-> contour <-> mask pass. `RTStructImpl`
wraps `vectorize()`'s output in a **private JSON wire format** (not DICOM)
to drive the round trip — this is scaffolding only; Phase 5 replaces
`load()`/`createFromMask()` with real `dicom/port.ts` I/O, but
`vectorize()`/`rasterize()` themselves do not change.

`npx vitest run` reports 39/44 passing: everything through Phase 4,
including RT-01…05. It also incidentally passes IO-06/07/08, since those
only exercise `createFromMask()` → `load()` behavior (three sequences
present, `holeInterpretation` defined, `interpretedType` defaults to
`ORGAN`) rather than real DICOM bytes. IO-01…05 remain — they need
`buildFixture`, a real DICOM fixture builder that doesn't exist yet
(Phase 5 scope, alongside `dicom/port.ts` and tolerant-reading diagnostics
like `MISSING_RT_ROI_OBSERVATIONS`).

Next step: Phase 5 — DICOM read/write (`IO-01…08`, plus a fixture builder
for the test suite).
