import { maskFromDense } from "./mask3d.js";
import type { Mask3D } from "./types.js";

export type Connectivity = 6 | 26;

export interface ConnectedComponents {
  /** One label per voxel, plane-major then row-major (same layout as `getSliceBuffer`).
   *  `0` = background; components are numbered `1..count` in descending size order, so
   *  label `1` is always the largest. */
  readonly labels: Int32Array;
  readonly count: number;
  /** Voxel count of each component, index `i` for label `i + 1`; descending. */
  readonly sizes: readonly number[];
  readonly dimensions: readonly [number, number, number];
}

/** Union-find over voxel indices. */
class DSU {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    this.rank = new Uint8Array(n);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur] as number;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank[ra] as number;
    const rankB = this.rank[rb] as number;
    if (rankA < rankB) this.parent[ra] = rb;
    else if (rankA > rankB) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra] = rankA + 1;
    }
  }
}

// Backward neighbour offsets (already-visited half of the stencil) as [dc, dr, dk].
const NEIGHBOURS_6: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];
const NEIGHBOURS_26: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dk = -1; dk <= 0; dk++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dk === 0 && (dr > 0 || (dr === 0 && dc >= 0))) continue; // only the visited half
        out.push([dc, dr, dk]);
      }
    }
  }
  return out;
})();

/**
 * Label the connected components of the set voxels. Two-pass union-find:
 * `connectivity` 6 (face-adjacent) or 26 (also edge/corner). Components are renumbered so
 * label 1 is the largest; ties keep first-seen order.
 */
export function connectedComponents(mask: Mask3D, opts: { connectivity?: Connectivity } = {}): ConnectedComponents {
  const connectivity = opts.connectivity ?? 26;
  const stencil = connectivity === 6 ? NEIGHBOURS_6 : NEIGHBOURS_26;
  const [columns, rows, planes] = mask.dimensions;
  const sliceSize = columns * rows;
  const n = sliceSize * planes;

  // Flatten to one dense occupancy array so neighbour lookups across planes are O(1).
  const occ = new Uint8Array(n);
  for (let k = 0; k < planes; k++) {
    const s = mask.getSliceBuffer(k);
    const base = k * sliceSize;
    for (let i = 0; i < sliceSize; i++) if (s[i] !== 0) occ[base + i] = 1;
  }

  const dsu = new DSU(n);
  for (let k = 0; k < planes; k++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const idx = k * sliceSize + r * columns + c;
        if (occ[idx] === 0) continue;
        for (const [dc, dr, dk] of stencil) {
          const nc = c + dc;
          const nr = r + dr;
          const nk = k + dk;
          if (nc < 0 || nc >= columns || nr < 0 || nr >= rows || nk < 0 || nk >= planes) continue;
          const nidx = nk * sliceSize + nr * columns + nc;
          if (occ[nidx] !== 0) dsu.union(idx, nidx);
        }
      }
    }
  }

  // Collect roots, size them, order by descending size.
  const sizeByRoot = new Map<number, number>();
  const firstSeen = new Map<number, number>();
  let order = 0;
  for (let idx = 0; idx < n; idx++) {
    if (occ[idx] === 0) continue;
    const root = dsu.find(idx);
    sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
    if (!firstSeen.has(root)) firstSeen.set(root, order++);
  }

  const roots = [...sizeByRoot.keys()].sort((a, b) => {
    const d = (sizeByRoot.get(b) as number) - (sizeByRoot.get(a) as number);
    return d !== 0 ? d : (firstSeen.get(a) as number) - (firstSeen.get(b) as number);
  });

  const labelOfRoot = new Map<number, number>();
  roots.forEach((root, i) => labelOfRoot.set(root, i + 1));

  const labels = new Int32Array(n);
  for (let idx = 0; idx < n; idx++) {
    if (occ[idx] === 0) continue;
    labels[idx] = labelOfRoot.get(dsu.find(idx)) as number;
  }

  return {
    labels,
    count: roots.length,
    sizes: roots.map((root) => sizeByRoot.get(root) as number),
    dimensions: [columns, rows, planes],
  };
}

/**
 * The single largest connected component of `mask`, as a `Mask3D` on the same grid.
 * Returns an all-zero mask if `mask` is empty.
 */
export function largestComponent(mask: Mask3D, opts: { connectivity?: Connectivity } = {}): Mask3D {
  const cc = connectedComponents(mask, opts);
  const [columns, rows, planes] = mask.dimensions;
  const out = new Uint8Array(columns * rows * planes);
  if (cc.count > 0) {
    for (let i = 0; i < out.length; i++) if (cc.labels[i] === 1) out[i] = 1;
  }
  return maskFromDense(mask.geometry, out);
}
