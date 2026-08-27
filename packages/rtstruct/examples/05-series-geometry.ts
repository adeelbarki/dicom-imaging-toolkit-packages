/**
 * Building a GridGeometry from real CT/MR slice files instead of hand-building one —
 * this is the piece that ties rtstruct-js into an actual imaging pipeline.
 * Run with: npx tsx examples/05-series-geometry.ts
 *
 * No real files here (synthetic slices stand in for them — same "no vendor DICOM"
 * philosophy as the test suite), but readSeriesGeometry is exactly what you'd point
 * at a real downloaded CT series (e.g. from TCIA) once you have one.
 */
import { writeCTSlice } from "../src/dicom/port.js";
import { readSeriesGeometry } from "../src/dicom/series-geometry.js";
import { spherePhantom } from "../src/phantom/index.js";
import { RTStruct } from "../src/index.js";
import type { Vec3 } from "../src/types.js";

const ROW_DIRECTION: Vec3 = [1, 0, 0];
const COLUMN_DIRECTION: Vec3 = [0, 1, 0];
// DICOM UIDs are strictly digit-and-dot notation (dcmjs sanitizes anything else on
// read, per PS3.5) — no words, unlike the illustrative "example.series" this had
// before, which silently got mangled to "...3680043.." with the letters stripped out.
const SERIES_INSTANCE_UID = "1.2.826.0.1.3680043.9.1000.1";
const FRAME_OF_REFERENCE_UID = "1.2.826.0.1.3680043.9.1000.2";

// A real pipeline would read these bytes from actual CT/MR files on disk instead.
const sliceBytes = Array.from({ length: 32 }, (_, i) =>
  writeCTSlice({
    sopInstanceUID: `1.2.826.0.1.3680043.9.1000.3.${i}`,
    seriesInstanceUID: SERIES_INSTANCE_UID,
    frameOfReferenceUID: FRAME_OF_REFERENCE_UID,
    rows: 64,
    columns: 64,
    pixelSpacing: [1, 1],
    rowDirection: ROW_DIRECTION,
    columnDirection: COLUMN_DIRECTION,
    imagePositionPatient: [0, 0, i], // 1mm slice spacing
  }),
);

const { geometry, diagnostics } = readSeriesGeometry(sliceBytes);

console.log("grid: rows/columns", geometry.grid.rows, geometry.grid.columns);
console.log("grid: plane count", geometry.grid.planes.length);
console.log("series: slice count", geometry.slices.length);
console.log("frameOfReferenceUID:", geometry.frameOfReferenceUID);
console.log("diagnostics:", diagnostics); // [] here — slices were already in order

// The resulting GridGeometry is a normal GridGeometry — everything else works exactly
// as in 02-dicom-roundtrip.ts, just with a geometry sourced from real files instead of
// createUniformGrid().
const mask = spherePhantom(geometry.grid, 10);
const bytes = await RTStruct.createFromMask({ mask, name: "Sphere" });
const rt = await RTStruct.load({ rtstruct: bytes, geometry: geometry.grid });
console.log("round-trip ROI names:", rt.getROINames());

// Order doesn't matter — createGridGeometry always sorts by position, and a reversed
// input is flagged (not silently accepted) via SLICE_ORDER_REVERSED.
const reversed = readSeriesGeometry([...sliceBytes].reverse());
console.log(
  "reversed input diagnostics:",
  reversed.diagnostics.map((d) => `[${d.severity}] ${d.code}: ${d.message}`),
);
