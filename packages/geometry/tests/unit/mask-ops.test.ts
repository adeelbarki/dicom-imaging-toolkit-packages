import { describe, expect, it } from "vitest";
import { createGridGeometry, createUniformGrid } from "../../src/grid-geometry.js";
import { maskFromDense } from "../../src/mask3d.js";
import { cubePhantom } from "../../src/phantom.js";
import { GridMismatchError } from "../../src/errors.js";
import {
  boundingBox,
  complement,
  crop,
  intersection,
  pad,
  subtract,
  union,
  xor,
} from "../../src/mask-ops.js";

/** 4×4×3 grid, 1 mm isotropic in-plane, 2 mm planes. */
const grid = () =>
  createUniformGrid({ rows: 4, columns: 4, planeCount: 3, pixelSpacing: [1, 1], sliceSpacingMm: 2 });

/** Set the given [c,r,k] voxels on a fresh grid mask. */
function mask(points: ReadonlyArray<readonly [number, number, number]>, g = grid()) {
  const data = new Uint8Array(g.columns * g.rows * g.planes.length);
  for (const [c, r, k] of points) data[k * g.columns * g.rows + r * g.columns + c] = 1;
  return maskFromDense(g, data);
}

function setVoxels(m: ReturnType<typeof mask>): Array<[number, number, number]> {
  const [columns, rows, planes] = m.dimensions;
  const out: Array<[number, number, number]> = [];
  for (let k = 0; k < planes; k++) {
    const s = m.getSliceBuffer(k);
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) if (s[r * columns + c]) out.push([c, r, k]);
  }
  return out;
}

describe("MASKOP: boolean operations", () => {
  const g = grid();
  const a = mask([[0, 0, 0], [1, 0, 0], [1, 1, 0]], g);
  const b = mask([[1, 1, 0], [2, 1, 0], [2, 2, 0]], g);

  it("MASKOP-01 union is a ∪ b", () => {
    expect(new Set(setVoxels(union(a, b)).map(String))).toEqual(
      new Set([[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]].map(String)),
    );
    expect(union(a, b).count()).toBe(5);
  });

  it("MASKOP-02 intersection is a ∩ b", () => {
    expect(setVoxels(intersection(a, b))).toEqual([[1, 1, 0]]);
  });

  it("MASKOP-03 subtract is a \\ b", () => {
    expect(new Set(setVoxels(subtract(a, b)).map(String))).toEqual(new Set([[0, 0, 0], [1, 0, 0]].map(String)));
  });

  it("MASKOP-04 xor is the symmetric difference", () => {
    expect(new Set(setVoxels(xor(a, b)).map(String))).toEqual(
      new Set([[0, 0, 0], [1, 0, 0], [2, 1, 0], [2, 2, 0]].map(String)),
    );
    expect(xor(a, b).count()).toBe(union(a, b).count() - intersection(a, b).count());
  });

  it("MASKOP-05 complement flips every voxel and is its own inverse", () => {
    const total = g.columns * g.rows * g.planes.length;
    expect(complement(a).count()).toBe(total - a.count());
    expect(complement(complement(a)).count()).toBe(a.count());
  });

  it("MASKOP-06 identities on cube phantoms", () => {
    const big = cubePhantom(grid(), 3);
    const small = cubePhantom(grid(), 1);
    expect(union(big, big).count()).toBe(big.count());
    expect(intersection(big, small).count()).toBe(small.count()); // small ⊂ big
    expect(subtract(big, big).count()).toBe(0);
    expect(subtract(small, big).count()).toBe(0);
  });

  it("MASKOP-07 rejects masks on different grids", () => {
    const other = mask([[0, 0, 0]], createUniformGrid({ rows: 4, columns: 4, planeCount: 3, pixelSpacing: [2, 2], sliceSpacingMm: 2 }));
    expect(() => union(a, other)).toThrow(GridMismatchError);
    expect(() => intersection(a, other)).toThrow(GridMismatchError);
  });
});

describe("MASKOP: boundingBox", () => {
  it("MASKOP-08 tight inclusive index box of the set voxels", () => {
    const m = mask([[1, 2, 0], [3, 1, 2]]);
    expect(boundingBox(m)).toEqual({ min: [1, 1, 0], max: [3, 2, 2] });
  });

  it("MASKOP-09 null for an empty mask", () => {
    expect(boundingBox(mask([]))).toBeNull();
  });

  it("MASKOP-10 single voxel → min === max", () => {
    expect(boundingBox(mask([[2, 2, 1]]))).toEqual({ min: [2, 2, 1], max: [2, 2, 1] });
  });
});

describe("MASKOP: crop", () => {
  it("MASKOP-11 crop to bounding box preserves every set voxel's physical location", () => {
    const g = grid();
    const m = mask([[1, 1, 0], [2, 1, 0], [2, 2, 1]], g);
    const cropped = crop(m);
    expect(cropped.dimensions).toEqual([2, 2, 2]); // columns 1..2, rows 1..2, planes 0..1
    expect(cropped.count()).toBe(3);
    // the voxel that was at grid index (2,2,1) sits at the same patient point after crop
    const before = g.indexToPatient(2, 2, 1);
    const after = cropped.geometry.indexToPatient(1, 1, 1);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i]!, 9);
  });

  it("MASKOP-12 crop with an explicit box", () => {
    const m = cubePhantom(grid(), 2);
    const c = crop(m, { min: [0, 0, 0], max: [1, 1, 0] });
    expect(c.dimensions).toEqual([2, 2, 1]);
  });

  it("MASKOP-13 crop keeps voxel count and shrinks every axis to the occupied span", () => {
    const g = grid();
    const m = mask([[1, 1, 0], [2, 1, 1], [2, 2, 2]], g);
    const c = crop(m);
    expect(c.dimensions).toEqual([2, 2, 3]); // columns 1..2, rows 1..2, planes 0..2
    expect(c.count()).toBe(3);
    // re-pad in-plane and the mask still holds the same 3 voxels
    const restored = pad(c, [1, 1, 0]);
    expect(restored.dimensions).toEqual([4, 4, 3]);
    expect(restored.count()).toBe(3);
  });

  it("MASKOP-14 cropping an empty mask with no box throws", () => {
    expect(() => crop(mask([]))).toThrow(RangeError);
  });

  it("MASKOP-15 out-of-range or inverted box throws", () => {
    const m = cubePhantom(grid(), 2);
    expect(() => crop(m, { min: [0, 0, 0], max: [9, 1, 0] })).toThrow(RangeError);
    expect(() => crop(m, { min: [2, 0, 0], max: [1, 1, 0] })).toThrow(RangeError);
  });
});

describe("MASKOP: pad", () => {
  it("MASKOP-16 grows the grid symmetrically and centres the mask", () => {
    const g = grid();
    const m = mask([[0, 0, 0], [3, 3, 2]], g);
    const p = pad(m, 1);
    expect(p.dimensions).toEqual([6, 6, 5]);
    expect(p.count()).toBe(2);
    // corner voxel moved from (0,0,0) to (1,1,1) in the padded grid, same patient point
    const before = g.indexToPatient(0, 0, 0);
    const after = p.geometry.indexToPatient(1, 1, 1);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i]!, 9);
  });

  it("MASKOP-17 per-axis margins", () => {
    const p = pad(cubePhantom(grid(), 2), [2, 1, 0]);
    expect(p.dimensions).toEqual([4 + 4, 4 + 2, 3]);
  });

  it("MASKOP-18 plane padding on a non-uniform grid throws (in-plane padding still allowed)", () => {
    const nonUniform = createGridGeometry({
      rows: 4,
      columns: 4,
      rowDirection: [1, 0, 0],
      columnDirection: [0, 1, 0],
      pixelSpacing: [1, 1],
      planePositions: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 0, 5],
      ],
    });
    const m = maskFromDense(nonUniform, new Uint8Array(4 * 4 * 3));
    expect(() => pad(m, [0, 0, 1])).toThrow(RangeError);
    expect(() => pad(m, [1, 1, 0])).not.toThrow();
  });

  it("MASKOP-19 negative or non-integer margin throws", () => {
    const m = cubePhantom(grid(), 2);
    expect(() => pad(m, -1)).toThrow(RangeError);
    expect(() => pad(m, [1, 0.5, 0])).toThrow(RangeError);
  });
});
