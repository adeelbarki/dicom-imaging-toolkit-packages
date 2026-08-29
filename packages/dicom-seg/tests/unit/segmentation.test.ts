import { describe, expect, it } from "vitest";
import { meanValue, thresholdSensitivity, volumeAboveThreshold } from "rt-geometry-js";
import { readSeg } from "../../src/index.js";
import { SegmentationTypeMismatchError } from "../../src/errors.js";
import { binarySeg, fractionalSeg } from "../fixtures.js";

describe("Segmentation — BINARY", () => {
  // seg 1: 2×2 block (columns 0-1, rows 0-1) on every plane; seg 2: single voxel (1,1).
  const seg = () =>
    readSeg(
      binarySeg({
        rows: 4,
        columns: 4,
        planeCount: 3,
        segments: [1, 2],
        on: (s, c, r) => (s === 1 ? c < 2 && r < 2 : c === 1 && r === 1),
      }),
    );

  it("SEG-01 lists segments with labels", () => {
    const s = seg();
    expect(s.type).toBe("BINARY");
    expect(s.segments().map((x) => [x.number, x.label])).toEqual([
      [1, "seg-1"],
      [2, "seg-2"],
    ]);
  });

  it("SEG-02 mask(n) assembles the frames for that segment onto the SEG grid", () => {
    const s = seg();
    const m1 = s.mask(1);
    expect(m1.dimensions).toEqual([4, 4, 3]);
    expect(m1.count()).toBe(2 * 2 * 3); // 4 voxels/plane × 3 planes
    expect(m1.get(0, 0, 0)).toBe(true);
    expect(m1.get(2, 2, 0)).toBe(false);

    const m2 = s.mask(2);
    expect(m2.count()).toBe(3); // one voxel per plane
    expect(m2.get(1, 1, 2)).toBe(true);
  });

  it("SEG-03 field() on a BINARY SEG throws", () => {
    expect(() => seg().field(1)).toThrow(SegmentationTypeMismatchError);
  });

  it("SEG-04 unknown segment number throws RangeError", () => {
    expect(() => seg().mask(99)).toThrow(RangeError);
  });

  it("SEG-05 support(n) equals mask(n) for BINARY", () => {
    const s = seg();
    expect(s.support(1).count()).toBe(s.mask(1).count());
  });
});

describe("Segmentation — FRACTIONAL", () => {
  // probability ramp: stored value = 25 * (k+1) on every voxel of plane k (k=0..3) -> 50,100,150,200
  const seg = () =>
    readSeg(
      fractionalSeg({
        rows: 2,
        columns: 2,
        planeCount: 4,
        segments: [1],
        max: 200,
        value: (_s, _c, _r, k) => 50 * (k + 1),
      }),
    );

  it("SEG-06 field() rescales stored integers by MaximumFractionalValue", () => {
    const f = seg().field(1);
    expect(f.get(0, 0, 0)).toBeCloseTo(50 / 200, 6); // 0.25
    expect(f.get(1, 1, 3)).toBeCloseTo(200 / 200, 6); // 1.0
  });

  it("SEG-07 rawField() returns the unscaled integers", () => {
    const r = seg().rawField(1);
    expect(r.get(0, 0, 0)).toBe(50);
    expect(r.get(0, 0, 3)).toBe(200);
  });

  it("SEG-08 mask() on a FRACTIONAL SEG throws", () => {
    expect(() => seg().mask(1)).toThrow(SegmentationTypeMismatchError);
  });

  it("SEG-09 honest metrics compose over field() + support()", () => {
    const s = seg();
    const field = s.field(1);
    const support = s.support(1); // all 16 voxels have value > 0
    expect(support.count()).toBe(16);
    // mean of [0.25, 0.5, 0.75, 1.0] over equal-volume voxels
    expect(meanValue(field, support)).toBeCloseTo(0.625, 6);
    // volume with confidence >= 0.75: planes k=2,3 -> 8 voxels; grid is unit -> 8 mm³
    expect(volumeAboveThreshold(field, support, 0.75)).toBeCloseTo(8, 6);
    const sens = thresholdSensitivity(field, support, [0.9, 0.4]);
    expect(sens.map((p) => p.threshold)).toEqual([0.4, 0.9]);
    expect(sens[0]?.volumeFraction).toBeCloseTo(0.75, 6); // >= 0.4 -> planes 1,2,3
    expect(sens[1]?.volumeFraction).toBeCloseTo(0.25, 6); // >= 0.9 -> plane 3 only
  });

  it("SEG-10 sampleConfidence interpolates the field at a physical point", () => {
    // plane positions z = 0,1,2,3; value(k) = 0.25*(k+1). Midway between planes 0 and 1 -> 0.375.
    const v = seg().sampleConfidence(1, [0.5, 0.5, 0.5]);
    expect(v).toBeCloseTo(0.375, 6);
  });
});
