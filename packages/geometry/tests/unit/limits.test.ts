import { describe, expect, it } from "vitest";
import { createEmptyMask } from "../../src/mask3d.js";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { sortPlanes } from "../../src/plane-sort.js";
import type { Vec3 } from "../../src/types.js";

describe("SEC: resource limits are enforced BEFORE allocation", () => {
  it("SEC-01 an oversized grid throws instead of allocating", () => {
    const g = createUniformGrid({ rows: 4096, columns: 4096, planeCount: 4096, pixelSpacing: [1, 1], sliceSpacingMm: 1 });
    expect(() => createEmptyMask(g, 1e8)).toThrowError(/ResourceLimit/i);
  });
});

describe("SEC: diagnostics and provenance must be safe to log", () => {
  it("SEC-02 redact() removes quasi-identifying UIDs", () => {
    const normal: Vec3 = [0, 0, 1];
    const r = sortPlanes([{ position: [0, 0, 0] }, { position: [0, 0, 1e-9] }], normal);
    const d = r.diagnostics[0];
    const text = JSON.stringify(d?.redact());
    expect(text).not.toMatch(/1\.2\.840|1\.2\.3\.4/);
  });
});
