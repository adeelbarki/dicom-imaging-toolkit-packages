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
`grid-geometry.ts`, `plane-sort.ts`. `npx vitest run` currently reports
18/44 passing — all 16 GEO-* tests plus SEC-02 (depends only on
`diagnostics/` + `plane-sort.ts`) pass legitimately; VOL-04 passes on a
technicality (the `cubePhantom` stub's `NotImplementedError` message happens
to match the test's regex before `.volume()` is ever reached — revisit once
Phase 2 implements `cubePhantom` for real). Everything else still throws
`NotImplementedError` as expected for its later phase.

Next step: Phase 2 — mask and phantoms (`MSK-*`, `VOL-*`, `SEC-01`).
