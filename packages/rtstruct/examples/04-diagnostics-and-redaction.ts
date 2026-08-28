/**
 * Diagnostics vs. provenance, and why redact() exists: diagnostics arrays
 * often end up in application logs, and sopInstanceUID-style identifiers
 * are quasi-identifying. Run with: npx tsx examples/04-diagnostics-and-redaction.ts
 */
import { createUniformGrid } from "rt-geometry-js";
import { writeRTStruct } from "../src/dicom/port.js";
import { RTStruct } from "../src/index.js";

const grid = createUniformGrid({ rows: 32, columns: 32, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

// writeRTStruct (dicom/port.ts) is the low-level writer RTStruct.createFromMask
// uses internally; it also accepts an ROI with zero contours, which a real RTSTRUCT
// can legally contain (e.g. a structure that was defined but never contoured).
const bytes = writeRTStruct({ rois: [{ name: "EmptyStructure", contours: [] }] });
const rt = await RTStruct.load({ rtstruct: bytes, geometry: grid });

console.log("ROI names:", rt.getROINames());
console.log("mask voxel count:", rt.getMask("EmptyStructure").count()); // 0 — no contours, but no throw either

for (const d of rt.diagnostics) {
  console.log(`[${d.severity}] ${d.code}: ${d.message}`);
}

// redact() strips quasi-identifying UIDs before you log something — diagnostics and
// provenance both carry it. Safe default: always redact() before writing to a log.
const roi = rt.roi("EmptyStructure");
console.log("provenance (redacted, safe to log):", roi.provenance.redact());
