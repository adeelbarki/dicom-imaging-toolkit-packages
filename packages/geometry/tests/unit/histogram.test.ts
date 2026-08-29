import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { maskFromDense } from "../../src/mask3d.js";
import { createScalarField } from "../../src/scalar-field.js";
import {
  histogram,
  meanValue,
  thresholdSensitivity,
  valueAtVolumeFraction,
  volumeAboveThreshold,
} from "../../src/histogram.js";
import { GridMismatchError } from "../../src/errors.js";

// 2x2x2 unit grid: 8 voxels, each exactly 1 mm^3.
const grid = () =>
  createUniformGrid({ rows: 2, columns: 2, planeCount: 2, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
const fullMask = (g = grid()) => maskFromDense(g, new Uint8Array(8).fill(1));
// values 1..8, one per voxel
const ramp = (g = grid()) => createScalarField(g, Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]));

describe("HIST: histogram()", () => {
  it("HIST-01 buckets the masked field; counts and volumes are conserved", () => {
    const g = grid();
    const h = histogram(ramp(g), fullMask(g), { bins: 4 });
    expect(h.min).toBe(1);
    expect(h.max).toBe(8);
    expect(h.binEdges).toHaveLength(5);
    expect(h.counts).toEqual([2, 2, 2, 2]);
    expect(h.volumesMm3).toEqual([2, 2, 2, 2]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(8);
    expect(h.volumesMm3.reduce((a, b) => a + b, 0)).toBe(h.totalVolumeMm3);
    expect(h.totalVolumeMm3).toBe(8);
  });

  it("HIST-02 values outside an explicit range are clamped into the edge bins, not dropped", () => {
    const g = grid();
    const h = histogram(ramp(g), fullMask(g), { bins: 2, min: 3, max: 6 });
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(8);
    expect(h.volumesMm3.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("HIST-03 rejects a non-positive or non-integer bin count", () => {
    expect(() => histogram(ramp(), fullMask(), { bins: 0 })).toThrow(RangeError);
    expect(() => histogram(ramp(), fullMask(), { bins: 2.5 })).toThrow(RangeError);
  });

  it("HIST-04 throws GridMismatchError when field and mask are on different grids", () => {
    const fieldGrid = grid();
    const otherGrid = createUniformGrid({
      rows: 2, columns: 2, planeCount: 2, pixelSpacing: [2, 2], sliceSpacingMm: 1,
    });
    expect(() => histogram(ramp(fieldGrid), fullMask(otherGrid), { bins: 4 })).toThrow(GridMismatchError);
  });
});

describe("HIST: volumeAboveThreshold() — the DVH V(x) query", () => {
  it("HIST-05 sums the voxel volume at or above the threshold", () => {
    const g = grid();
    // values >= 5 are {5,6,7,8} -> 4 voxels -> 4 mm^3
    expect(volumeAboveThreshold(ramp(g), fullMask(g), 5)).toBe(4);
    expect(volumeAboveThreshold(ramp(g), fullMask(g), 8)).toBe(1);
    expect(volumeAboveThreshold(ramp(g), fullMask(g), 9)).toBe(0);
  });
});

describe("HIST: valueAtVolumeFraction() — the DVH D(x) query", () => {
  it("HIST-06 fraction 0 returns the maximum value, fraction 1 the minimum", () => {
    const g = grid();
    expect(valueAtVolumeFraction(ramp(g), fullMask(g), 0)).toBe(8);
    expect(valueAtVolumeFraction(ramp(g), fullMask(g), 1)).toBe(1);
  });

  it("HIST-07 D50 on a uniform 1..8 ramp is the value covering half the volume", () => {
    const g = grid();
    // sorted desc [8,7,6,5,4,3,2,1]; target 0.5*8 = 4; cumulative reaches 4 at value 5
    expect(valueAtVolumeFraction(ramp(g), fullMask(g), 0.5)).toBe(5);
  });

  it("HIST-08 rejects an out-of-range fraction and an empty mask", () => {
    const g = grid();
    expect(() => valueAtVolumeFraction(ramp(g), fullMask(g), -0.1)).toThrow(RangeError);
    expect(() => valueAtVolumeFraction(ramp(g), fullMask(g), 1.5)).toThrow(RangeError);
    const empty = maskFromDense(g, new Uint8Array(8));
    expect(() => valueAtVolumeFraction(ramp(g), empty, 0.5)).toThrow(RangeError);
  });
});

describe("HIST: meanValue()", () => {
  it("HIST-09 volume-weighted mean over the full mask is the plain average here (equal voxels)", () => {
    const g = grid();
    expect(meanValue(ramp(g), fullMask(g))).toBeCloseTo(4.5, 10); // mean of 1..8
  });

  it("HIST-10 restricts to the mask", () => {
    const g = grid();
    // occupy only the voxels holding values 6, 7, 8 (indices 5, 6, 7)
    const mask = maskFromDense(g, Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 1]));
    expect(meanValue(ramp(g), mask)).toBeCloseTo(7, 10);
  });

  it("HIST-11 throws off-grid and on an empty mask", () => {
    const g = grid();
    const other = createUniformGrid({ rows: 2, columns: 2, planeCount: 2, pixelSpacing: [2, 2], sliceSpacingMm: 1 });
    expect(() => meanValue(ramp(g), fullMask(other))).toThrow(GridMismatchError);
    expect(() => meanValue(ramp(g), maskFromDense(g, new Uint8Array(8)))).toThrow(RangeError);
  });
});

describe("HIST: thresholdSensitivity()", () => {
  it("HIST-12 is volumeAboveThreshold sampled across thresholds, ascending", () => {
    const g = grid();
    const pts = thresholdSensitivity(ramp(g), fullMask(g), [8, 5, 1]); // unsorted in
    expect(pts.map((p) => p.threshold)).toEqual([1, 5, 8]);
    expect(pts.map((p) => p.volumeMm3)).toEqual([8, 4, 1]);
    expect(pts.map((p) => p.volumeFraction)).toEqual([1, 0.5, 0.125]);
  });

  it("HIST-13 rejects an empty threshold list and an empty mask", () => {
    const g = grid();
    expect(() => thresholdSensitivity(ramp(g), fullMask(g), [])).toThrow(RangeError);
    expect(() => thresholdSensitivity(ramp(g), maskFromDense(g, new Uint8Array(8)), [1])).toThrow(RangeError);
  });
});
