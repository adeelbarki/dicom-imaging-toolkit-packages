import { describe, expect, it } from "vitest";
import { writeCTSlice } from "../../src/dicom/port.js";
import { readSeriesGeometry } from "../../src/dicom/series-geometry.js";
import type { Vec3 } from "rt-geometry-js";

/**
 * New functionality added after the original v0.1 spec (44 GEO/MSK/VOL/CTR/RT/IO/SEC
 * tests) — SeriesGeometry construction from real DICOM files, not part of that fixed
 * contract. Named descriptively rather than with a fake spec ID.
 */
const AXIAL_ROW: Vec3 = [1, 0, 0];
const AXIAL_COLUMN: Vec3 = [0, 1, 0];
const SERIES_UID = "1.2.3.999";
const FRAME_OF_REFERENCE_UID = "1.2.3.888";

function buildSeries(zPositions: readonly number[], pixelSpacing: readonly [number, number] = [1, 1]): ArrayBuffer[] {
  return zPositions.map((z, i) =>
    writeCTSlice({
      sopInstanceUID: `1.2.3.${i}`,
      seriesInstanceUID: SERIES_UID,
      frameOfReferenceUID: FRAME_OF_REFERENCE_UID,
      rows: 16,
      columns: 16,
      pixelSpacing,
      rowDirection: AXIAL_ROW,
      columnDirection: AXIAL_COLUMN,
      imagePositionPatient: [0, 0, z],
    }),
  );
}

describe("readSeriesGeometry: building a grid from real CT/MR slice files", () => {
  it("a consistent multi-slice series builds the expected grid", () => {
    const { geometry, diagnostics } = readSeriesGeometry(buildSeries([0, 1, 2]));

    expect(geometry.grid.rows).toBe(16);
    expect(geometry.grid.columns).toBe(16);
    expect(geometry.grid.pixelSpacing).toEqual([1, 1]);
    expect(geometry.grid.planes.map((p) => p.position[2])).toEqual([0, 1, 2]);
    expect(geometry.slices).toHaveLength(3);
    expect(geometry.frameOfReferenceUID).toBe(FRAME_OF_REFERENCE_UID);
    expect(diagnostics).toEqual([]);
  });

  it("reversed input order is sorted correctly and flagged with a diagnostic", () => {
    const { geometry, diagnostics } = readSeriesGeometry(buildSeries([2, 1, 0]));

    expect(geometry.grid.planes.map((p) => p.position[2])).toEqual([0, 1, 2]);
    const flag = diagnostics.find((d) => d.code === "SLICE_ORDER_REVERSED");
    expect(flag?.severity).toBe("info");
  });

  it("mismatched PixelSpacing across instances throws", () => {
    const a = writeCTSlice({
      sopInstanceUID: "1.2.3.0",
      rows: 16,
      columns: 16,
      pixelSpacing: [1, 1],
      rowDirection: AXIAL_ROW,
      columnDirection: AXIAL_COLUMN,
      imagePositionPatient: [0, 0, 0],
    });
    const b = writeCTSlice({
      sopInstanceUID: "1.2.3.1",
      rows: 16,
      columns: 16,
      pixelSpacing: [2, 2],
      rowDirection: AXIAL_ROW,
      columnDirection: AXIAL_COLUMN,
      imagePositionPatient: [0, 0, 1],
    });
    expect(() => readSeriesGeometry([a, b])).toThrowError(/InconsistentSeriesError/i);
  });

  it("a single-instance series still works", () => {
    const { geometry, diagnostics } = readSeriesGeometry(buildSeries([5]));

    expect(geometry.grid.planes).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });
});
