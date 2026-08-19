# Changelog

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

### Added
- `readSeriesGeometry(instances)` — builds a `SeriesGeometry` from real CT/MR
  DICOM slice files, closing the gap between "I have a folder of DICOM" and a
  usable `GridGeometry`. Detects and flags reversed slice order
  (`SLICE_ORDER_REVERSED`); throws `InconsistentSeriesError` if instances
  disagree on rows/columns/pixel spacing/orientation.
- `CHANGELOG.md` (this file).

### Changed
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
