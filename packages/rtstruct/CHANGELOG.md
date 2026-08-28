# Changelog

## [0.3.0] - 2026-08-27

Monorepo split + topology-robustness pass. **No breaking change for consumers** —
every geometry export is still importable from `rtstruct-js`.

### Changed

- `rtstruct-js` now lives in the `dicom-imaging-toolkit-packages` monorepo and the
  geometry core is a separate package, **[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js)**,
  declared here as a `peerDependency` (`^0.1.0`). Install it alongside `rtstruct-js`.
  `GridGeometry`, `Mask3D`, `createUniformGrid`, `dice`, phantoms, the geometry errors,
  and everything else geometry-related are **re-exported** from `rtstruct-js`, so
  existing `import { … } from "rtstruct-js"` lines keep working unchanged.
- `rt-geometry-js` also adds `ScalarField3D` and a histogram/DVH engine
  (`histogram`, `volumeAboveThreshold`, `valueAtVolumeFraction`) — available through the
  `rtstruct-js` re-export too.
- **Type-only, non-breaking at runtime:** `Diagnostic.code` is now typed `string` rather
  than the `DiagnosticCode` union (the geometry core has no RT-specific vocabulary). The
  `DiagnosticCode` union is still exported for callers that `switch` over it; a
  `const c: DiagnosticCode = someDiagnostic.code` now needs an explicit assertion.
- `planeThicknessMm` is now a method on `GridGeometry` (`grid.planeThicknessMm(i)`); the
  free function is kept as a thin wrapper.

### Fixed

- `rasterize()` now rejects a contour containing a non-finite point coordinate
  (`NaN`/`Infinity` from malformed `ContourData`) with `MalformedContourError`, instead
  of letting it flow silently into `patientToPixel`/`findNearestPlane` where every
  comparison against it is quietly false (contour vanishes from the fill or lands on the
  wrong plane).

### Added / hardened tests

- Vectorizer output **ordering and winding are now a documented, tested contract**
  (`VECTOR-ORDER-*`): contours emitted plane-ascending then row-major discovery order;
  loops wind clockwise in `(column, row)` screen space; hole boundaries wind the other
  way.
- New `topology.test.ts` — exact `voxelDisagreement() === 0` mask→contour→mask round
  trips for single voxel, rectangle, disconnected islands, island-in-a-hole,
  checkerboard, one-voxel-wide structures, and border-flush structures.
- `holes.test.ts` CTR-02/CTR-03 tightened from `mask.count()` equality to
  `voxelDisagreement() === 0`.

### Validation

- The real-file round-trip check was re-run against this release on 3 of the 7
  validation patients spanning both modalities and 3 authoring tools (Elekta MR,
  TCIA NSCLC-Radiomics CT, Varian CT — every ROI). Every ROI reproduced the
  `VALIDATION.md` findings exactly: mask→write→mask round-trip Dice `1.000000`,
  voxel disagreement `0`, point-count ratios in the documented ranges — confirming
  the geometry extraction and the fixes above are behaviour-neutral on real data.

## [0.2.1] - 2026-08-19

Docs-only patch. No code or behavior changes.

### Fixed
- `README.md`'s top-of-file Status line still said "v0.1, 57 tests green" —
  stale since before the 0.2.0 correctness pass started, missed while
  updating every other part of the README this round. Now says v0.2.1 and
  the current test count. Caught after 0.2.0 had already been published,
  since `README.md` ships inside the npm tarball and there is no way to
  update a package's displayed README without publishing a new version.

## [0.2.0] - 2026-08-19

Correctness and documentation pass, per the project's 0.1 → 0.2 goal: fix
issues found in shipped 0.1 surface before adding more API.

### Fixed
- `GridGeometry.equals()` now compares `frameOfReferenceUID`. Previously two
  grids in different, non-comparable coordinate systems could test as equal
  if their numeric coordinates happened to line up; `fingerprint()` already
  included the FoR but `equals()` never checked it.
- `RTStruct.load()` now reads each ROI's `ReferencedFrameOfReferenceUID` and
  cross-checks it against the supplied `geometry`. Controlled by
  `LoadOptions.strictness` (`"warn"` by default — emits a
  `FRAME_OF_REFERENCE_MISMATCH` diagnostic and loads anyway; `"strict"` throws
  the new `FrameOfReferenceMismatchError`; `"silent"` does neither). This is
  the first real use of `strictness`, previously accepted but ignored.
- `normalize()` now throws on a degenerate (near-zero, not just exactly-zero)
  vector and on non-finite (`NaN`/`Infinity`) components, instead of silently
  producing `[NaN, NaN, NaN]`. It's the trust boundary for direction vectors
  (only ever called at grid construction, never in a hot loop), so this is
  where malformed orientation data now fails, rather than propagating through
  the normal, the slice projection, and eventually the contour matching.
  `sortPlanes` similarly rejects a non-finite plane position outright, since
  positions never pass through `normalize` and could otherwise corrupt sort
  order or a distance comparison silently. `add`/`dot`/`cross`/`scale` stay
  unchecked on purpose.
- `angleBetween`'s doc comment corrected: it's independent of magnitude, but
  *not* independent of sign — flipping one input's sign gives the
  supplementary angle, not the same one.
- `sortPlanes`'s duplicate-plane detection no longer reuses
  `tolerance.positionMm` (default 0.5mm). That tolerance governs a different,
  coarser question — how far apart can two whole grids' positions be and
  still count as the same geometry — and reusing it for "is this the same
  physical plane" meant two genuinely distinct slices 0.4mm apart (a normal
  thin-slice spacing) would be silently merged, dropping real image data.
  Dedup now uses a small fixed epsilon (1e-3mm) dedicated to floating-point
  round-trip noise, decoupled from the caller-tunable tolerance.
- `sortPlanes`'s off-axis/parallelism rejection (is a plane's origin off the
  shared stacking axis) also stopped reusing `tolerance.positionMm` — a
  third distinct meaning sharing one field. It now uses its own
  `OFF_AXIS_TOLERANCE_MM` constant (0.5mm, same value as today's default,
  but no longer the same variable). **Breaking:** `sortPlanes()` no longer
  takes a `GridTolerance` parameter — nothing in the codebase ever passed
  one (it always fell back to the default), and both tolerances it needs
  are now fixed constants dedicated to their own job.
- `createGridGeometry()` now rejects a non-orthogonal `rowDirection`/
  `columnDirection` basis (new `NonOrthogonalBasisError`). Previously any
  two non-parallel directions were silently accepted, normalized, and used
  to build the grid — but `patientToPixel()` is only the true inverse of
  `indexToPatient()` when the basis is orthogonal (the cross term
  `dot(row, column)` only vanishes at exactly 90°). Non-orthogonal input
  didn't error anywhere; it silently returned wrong pixel coordinates from
  `patientToPixel()`, which `rasterize()` depends on for every contour
  point. Applies to `createUniformGrid` and `readSeriesGeometry` too, since
  both build on `createGridGeometry`.

### Fixed (Mask3D)
- `get(column, row, planeIndex)` now validates all three indices are
  in-range integers, throwing `RangeError` instead of indexing the
  underlying buffer directly. This was worse than a wrong-but-plausible
  result: a `Uint8Array` returns `undefined` for an out-of-range index, and
  `undefined !== 0` is `true` in JS — so `get()` could fabricate a false
  "voxel is set" past the end of the buffer entirely, not just alias a
  different real voxel.
- `getSliceBuffer(planeIndex)` now validates `planeIndex` the same way.
  Previously an out-of-range index silently returned an empty slice
  (`TypedArray.subarray` clamps), and a *negative* index silently returned
  data from the wrong plane (`subarray` treats negative indices as
  counting from the end) instead of throwing either way.
- `createEmptyMask`/`maskFromDense` now validate the computed voxel count
  (`columns * rows * planes.length`) is a safe integer before comparing it
  against the voxel limit or sizing an allocation — the multiplication
  itself can silently overflow `Number.MAX_SAFE_INTEGER` for
  large-but-individually-valid dimensions. Throws `ResourceLimitError`.
- `mask.volume()` on a single-plane grid now throws the new
  `IndeterminateVolumeError` instead of silently returning `{ valueMm3: 0,
  method: "voxel" }`. A single plane has no second plane to measure slice
  thickness from — the previous `0` was indistinguishable from "computed,
  genuinely empty."

### Fixed (rasterize)
- **Hole interpretation was decided ROI-wide, not per plane.** `rasterize()`
  used to set `holeInterpretation: "nested-even-odd"` whenever a whole ROI
  had more than one `CLOSED_PLANAR` contour — including a completely
  normal 4-slice tumor with one contour per plane, which got mislabeled as
  "nested" with a false `NESTED_CLOSED_PLANAR_INTERPRETED` diagnostic even
  though the four contours were never on the same plane. Contours are now
  grouped by plane *before* hole interpretation is decided, and the
  diagnostic (when it fires) correctly names the actual plane.
- **Multiple contours on one plane no longer automatically means
  "nested."** Two disjoint tumor islands on the same slice were also
  labeled `"nested-even-odd"` even though neither contains the other —
  the fill happened to be correct (even-odd handles disjoint polygons
  fine) but the provenance was false. `rasterize()` now tests actual
  containment (does one contour's point land inside another's edges,
  reusing the same even-odd test already used for filling) before calling
  something nested; genuinely disjoint components are correctly `"none"`.
- **Slice association ignored `distanceMm`.** A contour could sit
  arbitrarily far from every plane (e.g. at Z=100mm on a stack sampled at
  Z=0/3/6/9) and would silently rasterize onto whichever plane happened to
  be nearest, with no signal anything was wrong. `rasterize()` now flags
  this via `CONTOUR_PLANE_DISTANCE` (previously a defined-but-never-used
  diagnostic code) when a contour's assigned plane is farther than half
  the local inter-plane spacing — still rasterizes it (liberal reading),
  just no longer silently.
- **Only a contour's first point determined its plane; the rest were
  trusted to be coplanar.** A malformed contour where one point sits on a
  different Z than the rest previously projected that point onto the
  wrong plane with no error, distorting the polygon. Every point is now
  checked against the assigned plane using the same tolerance, flagged via
  the same `CONTOUR_PLANE_DISTANCE` diagnostic if any point is out of
  tolerance.
- **Degenerate contours (0-2 points for a closed shape) reached
  rasterization instead of being rejected.** New `MalformedContourError`,
  thrown for any contour with fewer points than its `geometricType` can
  meaningfully represent (POINT: 1, OPEN_PLANAR/OPEN_NONPLANAR: 2,
  CLOSED_PLANAR/CLOSEDPLANAR_XOR: 3) — checked by raw count, not true
  geometric uniqueness (that would need its own tolerance decision, not
  attempted here).
- **Unsupported geometric types (`OPEN_PLANAR`, `OPEN_NONPLANAR`,
  `POINT`) were silently excluded from the mask with no signal.** A caller
  reading an empty result had no way to distinguish "this ROI is
  genuinely empty" from "this ROI has content the library can't fill."
  New `UNSUPPORTED_CONTOUR_GEOMETRY` diagnostic names the excluded type(s)
  and count.

### Fixed (vectorize)
- **Diagonally-touching filled voxels produced an array-order-dependent
  result instead of a defined topology.** Two voxels touching only at a
  shared corner (e.g. `[[1,0],[0,1]]`) create a vertex where two boundary
  edges start — one continuing around the current voxel's own square, one
  jumping to the diagonal neighbor. `linkLoops()` picked "whichever comes
  first in the candidate array," which happened to currently produce the
  correct result but had no actual rule behind it — a future change to
  edge insertion order could silently flip whether two diagonally-touching
  regions become two contours or one incorrect self-touching polygon.
  Fixed with a deterministic rule: always take the sharpest clockwise turn
  relative to the incoming edge, the standard resolution for the
  4-connectivity/8-connectivity ambiguity in boundary tracing. RTStructJS's
  foreground is now explicitly 4-connected (diagonal-only touches are two
  separate contours); background is correspondingly 8-connected.
- **An unclosed boundary trace was silently emitted as a valid contour.**
  `linkLoops()` treated `break` from "ran out of candidate edges" the same
  as `break` from "returned to the start point," and would still push the
  (open) result as a `CLOSED_PLANAR` contour once it had more than 3
  points. New `UnclosedContourError`: closure is now tracked explicitly,
  and a trace that fails to close throws instead of being silently
  accepted. For a valid binary raster this should be unreachable (exposed
  voxel boundaries always form closed cycles by construction) — an
  algorithm bug or corrupted buffer, not unusual-but-valid data, so it
  fails loudly rather than being repaired.
- **`vectorize()` had no resource limit**, unlike `createEmptyMask()`.
  A worst-case checkerboard mask produces roughly 4 boundary edges per
  filled voxel, and a mask built via `maskFromDense` (rather than
  `createEmptyMask`) never passed through any voxel-count check at all.
  `vectorize()` now takes an optional `maxVoxels` parameter (default
  `DEFAULT_MAX_VOXELS`, now exported from `mask3d.ts` and shared rather
  than duplicated), checked before any boundary/loop data structure is
  built.

### Fixed (phantom)
- **`cubePhantom`/`spherePhantom`/`torusPhantom` accepted nonsensical
  dimensions silently.** A negative or zero `sideMm`/`radiusMm` (e.g.
  `spherePhantom(grid, -10)`) produced a quietly empty mask instead of an
  error — indistinguishable from a legitimately empty ROI. All three now
  validate their size parameters (finite, `> 0`) and throw `RangeError`.
  `torusPhantom` additionally rejects `majorRadiusMm <= minorRadiusMm`: the
  tube self-intersects in that regime, and `analyticVolumeMm3.torus`'s
  closed-form formula no longer matches the enclosed volume, which would
  have made the module's own volume cross-check silently wrong.
- **Phantom builders allocated `new Uint8Array(...)` directly, bypassing
  the voxel-count budget `createEmptyMask()` already enforces.** An
  oversized `GridGeometry` could make any of the three attempt a huge
  allocation with no guard. `mask3d.ts` now exports `checkVoxelBudget()`
  (the same check `createEmptyMask()` uses, factored out so it can be
  reused without duplicating the logic); all three phantom functions take
  an optional `maxVoxels` parameter and check it before doing any
  voxelization work — see SEC-01.

### Fixed (metrics)
- **`dice()`/`voxelDisagreement()` never checked that both masks were on the
  same grid.** They compared buffers index-by-index using `a`'s dimensions
  for both the loop bound and the slice length, so two masks with identical
  array dimensions but different physical spacing (e.g. `0.7mm` vs `1.4mm`
  pixel spacing) — voxel `[100,100,20]` on one is not the same patient
  location as `[100,100,20]` on the other — were silently compared as if
  they matched, and masks with genuinely different dimensions could read
  past a shorter buffer's bounds. Both now call the existing
  `GridGeometry.equals()` and throw a new `GridMismatchError` before doing
  any work; both take an optional `GridTolerance` parameter, passed
  through.
- **`centroidMm()` returned `[0,0,0]` for an empty mask**, a fabricated
  patient coordinate indistinguishable from a real ROI centered at the
  origin — comparing an empty mask against another empty mask, or against
  a real ROI that happens to sit near the origin, reported a false "perfect
  agreement." New `IndeterminateCentroidError`: an empty mask has no
  centroid, full stop.
- **`centroidDisplacementMm()` never checked frame of reference.** Two
  masks with matching numeric coordinates but different
  `frameOfReferenceUID` (different patients, unregistered scans) would
  report `0mm` displacement — numerically true, physically meaningless.
  Now throws `FrameOfReferenceMismatchError` (the same class `RTStruct.load`
  already uses for this exact invariant) when both sides declare a frame
  and they differ; either side undefined is not treated as a mismatch,
  matching `equals()`'s existing fall-through. Deliberately does not
  require full grid equality here (unlike `dice`/`voxelDisagreement`) —
  patient-space coordinates are still comparable across different
  resolutions in the same frame.
- **`centroidMm()` weighted every occupied voxel equally**, correct only on
  uniformly-spaced grids. On the irregular plane spacing this library
  explicitly supports, a voxel on a plane with 5mm of territory represents
  5x the physical volume of a voxel on a 1mm-thick plane and should count
  proportionally more toward the centroid. Now weights by
  `planeThicknessMm()` (exported from `mask3d.ts`, reused rather than
  duplicated); unchanged on uniformly-spaced grids, where every plane's
  thickness is equal.
- `examples/03-compare-masks.ts` was itself relying on the exact
  `dice()`/`voxelDisagreement()` bug above: it built two separate
  `GridGeometry` objects that differed only in `origin`, i.e. two
  physically different grids, and compared masks across them. Fixed to
  build one shared grid and paint the "predicted" sphere at an explicit
  off-center patient coordinate directly, rather than shifting the grid.

### Fixed (ROI identity and DICOM parsing)
- **`RTStruct` stored ROIs in a `Map<string, StoredRoi>` keyed by `ROIName`.** DICOM
  permits multiple ROIs with the same `ROIName` — `ROINumber` is the actual Type 1 unique
  identifier. Two distinct ROIs sharing a name silently overwrote each other on load, with
  no diagnostic. Storage is now keyed by `ROINumber`. `roi()`/`getMask()`/`getMaskSlice()`/
  `dicomVolume()` now accept either identifier: a `ROINumber` resolves unambiguously; a
  name throws a new `AmbiguousRoiNameError` if more than one ROI shares it, rather than
  silently picking one. New `getROINumbers()` (always one entry per ROI) and
  `findROIsByName()` (returns every match). `getROINames()` may now legitimately contain
  duplicates, reflecting the file rather than hiding the collision.
- **`ContourData` whose length wasn't a multiple of 3 was silently truncated.** `port.ts`'s
  `chunkPoints()` looped `i + 2 < flat.length`, dropping 1–2 trailing coordinates with no
  error. Now throws `MalformedContourError` immediately — malformed `ContourData` is not a
  recoverable condition, consistent with `strictness` only gating conditions this library
  can actually interpret one way or another.

### Added
- `tests/unit/port.test.ts` (new file) — `chunkPoints` exported for direct testing (not
  reachable through any well-formed fixture, since every `Contour`'s points always flatten
  to a multiple of 3); confirms the malformed-length throw and that well-formed input is
  unaffected.
- `tests/unit/io.test.ts`: IO-15..19 — duplicate ROI names both load under distinct
  `ROINumber`s, `roi(number)` resolves either unambiguously, `roi(name)` throws
  `AmbiguousRoiNameError` on a collision, `findROIsByName()` returns every match, and a
  unique name is unaffected.
- `tests/unit/metrics.test.ts` (new file) — grid-mismatch rejection,
  frame-of-reference cross-check, empty-mask centroid rejection, and an
  irregular-spacing weighted-centroid regression (hand-computed expected
  value, not just "doesn't throw").
- Phantom/geometry regression coverage: anisotropic pixel spacing
  (`pixelSpacing: [0.5, 0.8]`, distinct slice spacing) verified against
  the analytic sphere volume directly, independent of any round trip; a
  genuinely tilted 3D grid normal (not just an in-plane rotation) round
  trips correctly; sub-0.5mm plane spacing survives `createGridGeometry`
  without any plane being dropped as a false duplicate.
- `readSeriesGeometry(instances)` — builds a `SeriesGeometry` from real CT/MR
  DICOM slice files, closing the gap between "I have a folder of DICOM" and a
  usable `GridGeometry`. Detects and flags reversed slice order
  (`SLICE_ORDER_REVERSED`); throws `InconsistentSeriesError` if instances
  disagree on rows/columns/pixel spacing/orientation.
- `CHANGELOG.md` (this file).

### Changed
- `DEFAULT_TOLERANCE`'s doc comment no longer says "re-derive before v0.1
  ships" (stale — v0.1 shipped). Now documents what each field means and
  why, and clarifies `GridTolerance` has exactly one job (comparing
  already-built things), not construction-time validation.
- `createGridGeometry()` now validates `rows`/`columns` (positive integer),
  `pixelSpacing` (finite, > 0 per axis), and `planePositions` (non-empty —
  a zero-plane grid isn't usable for rasterization and previously let
  `findNearestPlane()` return the `{planeIndex: -1, distanceMm: Infinity}`
  sentinel to any caller). `createUniformGrid()` similarly validates
  `planeCount` (positive integer) and `sliceSpacingMm` (finite, > 0 —
  negative spacing has no observable effect once `createGridGeometry`
  sorts planes by position anyway, so it's rejected rather than silently
  accepted). All throw `RangeError`.
- `patientToPixel()` and `fingerprint()` doc comments clarified, on both
  the implementation and the public `GridGeometry` interface: the former
  is an orthogonal projection, not a same-plane check, and returns a
  result for points arbitrarily far out of plane; the latter is a pure
  ~0.001-precision hash that cannot fully track `equals()` (different
  per-field tolerances, and `equals()` accepts an arbitrary caller-supplied
  tolerance that `fingerprint()` has no way to know about) — a match is a
  hint, a mismatch is not proof of inequality. No behavior change to either
  function; `equals()`'s interface doc also now states its FoR semantics
  explicitly (already implemented earlier in this same version, just
  undocumented at the interface until now).
- `README.md`'s Errors section rewritten to cover every error class added
  this version (previously only listed the five that existed at the start
  of the round); the ROI round-trip example now shows `getROINumbers()`
  and notes that `getROINames()` may contain duplicates.
- **`RTStructImpl` renamed to `RTStruct`.** `RTStructImpl` remains exported
  as a deprecated alias (same class, both type and value position) and will
  be removed in a future major version.
- README: added a `## Limitations` section, a feature bullet for the
  three-hole-encoding equivalence (nested/XOR/keyhole), and moved the
  dcmjs/adm-zip advisory disclosure into its own `## Dependencies` section
  near the bottom instead of the second paragraph.

## [0.1.0] - 2026-08-18

Initial release. `RTStructImpl.load`/`.createFromMask` round-trips a mask
through real DICOM RTSTRUCT bytes; `GridGeometry`, analytic phantoms (cube,
sphere, torus), even-odd rasterization with all three hole encodings, and
tolerant read / conservative write DICOM I/O via dcmjs.
