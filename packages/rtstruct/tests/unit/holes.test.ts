import { describe, expect, it } from "vitest";
import { rasterize } from "../../src/contour/rasterize.js";
import { MalformedContourError } from "../../src/errors.js";
import type { Contour } from "../../src/contour/types.js";
import type { Vec3 } from "rt-geometry-js";
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

describe("CONTOUR-003/004: hole interpretation is per-plane, and requires real containment", () => {
  it("one contour per plane across a multi-plane ROI is never labeled nested-even-odd", () => {
    // A normal tumor: one CLOSED_PLANAR contour on each of 4 slices. The ROI-wide count is
    // 4, but no single plane has more than one contour — must not be mislabeled.
    const g = axialGrid([0, 3, 6, 9]);
    const oneContourPerPlane: Contour[] = [0, 3, 6, 9].map((z) => ({
      geometricType: "CLOSED_PLANAR",
      points: ring(4, 4, 2, z),
    }));
    const r = rasterize(oneContourPerPlane, g);
    expect(r.provenance.holeInterpretation).toBe("none");
    expect(r.diagnostics.map((d) => d.code)).not.toContain("NESTED_CLOSED_PLANAR_INTERPRETED");
    expect(r.mask.count()).toBeGreaterThan(0);
  });

  it("two disjoint islands on the same plane are 'none', not nested-even-odd", () => {
    const islands: Contour[] = [
      { geometricType: "CLOSED_PLANAR", points: ring(4, 4, 1.5, 0) },
      { geometricType: "CLOSED_PLANAR", points: ring(11, 11, 1.5, 0) },
    ];
    const r = rasterize(islands, grid());
    expect(r.provenance.holeInterpretation).toBe("none");
    expect(r.diagnostics.map((d) => d.code)).not.toContain("NESTED_CLOSED_PLANAR_INTERPRETED");
    // Both islands still fill correctly, independent of the (correctly non-nested) label.
    expect(r.mask.get(4, 4, 0)).toBe(true);
    expect(r.mask.get(11, 11, 0)).toBe(true);
  });

  it("nesting on one plane doesn't leak a diagnostic onto an unrelated disjoint plane", () => {
    const g = axialGrid([0, 3]);
    const disjointOnPlane0: Contour[] = [
      { geometricType: "CLOSED_PLANAR", points: ring(4, 4, 1.5, 0) },
      { geometricType: "CLOSED_PLANAR", points: ring(11, 11, 1.5, 0) },
    ];
    const nestedOnPlane1: Contour[] = [
      { geometricType: "CLOSED_PLANAR", points: ring(4, 4, 3, 3) },
      { geometricType: "CLOSED_PLANAR", points: ring(4, 4, 1.2, 3) },
    ];
    const r = rasterize([...disjointOnPlane0, ...nestedOnPlane1], g);
    expect(r.provenance.holeInterpretation).toBe("nested-even-odd");
    const nestedDiagnostics = r.diagnostics.filter((d) => d.code === "NESTED_CLOSED_PLANAR_INTERPRETED");
    expect(nestedDiagnostics).toHaveLength(1);
    expect(nestedDiagnostics[0]?.detail?.["planeIndex"]).toBe(1);
  });
});

describe("Slice association and coplanarity are validated, not trusted", () => {
  it("a contour far from every plane still rasterizes but is flagged", () => {
    const g = axialGrid([0, 3, 6, 9]);
    const farAway: Contour[] = [{ geometricType: "CLOSED_PLANAR", points: ring(4, 4, 2, 100) }];
    const r = rasterize(farAway, g);
    expect(r.diagnostics.map((d) => d.code)).toContain("CONTOUR_PLANE_DISTANCE");
    expect(r.mask.count()).toBeGreaterThan(0); // liberal: still rasterized onto the nearest plane
  });

  it("a single non-coplanar point within an otherwise-normal contour is flagged", () => {
    const g = axialGrid([0, 3, 6, 9]);
    const points = ring(4, 4, 2, 0);
    const bent: Vec3[] = points.map((p, i) => (i === 2 ? ([p[0], p[1], 4] as Vec3) : p));
    const r = rasterize([{ geometricType: "CLOSED_PLANAR", points: bent }], g);
    expect(r.diagnostics.map((d) => d.code)).toContain("CONTOUR_PLANE_DISTANCE");
  });

  it("a well-formed contour on a well-sampled grid triggers no distance diagnostic", () => {
    const g = axialGrid([0, 3, 6, 9]);
    const r = rasterize([{ geometricType: "CLOSED_PLANAR", points: ring(4, 4, 2, 3) }], g);
    expect(r.diagnostics.map((d) => d.code)).not.toContain("CONTOUR_PLANE_DISTANCE");
  });
});

describe("Degenerate contours are rejected before rasterization", () => {
  it("a CLOSED_PLANAR contour with fewer than 3 points throws MalformedContourError", () => {
    const tooFew: Contour = { geometricType: "CLOSED_PLANAR", points: [[0, 0, 0], [1, 0, 0]] };
    expect(() => rasterize([tooFew], grid())).toThrow(MalformedContourError);
  });

  it("an empty CLOSED_PLANAR contour throws MalformedContourError", () => {
    const empty: Contour = { geometricType: "CLOSED_PLANAR", points: [] };
    expect(() => rasterize([empty], grid())).toThrow(MalformedContourError);
  });
});

describe("Unsupported geometric types are diagnosed, not silently dropped", () => {
  it("a POINT contour produces UNSUPPORTED_CONTOUR_GEOMETRY and an empty mask, not a silent one", () => {
    const point: Contour = { geometricType: "POINT", points: [[4, 4, 0]] };
    const r = rasterize([point], grid());
    expect(r.diagnostics.map((d) => d.code)).toContain("UNSUPPORTED_CONTOUR_GEOMETRY");
    expect(r.mask.count()).toBe(0);
  });

  it("a POINT contour mixed with a valid CLOSED_PLANAR contour still fills the valid one", () => {
    const point: Contour = { geometricType: "POINT", points: [[4, 4, 0]] };
    const valid: Contour = { geometricType: "CLOSED_PLANAR", points: ring(4, 4, 2, 0) };
    const r = rasterize([point, valid], grid());
    expect(r.diagnostics.map((d) => d.code)).toContain("UNSUPPORTED_CONTOUR_GEOMETRY");
    expect(r.mask.count()).toBeGreaterThan(0);
  });
});
