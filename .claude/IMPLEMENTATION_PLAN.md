# v0.1 Implementation Plan

**Standard pinned:** DICOM PS3.3 **2026c**. Re-validate on each new edition; the RT
Structure Set IOD is actively changing (CP-2445 relaxed the three top-level
sequences from Type 1 to Type 3).

**Package name:** TBD. Not `rtx` — collides with NVIDIA and is unsearchable.

---

## 1. Scope freeze

### In scope (public)

| Function | Note |
|---|---|
| `RTStruct.load({ rtstruct, geometry })` | Caller supplies the target grid |
| `getROINames()` | Lists declared ROIs including empty ones |
| `roi(name)` | Handle with provenance + diagnostics |
| `getMask(name)` | Returns `Mask3D` (interface) |
| `getMaskSlice(name, k)` | Bulk path for viewers |
| `createFromMask({ mask, name })` | Writes all three sequences |
| `volume({ method: 'voxel' })` | Method always attached to the number |
| `dicomVolume(name)` | Tag 3006,002C — what the source claimed |

### In scope (internal, non-negotiable)

`GridGeometry` · `SeriesGeometry` · geometry tolerances · plane ordering ·
diagnostics · provenance · analytic phantoms · round-trip gate

### Explicitly deferred

`volume({ method: 'contour' })` · boolean operations (mask and ROI) ·
`centroid()` · `boundingBox()` · `expandMargin()` / `contractMargin()` ·
distance transforms · Cornerstone adapter · package split · WASM accelerator ·
`ContourEngine` interface

If geometry is still unsettled at the three-month mark, `volume()` is the
first thing to cut. Ship the other three.

---

## 2. Grid definition (v0.1 constraint)

A grid is a set of planes that share:

- rows / columns
- pixel spacing
- row and column direction cosines
- mutual parallelism

Plane-to-plane distance **may vary**. Anything else — per-plane orientation
changes, per-plane spacing changes — is not a volume grid and is rejected
(`NonParallelPlanesError`).

`GridGeometry` and `SeriesGeometry` are related by **composition**, not
inheritance. A grid may originate from a CT series, an AI model, NIfTI, a
resample, or a phantom. `SeriesGeometry` adds DICOM instance association.

---

## 3. Project structure

```
src/
├── types.ts               public type surface
├── errors.ts
├── metrics.ts             dice / voxelDisagreement / centroidDisplacement
├── geometry/
│   ├── vec3.ts            IMPLEMENTED (pure math)
│   ├── tolerance.ts       DEFAULT_TOLERANCE (provisional)
│   ├── grid-geometry.ts   createGridGeometry, createUniformGrid
│   └── plane-sort.ts      sort by normal projection, dedupe
├── contour/
│   ├── types.ts           Contour, ContourGeometricType
│   ├── rasterize.ts       contours -> mask
│   └── vectorize.ts       mask -> contours
├── mask/mask3d.ts         createEmptyMask, maskFromDense
├── roi/
├── diagnostics/
├── phantom/index.ts       cube, sphere, torus + analytic volumes
└── dicom/port.ts          THE ONLY dcmjs importer
```

### Dependency rule (lint-enforced, build-failing)

`geometry/`, `contour/`, `mask/`, `roi/`, `phantom/` **must not** import from
`dicom/`. This is what keeps the eventual package split possible and what makes
the core usable without DICOM at all. Convention will not hold it; add the rule.

`Mask3D` and `GridGeometry` are exported as **interfaces**, never classes. The
moment a consumer relies on dense `Uint8Array` storage, bit-packing becomes a
breaking change.

---

## 4. Phase order (red -> green)

Each phase turns a named block of tests green. Do not start a phase before the
previous one is fully green.

### Phase 0 — done
44 failing tests, `NotImplementedError`, correct import graph.

### Phase 1 — Geometry core
Turns green: **GEO-01 … GEO-23**

1. `createGridGeometry` / `createUniformGrid`
2. `equals()` with separate position / spacing / angular tolerances
3. `fingerprint()` as a **hint only** — GEO-07 exists to stop anyone later
   "optimizing" `equals` into fingerprint comparison
4. `sortPlanes`: project onto normal, dedupe within epsilon, reject non-parallel
5. `indexToPatient` / `patientToPixel` / `findNearestPlane`

GEO-06 encodes non-transitivity as a **specification**, not a bug.

### Phase 2 — Mask and phantoms
Turns green: **MSK-01 … MSK-04**, **VOL-01 … VOL-04**, **SEC-01**

Allocation is bounded by validated dimensions *before* any buffer is created.
`count()` and `volume()` are hand-written loops over slice buffers — no
per-voxel closures.

### Phase 3 — Rasterization and holes
Turns green: **CTR-01 … CTR-05**

Half-open edge rule (`y0 <= y < y1`) in the scanline fill, or keyhole channels
double-count and the hole fills solid. All three encodings must produce an
identical mask; that equality is the test.

### Phase 4 — Vectorization and round trip
Turns green: **RT-01 … RT-05**

The gate is `mask -> RTSTRUCT -> mask`. Never the reverse: rasterization
quantizes sub-pixel vertices away permanently, so `RT -> mask -> RT` can never
be identity and testing it wastes weeks.

Tiered thresholds:

| Size | Gate |
|---|---|
| Large | Dice ≥ 0.99, volume error ≤ 1% |
| Medium | Dice ≥ 0.98 |
| Tiny (< ~100 voxels) | absolute voxel disagreement ≤ 4, centroid ≤ 1 voxel |

Dice is recorded for tiny structures but does not gate.

### Phase 5 — DICOM read/write
Turns green: **IO-01 … IO-08**, **SEC-02**

Tolerant reading, conservative writing. Join the three sequences by
`ROINumber` / `ReferencedROINumber` — they may be stored out of order. Read
files missing `RTROIObservationsSequence` (Type 3 in 2026c) with a diagnostic;
always **write** it anyway for older reader compatibility.

Never normalize ROI names. Default `RTROIInterpretedType` to `ORGAN`;
`EXTERNAL` changes how a planning system treats the structure.
Set `ROIGenerationAlgorithm` to `AUTOMATIC` on write.

---

## 5. Invariants to state in the README

1. **ContourData defines the physical geometry of the ROI.** Image references
   and source-pixel-plane information describe association, sampling context,
   and provenance. They must not replace or alter the physical coordinates.
2. `equals()` is the authority for operation safety. `fingerprint()` is a cache
   hint; a hit must still be confirmed by `equals()`.
3. Tolerance equality is not transitive and the library does not claim it is.
4. **Do not hide ambiguity.** If a slice was guessed, say so. If nesting
   semantics were applied, say so. If volume came from voxelization, say so.
5. Liberal in what is accepted, conservative in what is emitted — with
   diagnostics as the thing that stops that principle from laundering
   malformed input into confident output.
6. No network access, no filesystem access.
7. Not clinically validated. Not a treatment planning system.

---

## 6. Provenance vs diagnostics

They are different objects and must stay separate.

- **Provenance** = history. How did we get this result?
- **Diagnostics** = problems and ambiguities. Was anything suspicious?

Both carry `redact()`. `sopInstanceUID` is quasi-identifying; a diagnostics
array serialized into an application log is a PHI incident. Default string
formatting omits UIDs.

Diagnostics compose: any derived result carries the union of its inputs'
diagnostics plus anything new.

Strictness modes: `strict` throws on anything guessed, `warn` collects,
`silent` for known-messy batch work.

Nested `CLOSED_PLANAR` is `info`, not `warning`. If a large share of real files
use that encoding, a warning on every one of them trains users to ignore
warnings. Reserve `warning` for genuinely ambiguous nesting — odd depth,
self-intersection, contours that overlap without containing.

---

## 7. Test fixtures

Generated in code at test time. **No vendor DICOM in the repository** — no PHI,
no licensing question, and vendor files carry no ground truth anyway. They can
only demonstrate that the parser did not crash.

Analytic phantoms are the only source of correctness:

- **Cube** — exact volume, trivial case
- **Sphere** — slice-wise area integration, checkable against `4/3·π·r³`
- **Torus** — analytic volume *and* a hole on every plane; encoded three ways
  (keyhole, XOR, nested), all three must agree
- Sphere on oblique orientation and on irregular spacing — same expected volume

Vendor data comes later as a robustness suite, out of tree.

---

## 8. v0.1 exit criteria

- [ ] All 44 tests green
- [ ] `tsc --noEmit` clean under `strict` + `noUncheckedIndexedAccess`
- [ ] Dependency lint rule active and failing the build on violation
- [ ] Tolerance defaults re-derived from real multi-vendor data, not guessed
- [ ] README states the seven invariants and the pinned standard edition
- [ ] Round-trip gate running in CI on every commit
