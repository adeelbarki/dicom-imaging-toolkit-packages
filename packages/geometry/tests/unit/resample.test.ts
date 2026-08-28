import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { createGridGeometry } from "../../src/grid-geometry.js";
import { maskFromDense } from "../../src/mask3d.js";
import { createScalarField } from "../../src/scalar-field.js";
import { resampleField, resampleMask, sampleFieldAt } from "../../src/resample.js";
import { FrameOfReferenceMismatchError } from "../../src/errors.js";
import type { Vec3 } from "../../src/types.js";

// indexToPatient(c, r, k) == [c, r, k] on this grid (unit spacing, identity orientation).
const unitGrid = (n = 8) =>
  createUniformGrid({ rows: n, columns: n, planeCount: n, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

// f(x, y, z) = x + 10y + 100z — linear, so trilinear interpolation is exact.
const ramp = (n = 8) => createScalarField(unitGrid(n), (c, r, k) => c + 10 * r + 100 * k);

describe("RS: sampleFieldAt", () => {
  it("RS-01 trilinear recovers a linear field exactly at fractional points", () => {
    const f = ramp();
    for (const p of [
      [2.5, 3.5, 1.5],
      [0.25, 6.75, 4.1],
      [5, 5, 5],
    ] as Vec3[]) {
      expect(sampleFieldAt(f, p)).toBeCloseTo(p[0] + 10 * p[1] + 100 * p[2], 10);
    }
  });

  it("RS-02 nearest returns the containing voxel value", () => {
    const f = ramp();
    expect(sampleFieldAt(f, [2.4, 3.6, 1.5], { method: "nearest" })).toBe(2 + 10 * 4 + 100 * 2);
  });

  it("RS-03 a point outside the extent returns outOfBounds (default 0, or the given value)", () => {
    const f = ramp();
    expect(sampleFieldAt(f, [-5, 3, 3])).toBe(0);
    expect(sampleFieldAt(f, [3, 3, 999])).toBe(0);
    expect(sampleFieldAt(f, [-5, 3, 3], { outOfBounds: -1 })).toBe(-1);
  });

  it("RS-04 a point within half a voxel of an edge is clamped, not dropped", () => {
    const f = ramp(4);
    // column index 3.4 is past the last voxel (3) but within 0.5 — clamp to the edge value
    expect(sampleFieldAt(f, [3.4, 1, 1], { method: "nearest" })).toBe(3 + 10 + 100);
  });
});

describe("RS: resampleField", () => {
  it("RS-05 resampling a linear field onto a shifted grid reproduces it exactly (interior)", () => {
    const src = ramp(8);
    const target = createUniformGrid({
      rows: 6, columns: 6, planeCount: 6, pixelSpacing: [1, 1], sliceSpacingMm: 1,
      origin: [0.5, 0.5, 0.5] as Vec3,
    });
    const out = resampleField(src, target);
    for (let k = 0; k < 6; k++) {
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          const [x, y, z] = target.indexToPatient(c, r, k);
          expect(out.get(c, r, k)).toBeCloseTo(x! + 10 * y! + 100 * z!, 9);
        }
      }
    }
  });

  it("RS-06 resampling onto the same geometry is an identity at integer coordinates", () => {
    const src = ramp(5);
    const out = resampleField(src, src.geometry);
    for (let k = 0; k < 5; k++)
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++) expect(out.get(c, r, k)).toBeCloseTo(src.get(c, r, k), 10);
  });

  it("RS-07 refuses to resample across declared frames of reference", () => {
    const a = createScalarField(
      createUniformGrid({ rows: 4, columns: 4, planeCount: 4, pixelSpacing: [1, 1], sliceSpacingMm: 1, frameOfReferenceUID: "1.2.3" }),
      () => 1,
    );
    const bGrid = createUniformGrid({
      rows: 4, columns: 4, planeCount: 4, pixelSpacing: [1, 1], sliceSpacingMm: 1, frameOfReferenceUID: "9.9.9",
    });
    expect(() => resampleField(a, bGrid)).toThrow(FrameOfReferenceMismatchError);
  });

  it("RS-08 irregular source plane spacing interpolates by projected position, not pitch", () => {
    // planes at z = 0, 1, 5 — a point at z = 3 sits halfway (by distance) between planes 1 and 2
    const g = createGridGeometry({
      rows: 2, columns: 2, rowDirection: [1, 0, 0], columnDirection: [0, 1, 0], pixelSpacing: [1, 1],
      planePositions: [[0, 0, 0], [0, 0, 1], [0, 0, 5]] as Vec3[],
    });
    const f = createScalarField(g, (_c, _r, k) => [10, 20, 60][k] as number); // 10, 20, 60
    expect(sampleFieldAt(f, [0, 0, 3])).toBeCloseTo(40, 10); // halfway between 20 and 60
  });
});

describe("RS: resampleMask", () => {
  it("RS-09 nearest-voxel membership is preserved at coincident points", () => {
    const g = unitGrid(6);
    const data = new Uint8Array(6 * 6 * 6);
    for (let k = 1; k <= 3; k++)
      for (let r = 1; r <= 3; r++)
        for (let c = 1; c <= 3; c++) data[k * 36 + r * 6 + c] = 1;
    const src = maskFromDense(g, data);

    // same grid -> exact copy
    const same = resampleMask(src, g);
    let disagree = 0;
    for (let i = 0; i < data.length; i++) if ((same.getSliceBuffer(Math.floor(i / 36))[i % 36] ?? 0) !== data[i]) disagree++;
    expect(disagree).toBe(0);
    expect(same.count()).toBe(27);
  });

  it("RS-10 a mask resampled onto a coarser grid keeps the voxels whose centres land inside", () => {
    const src = (() => {
      const g = unitGrid(8);
      const d = new Uint8Array(8 * 8 * 8).fill(1); // fully solid
      return maskFromDense(g, d);
    })();
    const coarse = createUniformGrid({ rows: 3, columns: 3, planeCount: 3, pixelSpacing: [2, 2], sliceSpacingMm: 2, origin: [1, 1, 1] as Vec3 });
    const out = resampleMask(src, coarse);
    expect(out.count()).toBe(27); // every coarse centre (1,3,5) lands inside the solid 0..7 block
  });
});
