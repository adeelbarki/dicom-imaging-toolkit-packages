import { describe, expect, it } from "vitest";
import { createUniformGrid } from "../../src/grid-geometry.js";
import { maskFromDense } from "../../src/mask3d.js";
import { spherePhantom } from "../../src/phantom.js";
import { connectedComponents, largestComponent } from "../../src/connected-components.js";

const grid = (rows = 5, columns = 5, planeCount = 3) =>
  createUniformGrid({ rows, columns, planeCount, pixelSpacing: [1, 1], sliceSpacingMm: 1 });

function mask(points: ReadonlyArray<readonly [number, number, number]>, g = grid()) {
  const data = new Uint8Array(g.columns * g.rows * g.planes.length);
  for (const [c, r, k] of points) data[k * g.columns * g.rows + r * g.columns + c] = 1;
  return maskFromDense(g, data);
}

describe("CC: connectedComponents", () => {
  it("CC-01 empty mask → count 0, all labels 0", () => {
    const cc = connectedComponents(mask([]));
    expect(cc.count).toBe(0);
    expect(cc.sizes).toEqual([]);
    expect([...cc.labels].every((l) => l === 0)).toBe(true);
  });

  it("CC-02 one blob → count 1", () => {
    const cc = connectedComponents(mask([[1, 1, 0], [2, 1, 0], [1, 2, 0]]));
    expect(cc.count).toBe(1);
    expect(cc.sizes).toEqual([3]);
  });

  it("CC-03 two separated islands → count 2, sizes descending, label 1 is the larger", () => {
    const g = grid();
    const cc = connectedComponents(mask([[0, 0, 0], [4, 4, 0], [3, 4, 0], [4, 3, 0]], g));
    expect(cc.count).toBe(2);
    expect(cc.sizes).toEqual([3, 1]);
    // the 3-voxel island is label 1
    const idx = (c: number, r: number, k: number) => k * g.columns * g.rows + r * g.columns + c;
    expect(cc.labels[idx(4, 4, 0)]).toBe(1);
    expect(cc.labels[idx(0, 0, 0)]).toBe(2);
  });

  it("CC-04 diagonal-only touch: separate under 6-connectivity, joined under 26", () => {
    const pts = [[1, 1, 0], [2, 2, 0]] as const;
    expect(connectedComponents(mask(pts), { connectivity: 6 }).count).toBe(2);
    expect(connectedComponents(mask(pts), { connectivity: 26 }).count).toBe(1);
  });

  it("CC-05 through-plane face adjacency joins under 6-connectivity", () => {
    const cc = connectedComponents(mask([[2, 2, 0], [2, 2, 1], [2, 2, 2]]), { connectivity: 6 });
    expect(cc.count).toBe(1);
    expect(cc.sizes).toEqual([3]);
  });

  it("CC-06 a solid sphere is a single 26-connected component", () => {
    const cc = connectedComponents(spherePhantom(grid(20, 20, 20), 7));
    expect(cc.count).toBe(1);
  });
});

describe("CC: largestComponent", () => {
  it("CC-07 keeps only the biggest island", () => {
    const g = grid();
    const m = mask([[0, 0, 0], [4, 4, 0], [3, 4, 0], [4, 3, 0], [3, 3, 0]], g);
    const largest = largestComponent(m);
    expect(largest.count()).toBe(4);
    expect(largest.geometry).toBe(m.geometry);
    expect(largest.get(0, 0, 0)).toBe(false);
    expect(largest.get(4, 4, 0)).toBe(true);
  });

  it("CC-08 empty mask → empty mask", () => {
    expect(largestComponent(mask([])).count()).toBe(0);
  });
});
