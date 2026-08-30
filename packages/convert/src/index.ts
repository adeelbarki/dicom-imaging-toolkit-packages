/**
 * `rt-convert-js` — convert between DICOM RT Structure Sets and DICOM Segmentation.
 *
 * The only package in the toolkit that depends on two domain packages (`rtstruct-js` and
 * `dicom-seg-js`). It does **not** re-export their surfaces — they each re-export all of
 * `rt-geometry-js`, so re-exporting both here would collide. Import `RTStruct` from
 * `rtstruct-js`, `readSeg` from `dicom-seg-js`, and geometry types from either.
 *
 * Every conversion returns `{ bytes, provenance }`. `provenance.lossySteps` lists each
 * step that does not round-trip (a fractional→binary threshold, a mask→contour
 * vectorization), with the numbers needed to audit it. See `docs/CONVERSION.md`.
 */
export * from "./errors.js";
export * from "./provenance.js";
export { rtstructToSeg } from "./rtstruct-to-seg.js";
export type { RtstructToSegOptions } from "./rtstruct-to-seg.js";
export { segToRtstruct } from "./seg-to-rtstruct.js";
export type { SegToRtstructOptions } from "./seg-to-rtstruct.js";
export { VERSION } from "./version.js";
