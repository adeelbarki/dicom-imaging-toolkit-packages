# rt-geometry-js — stability contract (1.0.0)

`rt-geometry-js` is the shared peer dependency of every domain package in the
toolkit (`rtstruct-js`, `rtdose-js`, `dicom-seg-js`, `rt-convert-js`). Those
packages hand each other `GridGeometry`, `Mask3D`, and `ScalarField3D` values
and rely on them being *the same implementation* at runtime. That only holds if
there is exactly one installed copy of this package, which in turn only holds if
the version range stays satisfiable.

From 1.0.0 this package follows semantic versioning **strictly**:

- **patch** — bug fixes, no surface change.
- **minor** — additive only: new exports, new optional parameters, new optional
  interface members that existing callers can ignore.
- **major** — anything that could break a caller or a downstream package,
  including any change to the guaranteed surface below.

Domain packages should peer on `^1.0.0`. A future `2.0.0` is a coordinated
release across the whole toolkit, published core-first.

---

## Covered by the guarantee

Everything a domain package builds on. A breaking change to any of this is a
major version.

### Types / interfaces (structural shape)

| Export | Guarantee |
|---|---|
| `GridGeometry` | All members listed in `types.ts`: `rows`, `columns`, `rowDirection`, `columnDirection`, `pixelSpacing`, `planes`, `frameOfReferenceUID?`, and the methods `normal()`, `equals(other, tol?)`, `fingerprint()`, `isUniformlySpaced(tolMm?)`, `indexToPatient()`, `patientToPixel()`, `findNearestPlane()`, `planeThicknessMm()`. Semantics as documented there — in particular `equals()` is the authority for operation safety, is tolerance-based, and is **not transitive**; `fingerprint()` is a cache hint only. |
| `GridPlane`, `GridTolerance`, `Vec3` | Field shape. |
| `Mask3D` | `geometry`, `dimensions` (`[columns, rows, planes]`), `get()`, `getSliceBuffer()` (length `rows*columns`), `count()`, `volume()`. |
| `ScalarField3D` | `geometry`, `dimensions`, `get()`, `getSliceBuffer()`. |
| `Provenance`, `Diagnostic`, `Severity`, `VolumeMethod`, `VolumeResult`, `SliceAssociation`, `HoleInterpretation` | Field shape. New `Severity` / `SliceAssociation` / `HoleInterpretation` union members may be **added** in a minor (a consumer must not `switch` without a default). |

### Constructors / factories

`createGridGeometry`, `createUniformGrid`, `createEmptyMask`, `maskFromDense`,
`createScalarField`, `createDiagnostic`, `sortPlanes` — signatures and documented
behaviour. New **optional** parameters may be added in a minor.

### Sampling, resampling, histograms

`sampleFieldAt`, `resampleField`, `resampleMask`, `histogram`,
`volumeAboveThreshold`, `valueAtVolumeFraction`, `meanValue`,
`thresholdSensitivity`, and the `InterpMethod` union. These are the DVH /
confidence-histogram engine the domain packages call rather than reimplement.

### Metrics, phantoms, vectors, tolerance

`dice`, `voxelDisagreement`, `centroidDisplacementMm`; `cubePhantom`,
`spherePhantom`, `torusPhantom`, `analyticVolumeMm3`; the `vec3` helpers;
`DEFAULT_TOLERANCE` and `DEFAULT_MAX_VOXELS` (the *names* and their meaning — the
numeric values may be refined in a minor if measured data warrants, which is not
considered breaking).

### Errors

`NotImplementedError`, `NonParallelPlanesError`, `ResourceLimitError`,
`NonOrthogonalBasisError`, `IndeterminateVolumeError`, `GridMismatchError`,
`IndeterminateCentroidError`, `FrameOfReferenceMismatchError` — class names and
which operations throw them. New error classes may be added in a minor.

---

## Explicitly *not* covered — free to change in a minor or patch

- **Internal storage of `Mask3D` and `ScalarField3D`.** They are interfaces, never
  classes. `getSliceBuffer()` currently returns a view into a dense
  `Uint8Array` / `Float32Array` backing the whole volume; that backing, its
  packing, whether the view aliases a larger buffer, and the concrete object's
  prototype are all implementation detail. Do not `instanceof`-check them, do not
  rely on a returned slice being writable-through to the volume, and do not
  assume one voxel is one byte. Bit-packing a mask would be a minor, not a major.
- **Exact wording of diagnostic and error messages.**
- **`fingerprint()`'s string format** — it is a hint; only "equal string ⇒ worth
  confirming with `equals()`" is guaranteed.
- Any symbol not exported from `src/index.ts`.
- Performance characteristics (though regressions are treated as bugs).

---

## For consumers

- Peer-depend on `rt-geometry-js` (`"peerDependencies": { "rt-geometry-js": "^1.0.0" }`),
  with a matching `devDependency` for local work. Do **not** put it in
  `dependencies` — that invites a second copy at a different version, and then a
  `Mask3D` from one package meets a different `GridGeometry` implementation in
  another and they disagree silently.
- Treat `Mask3D` / `ScalarField3D` as opaque handles plus `getSliceBuffer()` for
  bulk reads. Copy a slice before mutating it.
- When consuming a union (`Severity`, `HoleInterpretation`, `InterpMethod`, …),
  always handle the default case — members can be added in a minor.
