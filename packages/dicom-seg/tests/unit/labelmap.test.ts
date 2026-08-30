import { describe, expect, it } from "vitest";
import { createUniformGrid, maskFromDense, voxelDisagreement, type GridGeometry } from "rt-geometry-js";
import { readSeg, writeSeg } from "../../src/index.js";
import { LabelmapOverlapError, SegmentationTypeMismatchError } from "../../src/errors.js";

const grid = (n = 6): GridGeometry =>
  createUniformGrid({ rows: n, columns: n, planeCount: n, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

const maskFrom = (g: GridGeometry, on: (c: number, r: number, k: number) => boolean) => {
  const [cols, rows, planes] = [g.columns, g.rows, g.planes.length];
  const data = new Uint8Array(cols * rows * planes);
  for (let k = 0; k < planes; k++)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (on(c, r, k)) data[k * rows * cols + r * cols + c] = 1;
  return maskFromDense(g, data);
};

describe("LABELMAP write / read round trip", () => {
  it("LM-01 a 3-segment partition round-trips voxel-exact, type is LABELMAP", () => {
    const g = grid(6);
    const a = maskFrom(g, (c) => c <= 1);
    const b = maskFrom(g, (c) => c >= 2 && c <= 3);
    const c3 = maskFrom(g, (c) => c >= 4);

    const seg = readSeg(
      writeSeg({
        segmentationType: "LABELMAP",
        segments: [
          { number: 1, label: "left", mask: a },
          { number: 2, label: "mid", mask: b },
          { number: 3, label: "right", mask: c3 },
        ],
      }),
    );

    expect(seg.type).toBe("LABELMAP");
    expect(seg.segments().map((s) => s.label)).toEqual(["left", "mid", "right"]);
    expect(voxelDisagreement(seg.mask(1), a)).toBe(0);
    expect(voxelDisagreement(seg.mask(2), b)).toBe(0);
    expect(voxelDisagreement(seg.mask(3), c3)).toBe(0);
    expect(seg.geometry.planes.length).toBe(6);
  });

  it("LM-02 overlapping input masks are rejected", () => {
    const g = grid(4);
    const a = maskFrom(g, (c) => c <= 2);
    const b = maskFrom(g, (c) => c >= 2); // overlaps at c === 2
    expect(() =>
      writeSeg({ segmentationType: "LABELMAP", segments: [{ number: 1, label: "a", mask: a }, { number: 2, label: "b", mask: b }] }),
    ).toThrow(LabelmapOverlapError);
  });

  it("LM-03 field() throws on a LABELMAP", () => {
    const g = grid(4);
    const seg = readSeg(
      writeSeg({ segmentationType: "LABELMAP", segments: [{ number: 1, label: "x", mask: maskFrom(g, (c) => c === 0) }] }),
    );
    expect(() => seg.field(1)).toThrow(SegmentationTypeMismatchError);
    expect(() => seg.field(1)).toThrow(/LABELMAP/);
  });

  it("LM-04 segment numbers above 255 use 16-bit pixels and still round-trip", () => {
    const g = grid(5);
    const a = maskFrom(g, (c) => c <= 1);
    const b = maskFrom(g, (c) => c >= 3);
    const seg = readSeg(
      writeSeg({
        segmentationType: "LABELMAP",
        segments: [
          { number: 300, label: "a", mask: a },
          { number: 1000, label: "b", mask: b },
        ],
      }),
    );
    expect(voxelDisagreement(seg.mask(300), a)).toBe(0);
    expect(voxelDisagreement(seg.mask(1000), b)).toBe(0);
    expect(seg.mask(300).count()).toBe(a.count());
  });

  it("LM-05 mask(n) for an unlabelled number is empty, not an error", () => {
    const g = grid(4);
    const seg = readSeg(
      writeSeg({ segmentationType: "LABELMAP", segments: [{ number: 1, label: "x", mask: maskFrom(g, (c) => c === 0) }] }),
    );
    expect(seg.hasSegment(1)).toBe(true);
    expect(seg.mask(1).count()).toBeGreaterThan(0);
  });
});

describe("sparse frame coverage (BINARY / FRACTIONAL)", () => {
  it("SPARSE-01 sparse writes only populated planes; content is preserved, empty-plane extent is not", () => {
    const g = grid(6);
    const m = maskFrom(g, (c, r, k) => (k === 1 || k === 4) && c === 3 && r === 3); // two populated planes

    const full = readSeg(writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "d", mask: m }] }));
    const sparse = readSeg(
      writeSeg({ segmentationType: "BINARY", frameCoverage: "sparse", segments: [{ number: 1, label: "d", mask: m }] }),
    );

    // full preserves the whole grid and is voxel-exact
    expect(full.numberOfFrames).toBe(6);
    expect(voxelDisagreement(full.mask(1), m)).toBe(0);

    // sparse omits the 4 empty planes — its grid spans only the 2 populated ones, but the
    // marked-voxel count survives
    expect(sparse.numberOfFrames).toBe(2);
    expect(sparse.geometry.planes.length).toBe(2);
    expect(sparse.mask(1).count()).toBe(m.count());
  });

  it("SPARSE-02 an all-empty segment under sparse throws rather than writing nothing", () => {
    const g = grid(4);
    const empty = maskFromDense(g, new Uint8Array(g.columns * g.rows * g.planes.length));
    expect(() =>
      writeSeg({ segmentationType: "BINARY", frameCoverage: "sparse", segments: [{ number: 1, label: "e", mask: empty }] }),
    ).toThrow(RangeError);
  });

  it("SPARSE-03 default coverage is still \"full\" (exact identity, every plane a frame)", () => {
    const g = grid(5);
    const m = maskFrom(g, (c, r, k) => k === 0);
    const seg = readSeg(writeSeg({ segmentationType: "BINARY", segments: [{ number: 1, label: "s", mask: m }] }));
    expect(seg.numberOfFrames).toBe(5);
    expect(voxelDisagreement(seg.mask(1), m)).toBe(0);
  });
});
