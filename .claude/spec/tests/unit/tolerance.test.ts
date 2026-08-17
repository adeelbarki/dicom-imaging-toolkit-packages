import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "../../src/geometry/tolerance.js";
import { axialGrid } from "../helpers.js";
import type { GridTolerance } from "../../src/types.js";

describe("GEO: grid equality is tolerance-based", () => {
  it("GEO-01 identical grids are equal", () => {
    expect(axialGrid([0, 3, 6]).equals(axialGrid([0, 3, 6]))).toBe(true);
  });

  it("GEO-02 sub-micron IPP differences do not break equality", () => {
    expect(axialGrid([0, 3, 6]).equals(axialGrid([0, 3.0000001, 6]))).toBe(true);
  });

  it("GEO-03 a 2mm plane offset is not equal", () => {
    expect(axialGrid([0, 3, 6]).equals(axialGrid([0, 5, 6]))).toBe(false);
  });

  it("GEO-04 dimensions must match exactly, tolerance is irrelevant", () => {
    const a = axialGrid([0, 3]);
    const b = axialGrid([0, 3]);
    const loose: GridTolerance = { positionMm: 1e6, spacingMm: 1e6, directionAngleRad: Math.PI };
    expect(a.equals({ ...b, columns: 9 } as never, loose)).toBe(false);
  });

  it("GEO-05 direction is compared as an angle, not as a linear delta", () => {
    const tol: GridTolerance = { ...DEFAULT_TOLERANCE, directionAngleRad: 1e-4 };
    const a = axialGrid([0, 3]);
    const tilted = { ...a, rowDirection: [Math.cos(1e-6), Math.sin(1e-6), 0] } as never;
    expect(a.equals(tilted, tol)).toBe(true);
  });
});

describe("GEO: equality is NOT transitive, and the library must not claim it is", () => {
  it("GEO-06 A~B and B~C does not imply A~C", () => {
    const tol: GridTolerance = { positionMm: 1.0, spacingMm: 1.0, directionAngleRad: 1e-3 };
    const A = axialGrid([0.0]);
    const B = axialGrid([0.9]);
    const C = axialGrid([1.8]);
    expect(A.equals(B, tol)).toBe(true);
    expect(B.equals(C, tol)).toBe(true);
    expect(A.equals(C, tol)).toBe(false);
  });

  it("GEO-07 equal fingerprints are only a hint and must still be confirmed by equals()", () => {
    const tol: GridTolerance = { positionMm: 1.0, spacingMm: 1.0, directionAngleRad: 1e-3 };
    const A = axialGrid([0.0]);
    const C = axialGrid([1.8]);
    // Whatever the quantization, a fingerprint collision must never be taken
    // as authoritative: equals() is the decision.
    if (A.fingerprint() === C.fingerprint()) {
      expect(A.equals(C, tol)).toBe(false);
    }
    expect(typeof A.fingerprint()).toBe("string");
  });
});
