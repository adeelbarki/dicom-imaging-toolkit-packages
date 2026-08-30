import { bench, describe } from "vitest";
import { maskFromDense } from "rt-geometry-js";
import { DoseGrid } from "../src/dose-grid.js";
import { doseFixtureFromGy } from "../tests/fixtures.js";

// A realistic-ish dose grid: 128 × 128 × 80 ≈ 1.3M voxels at ~2.5 mm, an ellipsoidal
// high-dose region. The structure mask is on the same grid (no resample) so this measures
// the DVH arithmetic itself — parse + histogram + Dx/Vd. When dose and structure grids
// differ, add the resampleField cost from rt-geometry-js's bench.
const ROWS = 128;
const COLS = 128;
const FRAMES = 80;

const bytes = doseFixtureFromGy({
  rows: ROWS,
  columns: COLS,
  frameOffsets: Array.from({ length: FRAMES }, (_, i) => i * 2.5),
  pixelSpacing: [2.5, 2.5],
  gy: (c, r, f) => {
    const d = ((c - 64) / 40) ** 2 + ((r - 64) / 40) ** 2 + ((f - 40) / 24) ** 2;
    return d >= 1 ? 0 : 60 * (1 - d);
  },
});

const dose = DoseGrid.fromDicom(bytes);

// PTV = the inner ellipsoid; ~200k voxels.
const maskData = new Uint8Array(ROWS * COLS * FRAMES);
for (let f = 0; f < FRAMES; f++) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = ((c - 64) / 28) ** 2 + ((r - 64) / 28) ** 2 + ((f - 40) / 16) ** 2;
      if (d < 1) maskData[f * ROWS * COLS + r * COLS + c] = 1;
    }
  }
}
const ptv = maskFromDense(dose.geometry, maskData);

describe("DVH engine (dose grid == structure grid, 128²×80)", () => {
  bench("parse RTDOSE bytes → DoseGrid", () => {
    DoseGrid.fromDicom(bytes);
  });
  bench("calculateDVH(ptv, 256 bins)", () => {
    dose.calculateDVH(ptv, { bins: 256 });
  });
  bench("getD(95, ptv)", () => {
    dose.getD(95, ptv);
  });
  bench("getV(20, ptv)", () => {
    dose.getV(20, ptv);
  });
  bench("statistics(ptv)", () => {
    dose.statistics(ptv);
  });
});
