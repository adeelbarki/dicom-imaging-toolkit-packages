# rtstruct-js

DICOM RT Structure Set (RTSTRUCT) reading and writing for JavaScript/TypeScript.
Correctness is checked against analytic phantoms (cube, sphere, torus) with
known closed-form volumes, not against vendor fixtures — there is no vendor
DICOM in this repository (no PHI, no licensing question, and vendor files
carry no ground truth anyway).

**Status:** v0.1 feature-complete (44/44 tests green) but not yet
published. See [`.claude/IMPLEMENTATION_PLAN.md`](.claude/IMPLEMENTATION_PLAN.md)
for the full phase order and scope — all five phases are done, including
real DICOM read/write via `dicom/port.ts`. `dcmjs` (the only DICOM
dependency, imported nowhere else) currently pulls in a high-severity
transitive advisory via `adm-zip` and declares a newer Node engine
requirement than this project targets; see `.claude/README.md` for the
detail. Neither affects `dicom/port.ts`'s actual code path, but resolving
or accepting that tradeoff is worth a decision before shipping.

**Standard pinned:** DICOM PS3.3 **2026c**.

## Install / develop

```sh
npm install
npm test         # vitest, dependency-rule check runs first (pretest)
npm run typecheck # tsc --noEmit, strict + noUncheckedIndexedAccess
```

## Project structure

```
src/
├── index.ts                public entry point (RTStructImpl)
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
geometry/mask/phantom core usable without DICOM at all.

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

TBD.
