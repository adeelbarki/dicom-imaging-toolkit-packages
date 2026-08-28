import { describe, expect, it } from "vitest";
import { angleBetween, normalize } from "../../src/vec3.js";
import type { Vec3 } from "../../src/types.js";

describe("normalize: degenerate and non-finite input fails at the boundary, not silently", () => {
  it("a valid vector normalizes to unit length", () => {
    const [x, y, z] = normalize([3, 0, 4]);
    expect(x).toBeCloseTo(0.6);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0.8);
  });

  it("an exact zero vector throws", () => {
    expect(() => normalize([0, 0, 0])).toThrow(/degenerate|zero/i);
  });

  it("a near-zero vector (floating-point noise) throws rather than producing an unstable direction", () => {
    expect(() => normalize([1e-15, 0, 0])).toThrow(/degenerate/i);
  });

  it("a NaN component throws instead of propagating [NaN, NaN, NaN]", () => {
    expect(() => normalize([NaN, 0, 0] as Vec3)).toThrow(/non-finite/i);
  });

  it("an Infinity component throws instead of propagating NaN via Infinity * 0", () => {
    expect(() => normalize([Infinity, 0, 0] as Vec3)).toThrow(/non-finite/i);
  });
});

describe("angleBetween: magnitude-independent, sign-sensitive", () => {
  it("is independent of magnitude", () => {
    expect(angleBetween([1, 0, 0], [1, 1, 0])).toBeCloseTo(angleBetween([5, 0, 0], [2, 2, 0]));
  });

  it("is NOT independent of sign — flipping one input gives the supplementary angle", () => {
    const a: Vec3 = [1, 0, 0];
    const b: Vec3 = [1, 1, 0];
    const theta = angleBetween(a, b);
    const flipped = angleBetween([-a[0], -a[1], -a[2]] as Vec3, b);
    expect(flipped).toBeCloseTo(Math.PI - theta);
  });
});
