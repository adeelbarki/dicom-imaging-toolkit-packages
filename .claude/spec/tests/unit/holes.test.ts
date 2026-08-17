import { describe, expect, it } from "vitest";
import { rasterize } from "../../src/contour/rasterize.js";
import type { Contour } from "../../src/contour/types.js";
import type { Vec3 } from "../../src/types.js";
import { axialGrid } from "../helpers.js";

const ring = (cx: number, cy: number, r: number, z: number, n = 64): Vec3[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t), z] as Vec3;
  });

const grid = () => axialGrid([0]);

/** Outer ring + inner ring, connected by an arbitrarily narrow channel. */
function keyhole(cx: number, cy: number, outer: number, inner: number, z: number): Vec3[] {
  const o = ring(cx, cy, outer, z);
  const i = ring(cx, cy, inner, z).reverse();
  return [...o, o[0] as Vec3, ...i, i[0] as Vec3];
}

describe("CTR: the three hole encodings must all produce the same mask", () => {
  const outer = 3, inner = 1.2, cx = 4, cy = 4, z = 0;

  const nested: Contour[] = [
    { geometricType: "CLOSED_PLANAR", points: ring(cx, cy, outer, z) },
    { geometricType: "CLOSED_PLANAR", points: ring(cx, cy, inner, z) },
  ];
  const xor: Contour[] = [
    { geometricType: "CLOSEDPLANAR_XOR", points: ring(cx, cy, outer, z) },
    { geometricType: "CLOSEDPLANAR_XOR", points: ring(cx, cy, inner, z) },
  ];
  const key: Contour[] = [
    { geometricType: "CLOSED_PLANAR", points: keyhole(cx, cy, outer, inner, z) },
  ];

  it("CTR-01 nested CLOSED_PLANAR yields a hole (compatibility path)", () => {
    const r = rasterize(nested, grid());
    expect(r.mask.get(4, 4, 0)).toBe(false);
    expect(r.mask.get(4, 2, 0)).toBe(true);
    expect(r.provenance.holeInterpretation).toBe("nested-even-odd");
  });

  it("CTR-02 CLOSEDPLANAR_XOR yields the same mask", () => {
    expect(rasterize(xor, grid()).mask.count())
      .toBe(rasterize(nested, grid()).mask.count());
  });

  it("CTR-03 keyhole yields the same mask (half-open edge rule)", () => {
    expect(rasterize(key, grid()).mask.count())
      .toBe(rasterize(nested, grid()).mask.count());
  });

  it("CTR-04 nested interpretation is recorded but is not a loud warning", () => {
    const r = rasterize(nested, grid());
    const d = r.diagnostics.find((x) => x.code === "NESTED_CLOSED_PLANAR_INTERPRETED");
    expect(d?.severity).toBe("info");
  });

  it("CTR-05 mixing XOR with non-XOR inside one ROI is an error", () => {
    const mixed: Contour[] = [xor[0] as Contour, nested[1] as Contour];
    expect(() => rasterize(mixed, grid())).toThrowError(/XorHomogeneity|XOR/i);
  });
});
