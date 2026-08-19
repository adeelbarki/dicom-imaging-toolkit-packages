import { describe, expect, it } from "vitest";
import { createGridGeometry } from "../../src/geometry/grid-geometry.js";
import { DEFAULT_TOLERANCE } from "../../src/geometry/tolerance.js";
import { axialGrid } from "../helpers.js";
import type { GridTolerance, Vec3 } from "../../src/types.js";

/** Same shape as axialGrid, but with an explicit frameOfReferenceUID. */
function axialGridWithFor(zPositionsMm: readonly number[], frameOfReferenceUID: string) {
  return createGridGeometry({
    rows: 16,
    columns: 16,
    rowDirection: [1, 0, 0] as Vec3,
    columnDirection: [0, 1, 0] as Vec3,
    pixelSpacing: [1, 1],
    planePositions: zPositionsMm.map((z): Vec3 => [0, 0, z]),
    frameOfReferenceUID,
  });
}

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

describe("GEO: frame of reference is part of equality, not just the fingerprint", () => {
  it("differing frameOfReferenceUID is never equal, even under a maximally loose tolerance", () => {
    const loose: GridTolerance = { positionMm: 1e6, spacingMm: 1e6, directionAngleRad: Math.PI };
    const a = axialGridWithFor([0, 3, 6], "1.2.3");
    const b = axialGridWithFor([0, 3, 6], "1.2.4");
    expect(a.equals(b, loose)).toBe(false);
  });

  it("matching frameOfReferenceUID falls through to the normal geometric comparison", () => {
    const a = axialGridWithFor([0, 3, 6], "1.2.3");
    const b = axialGridWithFor([0, 3, 6], "1.2.3");
    expect(a.equals(b)).toBe(true);
  });

  it("either side missing frameOfReferenceUID is not treated as a mismatch", () => {
    const withFor = axialGridWithFor([0, 3, 6], "1.2.3");
    const withoutFor = axialGrid([0, 3, 6]);
    expect(withoutFor.equals(withFor)).toBe(true);
    expect(withFor.equals(withoutFor)).toBe(true);
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
