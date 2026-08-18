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

`npx vitest run` reports 31/44 passing: all 16 GEO-*, SEC-01, SEC-02,
MSK-01…04, VOL-01…04, CTR-01…05. Only `RT-*` (Phase 4) and `IO-*`
(Phase 5) remain, throwing `NotImplementedError` as expected.
`spherePhantom`/`torusPhantom` remain stubs — deferred to Phase 4, where
`RT-*` needs them alongside the real round trip.

Next step: Phase 4 — vectorization and round trip (`RT-01…05`).
