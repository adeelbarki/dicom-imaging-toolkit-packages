import { describe, expect, it } from "vitest";
import { createUniformGrid, maskFromDense, voxelDisagreement, type Mask3D } from "rt-geometry-js";
import { rasterize } from "../../src/contour/rasterize.js";
import { vectorize } from "../../src/contour/vectorize.js";

/**
 * TOPO — exact mask -> contour -> mask identity for binary shapes with no sub-voxel
 * curvature. The existing phantom round-trips (roundtrip.test.ts) use Dice thresholds
 * because spheres/tori are genuinely curved; these lock `voxelDisagreement() === 0`,
 * a strictly stronger regression check, on the shape classes deliberately deferred in
 * the phantom-review round.
 */
const grid = (rows: number, columns: number) =>
  createUniformGrid({ rows, columns, planeCount: 1, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

/** Build a single-plane mask from a row-major 2D pattern (1 = filled). */
function maskFromPattern(pattern: readonly (readonly number[])[]): Mask3D {
  const rows = pattern.length;
  const columns = (pattern[0] ?? []).length;
  const data = new Uint8Array(rows * columns);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (pattern[r]?.[c]) data[r * columns + c] = 1;
    }
  }
  return maskFromDense(grid(rows, columns), data);
}

/** rasterize(vectorize(mask)) must reproduce mask exactly. */
function roundTripsExactly(mask: Mask3D): number {
  const back = rasterize(vectorize(mask), mask.geometry).mask;
  return voxelDisagreement(mask, back);
}

const O = 0;
const X = 1;

describe("TOPO: canonical binary shapes round-trip with zero voxel disagreement", () => {
  it("TOPO-01 single voxel", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [O, O, O, O],
          [O, X, O, O],
          [O, O, O, O],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-02 solid rectangle", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [O, O, O, O, O],
          [O, X, X, X, O],
          [O, X, X, X, O],
          [O, O, O, O, O],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-03 two disconnected islands", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [X, X, O, O, O],
          [X, X, O, O, O],
          [O, O, O, X, X],
          [O, O, O, X, X],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-04 island inside a hole (nested, even-odd)", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [X, X, X, X, X],
          [X, O, O, O, X],
          [X, O, X, O, X],
          [X, O, O, O, X],
          [X, X, X, X, X],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-05 checkerboard (every filled voxel is a diagonal-only touch)", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [X, O, X, O],
          [O, X, O, X],
          [X, O, X, O],
          [O, X, O, X],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-06 thin one-voxel-wide structures (horizontal and vertical)", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [O, O, O, O, O, O],
          [X, X, X, X, X, O],
          [O, O, O, O, O, O],
          [O, O, X, O, O, O],
          [O, O, X, O, O, O],
          [O, O, X, O, O, O],
        ]),
      ),
    ).toBe(0);
  });

  it("TOPO-07 structure flush against the image border", () => {
    expect(
      roundTripsExactly(
        maskFromPattern([
          [X, X, X, O],
          [X, X, X, O],
          [O, O, O, O],
          [O, O, O, X],
        ]),
      ),
    ).toBe(0);
  });
});
