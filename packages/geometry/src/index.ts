/**
 * rt-geometry-js — the shared geometry core for the DICOM imaging toolkit.
 *
 * Everything needed to build and compare physical sampling grids, boolean masks, and
 * scalar fields, with no DICOM, network, or filesystem dependency. Domain packages
 * (rtstruct-js, rtdose-js, dicom-seg-js) depend on this as a peer.
 */
export * from "./types.js";
export * from "./errors.js";
export * from "./vec3.js";
export * from "./tolerance.js";
export * from "./grid-geometry.js";
export * from "./plane-sort.js";
export * from "./mask3d.js";
export * from "./mask-ops.js";
export * from "./morphology.js";
export * from "./connected-components.js";
export * from "./scalar-field.js";
export * from "./resample.js";
export * from "./histogram.js";
export * from "./phantom.js";
export * from "./metrics.js";
export * from "./diagnostics.js";
