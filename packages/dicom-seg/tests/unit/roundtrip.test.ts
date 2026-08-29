import { describe, expect, it } from "vitest";
import {
  createScalarField,
  createUniformGrid,
  GridMismatchError,
  maskFromDense,
  voxelDisagreement,
  type GridGeometry,
} from "rt-geometry-js";
import { readSeg, writeSeg } from "../../src/index.js";

const grid = (n = 5): GridGeometry =>
  createUniformGrid({ rows: n, columns: n, planeCount: n, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

const maskFrom = (g: GridGeometry, on: (c: number, r: number, k: number) => boolean) => {
  const [cols, rows, planes] = [g.columns, g.rows, g.planes.length];
  const data = new Uint8Array(cols * rows * planes);
  for (let k = 0; k < planes; k++)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (on(c, r, k)) data[k * rows * cols + r * cols + c] = 1;
  return maskFromDense(g, data);
};

describe("writeSeg / readSeg round trip — BINARY", () => {
  it("RT-01 mask -> writeSeg -> readSeg -> mask is voxel-exact, multi-segment", () => {
    const g = grid(6);
    const liver = maskFrom(g, (c, r) => c >= 1 && c <= 4 && r >= 1 && r <= 4);
    const tumor = maskFrom(g, (c, r, k) => c === 2 && r === 2 && k >= 1 && k <= 4);

    const bytes = writeSeg({
      segmentationType: "BINARY",
      segments: [
        { number: 1, label: "Liver", mask: liver },
        { number: 2, label: "Tumor", mask: tumor },
      ],
    });
    const seg = readSeg(bytes);

    expect(seg.type).toBe("BINARY");
    expect(seg.segments().map((s) => s.label)).toEqual(["Liver", "Tumor"]);
    expect(voxelDisagreement(seg.mask(1), liver)).toBe(0);
    expect(voxelDisagreement(seg.mask(2), tumor)).toBe(0);
  });

  it("RT-02 the full grid is preserved even when a segment touches only one plane", () => {
    const g = grid(5);
    const m = maskFrom(g, (c, r, k) => k === 2 && c === 2 && r === 2); // one voxel, plane 2 only
    const seg = readSeg(writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "dot", mask: m }] }));
    expect(seg.geometry.planes.length).toBe(5);
    expect(voxelDisagreement(seg.mask(1), m)).toBe(0);
    expect(seg.mask(1).count()).toBe(1);
  });

  it("RT-03 an all-zero segment is written as empty frames and reads back with count 0", () => {
    const g = grid(4);
    const empty = maskFrom(g, () => false);
    const solid = maskFrom(g, () => true);
    const seg = readSeg(
      writeSeg({
        segmentationType: "BINARY",
        segments: [
          { number: 1, label: "solid", mask: solid },
          { number: 2, label: "empty", mask: empty },
        ],
      }),
    );
    expect(seg.mask(1).count()).toBe(4 * 4 * 4);
    expect(seg.mask(2).count()).toBe(0);
  });

  it("RT-04 segments on different grids are rejected", () => {
    const a = maskFrom(grid(4), () => true);
    const b = maskFrom(createUniformGrid({ rows: 4, columns: 4, planeCount: 4, pixelSpacing: [2, 2], sliceSpacingMm: 1 }), () => true);
    expect(() =>
      writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "a", mask: a }, { number: 2, label: "b", mask: b }] }),
    ).toThrow(GridMismatchError);
  });

  it("RT-05 segment metadata and SegmentsOverlap survive the round trip", () => {
    const g = grid(4);
    const m = maskFrom(g, () => true);
    const seg = readSeg(
      writeSeg({
        segmentationType: "BINARY",
        segmentsOverlap: "YES",
        segments: [
          {
            number: 1,
            label: "GTV",
            mask: m,
            algorithmType: "MANUAL",
            category: { value: "M-01000", scheme: "SRT", meaning: "Morphologically Altered Structure" },
            propertyType: { value: "M-8000/3", scheme: "SRT", meaning: "Neoplasm, Primary" },
            trackingId: "lesion-7",
          },
        ],
      }),
    );
    const s = seg.segments()[0]!;
    expect(s.label).toBe("GTV");
    expect(s.algorithmType).toBe("MANUAL");
    expect(s.category?.meaning).toBe("Morphologically Altered Structure");
    expect(s.propertyType?.meaning).toBe("Neoplasm, Primary");
    expect(s.trackingId).toBe("lesion-7");
    expect(seg.segmentsOverlap).toBe("YES");
  });

  it("RT-06 default SegmentsOverlap: NO for one segment, UNDEFINED for more", () => {
    const g = grid(4);
    const m = maskFrom(g, () => true);
    const one = readSeg(writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "a", mask: m }] }));
    expect(one.segmentsOverlap).toBe("NO");
    const two = readSeg(
      writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "a", mask: m }, { number: 2, label: "b", mask: m }] }),
    );
    expect(two.segmentsOverlap).toBe("UNDEFINED");
  });
});

describe("writeSeg / readSeg round trip — FRACTIONAL", () => {
  it("RT-07 a FRACTIONAL SEG without an explicit fractionalType throws", () => {
    const g = grid(4);
    const f = createScalarField(g, () => 0.5);
    expect(() => writeSeg({ segmentationType: "FRACTIONAL", segments: [{ number: 1, label: "p", field: f }] })).toThrow(TypeError);
  });

  it("RT-08 unit-scale field round-trips within the 1/max quantisation", () => {
    const g = grid(4);
    // a probability ramp along k: 0.2, 0.4, 0.6, 0.8
    const src = createScalarField(g, (_c, _r, k) => 0.2 * (k + 1));
    const seg = readSeg(
      writeSeg({
        segmentationType: "FRACTIONAL",
        fractionalType: "PROBABILITY",
        segments: [{ number: 1, label: "p", field: src }],
      }),
    );
    expect(seg.fractionalType).toBe("PROBABILITY");
    const back = seg.field(1);
    for (let k = 0; k < 4; k++) {
      expect(back.get(0, 0, k)).toBeCloseTo(0.2 * (k + 1), 2); // within ~1/255
    }
  });

  it("RT-09 raw-scale field with a custom max round-trips exactly", () => {
    const g = grid(3);
    const raw = createScalarField(g, (_c, _r, k) => 10 * (k + 1)); // 10, 20, 30 (integers, <= 100)
    const seg = readSeg(
      writeSeg({
        segmentationType: "FRACTIONAL",
        fractionalType: "OCCUPANCY",
        maximumFractionalValue: 100,
        fieldScale: "raw",
        segments: [{ number: 1, label: "occ", field: raw }],
      }),
    );
    expect(seg.fractionalType).toBe("OCCUPANCY");
    expect(seg.maximumFractionalValue).toBe(100);
    const rawBack = seg.rawField(1);
    expect(rawBack.get(0, 0, 0)).toBe(10);
    expect(rawBack.get(0, 0, 2)).toBe(30);
    expect(seg.field(1).get(0, 0, 2)).toBeCloseTo(0.3, 6); // 30 / 100
  });

  it("RT-10 rejects an out-of-range maximumFractionalValue", () => {
    const g = grid(3);
    const f = createScalarField(g, () => 0.5);
    expect(() =>
      writeSeg({
        segmentationType: "FRACTIONAL",
        fractionalType: "PROBABILITY",
        maximumFractionalValue: 4096,
        segments: [{ number: 1, label: "p", field: f }],
      }),
    ).toThrow(RangeError);
  });
});
