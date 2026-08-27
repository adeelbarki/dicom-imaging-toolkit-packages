import { describe, expect, it } from "vitest";
import { sortPlanes } from "../../src/geometry/plane-sort.js";
import type { GridPlane, Vec3 } from "../../src/types.js";

const NORMAL: Vec3 = [0, 0, 1];
const p = (z: number): GridPlane => ({ position: [0, 0, z] });

describe("GEO: plane ordering", () => {
  it("GEO-10 sorts by projection onto the normal", () => {
    const r = sortPlanes([p(6), p(0), p(3)], NORMAL);
    expect(r.planes.map((x) => x.position[2])).toEqual([0, 3, 6]);
  });

  it("GEO-11 reversed input yields the same sorted order", () => {
    const fwd = sortPlanes([p(0), p(3), p(6)], NORMAL);
    const rev = sortPlanes([p(6), p(3), p(0)], NORMAL);
    expect(rev.planes).toEqual(fwd.planes);
  });

  it("GEO-12 duplicate plane positions are dropped with a diagnostic, not rejected", () => {
    const r = sortPlanes([p(0), p(3), p(3.0000001), p(6)], NORMAL);
    expect(r.planes).toHaveLength(3);
    expect(r.diagnostics.map((d) => d.code)).toContain("DUPLICATE_PLANE_POSITION");
  });

  it("GEO-13 irregular spacing is accepted", () => {
    const r = sortPlanes([p(0), p(2), p(4), p(7), p(9)], NORMAL);
    expect(r.planes.map((x) => x.position[2])).toEqual([0, 2, 4, 7, 9]);
  });

  it("GEO-14 non-parallel planes are rejected outright in v0.1", () => {
    const skew: GridPlane[] = [p(0), { position: [0, 0, 3] }];
    expect(() => sortPlanes(skew, [0.7, 0, 0.7])).toThrowError(/NonParallel|parallel/i);
  });

  it("a non-finite plane position throws instead of silently corrupting the sort", () => {
    const bad: GridPlane[] = [p(0), { position: [0, 0, NaN] }, p(3)];
    expect(() => sortPlanes(bad, NORMAL)).toThrow(/non-finite/i);
  });

  it("planes 0.4mm apart are distinct slices, not duplicates — dedup must not reuse tolerance.positionMm", () => {
    // A real, normal thin-slice spacing. With the default positionMm (0.5mm) wrongly
    // reused for dedup, 10.0 and 10.4 would satisfy `0.4 <= 0.5` and one would be dropped.
    const r = sortPlanes([p(10.0), p(10.4)], NORMAL);
    expect(r.planes).toHaveLength(2);
    expect(r.diagnostics.map((d) => d.code)).not.toContain("DUPLICATE_PLANE_POSITION");
  });
});
