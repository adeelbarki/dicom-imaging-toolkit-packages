import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { cubePhantom, spherePhantom, torusPhantom } from "../../src/phantom.js";
import { ResourceLimitError } from "../../src/errors.js";

describe("PHANTOM-003: phantom parameters are validated, not trusted", () => {
  const g = createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

  it("a non-positive or non-finite cube side is rejected, not silently empty", () => {
    expect(() => cubePhantom(g, -20)).toThrow(RangeError);
    expect(() => cubePhantom(g, 0)).toThrow(RangeError);
    expect(() => cubePhantom(g, NaN)).toThrow(RangeError);
  });

  it("a non-positive or non-finite sphere radius is rejected, not silently empty", () => {
    expect(() => spherePhantom(g, -10)).toThrow(RangeError);
    expect(() => spherePhantom(g, 0)).toThrow(RangeError);
    expect(() => spherePhantom(g, Infinity)).toThrow(RangeError);
  });

  it("non-positive torus radii are rejected", () => {
    expect(() => torusPhantom(g, -10, 5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 10, -5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 10, 0)).toThrow(RangeError);
  });

  it("a torus with majorRadiusMm <= minorRadiusMm is rejected — the tube would self-intersect", () => {
    expect(() => torusPhantom(g, 5, 5)).toThrow(RangeError);
    expect(() => torusPhantom(g, 5, 10)).toThrow(RangeError);
  });
});

describe("PHANTOM-005: phantom builders bound allocation before doing any work", () => {
  it("a grid whose voxel count exceeds maxVoxels is rejected before any voxelization loop runs", () => {
    const huge = createUniformGrid({ rows: 4096, columns: 4096, planeCount: 512, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => spherePhantom(huge, 10, 1000)).toThrow(ResourceLimitError);
    expect(() => cubePhantom(huge, 10, 1000)).toThrow(ResourceLimitError);
    expect(() => torusPhantom(huge, 10, 5, 1000)).toThrow(ResourceLimitError);
  });

  it("a grid within the limit is unaffected", () => {
    const g = createUniformGrid({ rows: 16, columns: 16, planeCount: 8, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => spherePhantom(g, 5, 100000)).not.toThrow();
  });
});
