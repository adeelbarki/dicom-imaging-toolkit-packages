import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { maskFromDense } from "../../src/mask3d.js";
import { cubePhantom, spherePhantom } from "../../src/phantom.js";
import { voxelDisagreement } from "../../src/metrics.js";
import { distanceTransformMm, dilateMm, erodeMm } from "../../src/morphology.js";

/** Isotropic 1 mm grid. */
const iso = (n = 21) =>
  createUniformGrid({ rows: n, columns: n, planeCount: n, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

function singleVoxel(g = iso()) {
  const mid = Math.floor(g.rows / 2);
  const data = new Uint8Array(g.columns * g.rows * g.planes.length);
  data[mid * g.columns * g.rows + mid * g.columns + mid] = 1;
  return { mask: maskFromDense(g, data), mid };
}

describe("MORPH: distanceTransformMm", () => {
  it("MORPH-01 zero on the mask, exact Euclidean off it (isotropic)", () => {
    const { mask, mid } = singleVoxel();
    const dt = distanceTransformMm(mask);
    expect(dt.get(mid, mid, mid)).toBe(0);
    expect(dt.get(mid + 1, mid, mid)).toBeCloseTo(1, 6); // face
    expect(dt.get(mid + 1, mid + 1, mid)).toBeCloseTo(Math.SQRT2, 6); // in-plane diagonal
    expect(dt.get(mid + 1, mid + 1, mid + 1)).toBeCloseTo(Math.sqrt(3), 6); // corner
    expect(dt.get(mid + 3, mid, mid)).toBeCloseTo(3, 6);
  });

  it("MORPH-02 anisotropic: through-plane spacing scales the plane axis", () => {
    const g = createUniformGrid({ rows: 11, columns: 11, planeCount: 11, pixelSpacing: [1, 1], sliceSpacingMm: 3 });
    const data = new Uint8Array(11 * 11 * 11);
    data[5 * 121 + 5 * 11 + 5] = 1;
    const dt = distanceTransformMm(maskFromDense(g, data));
    expect(dt.get(5, 5, 6)).toBeCloseTo(3, 6); // one plane away = 3 mm
    expect(dt.get(6, 5, 5)).toBeCloseTo(1, 6); // one column away = 1 mm
  });

  it("MORPH-03 signed: negative inside, positive outside", () => {
    const g = iso(21);
    const cube = cubePhantom(g, 10);
    const dt = distanceTransformMm(cube, { signed: true });
    const c = 10;
    expect(dt.get(c, c, c)).toBeLessThan(0); // deep inside
    expect(dt.get(0, 0, 0)).toBeGreaterThan(0); // corner, outside
  });

  it("MORPH-04 single-plane grid → purely in-plane transform, no throw", () => {
    const g = createUniformGrid({ rows: 9, columns: 9, planeCount: 1, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    const data = new Uint8Array(81);
    data[4 * 9 + 4] = 1;
    const dt = distanceTransformMm(maskFromDense(g, data));
    expect(dt.get(4, 4, 0)).toBe(0);
    expect(dt.get(7, 4, 0)).toBeCloseTo(3, 6);
  });
});

describe("MORPH: dilateMm / erodeMm", () => {
  it("MORPH-05 radius 0 is identity", () => {
    const cube = cubePhantom(iso(), 8);
    expect(voxelDisagreement(dilateMm(cube, 0), cube)).toBe(0);
    expect(voxelDisagreement(erodeMm(cube, 0), cube)).toBe(0);
  });

  it("MORPH-06 dilating a point approximates a ball of that radius (4/3·π·r³)", () => {
    const g = iso(41); // 1 mm isotropic, room for r = 8
    const { mask } = singleVoxel(g);
    const r = 8;
    const grown = dilateMm(mask, r);
    const volMm3 = grown.count(); // 1 mm³ per voxel
    const analytic = (4 / 3) * Math.PI * r ** 3;
    expect(volMm3 / analytic).toBeGreaterThan(0.9);
    expect(volMm3 / analytic).toBeLessThan(1.1);
  });

  it("MORPH-07 dilate grows, erode shrinks, monotonically in the radius", () => {
    const cube = cubePhantom(iso(31), 12);
    expect(dilateMm(cube, 3).count()).toBeGreaterThan(dilateMm(cube, 1).count());
    expect(dilateMm(cube, 1).count()).toBeGreaterThan(cube.count());
    expect(erodeMm(cube, 1).count()).toBeLessThan(cube.count());
    expect(erodeMm(cube, 3).count()).toBeLessThan(erodeMm(cube, 1).count());
  });

  it("MORPH-08 erode is the dual of dilate on the complement (erode(A,r) ⊆ A)", () => {
    const sphere = spherePhantom(iso(31), 10);
    const eroded = erodeMm(sphere, 3);
    // every eroded voxel is in the original
    const [columns, rows, planes] = sphere.dimensions;
    for (let k = 0; k < planes; k++) {
      const es = eroded.getSliceBuffer(k);
      const ss = sphere.getSliceBuffer(k);
      for (let i = 0; i < es.length; i++) if (es[i]) expect(ss[i]).toBe(1);
    }
    expect(eroded.count()).toBeLessThan(sphere.count());
  });

  it("MORPH-09 closing (dilate then erode) by the same radius restores a convex shape closely", () => {
    const cube = cubePhantom(iso(41), 20);
    const closed = erodeMm(dilateMm(cube, 3), 3);
    // closing is extensive (cube ⊆ closed) and, for a convex set, ≈ the cube back —
    // discretisation on a 1 mm grid leaves a thin boundary-layer difference.
    const [columns, rows, planes] = cube.dimensions;
    for (let k = 0; k < planes; k++) {
      const cs = cube.getSliceBuffer(k);
      const ds = closed.getSliceBuffer(k);
      for (let i = 0; i < cs.length; i++) if (cs[i]) expect(ds[i]).toBe(1); // cube ⊆ closed
    }
    expect(voxelDisagreement(closed, cube) / cube.count()).toBeLessThan(0.15);
  });

  it("MORPH-10 anisotropic dilate: 2 mm reaches the 1 mm in-plane neighbour but not the 3 mm plane", () => {
    const g = createUniformGrid({ rows: 11, columns: 11, planeCount: 11, pixelSpacing: [1, 1], sliceSpacingMm: 3 });
    const data = new Uint8Array(11 * 11 * 11);
    data[5 * 121 + 5 * 11 + 5] = 1;
    const grown = dilateMm(maskFromDense(g, data), 2);
    expect(grown.get(6, 5, 5)).toBe(true); // +1 mm in-plane
    expect(grown.get(7, 5, 5)).toBe(true); // +2 mm in-plane
    expect(grown.get(5, 5, 6)).toBe(false); // +3 mm through-plane, out of reach
  });

  it("MORPH-11 negative radius throws", () => {
    const cube = cubePhantom(iso(), 6);
    expect(() => dilateMm(cube, -1)).toThrow(RangeError);
    expect(() => erodeMm(cube, -1)).toThrow(RangeError);
  });
});
