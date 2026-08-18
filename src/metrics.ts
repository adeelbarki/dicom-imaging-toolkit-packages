import { distance } from "./geometry/vec3.js";
import type { Mask3D, Vec3 } from "./types.js";

function centroidMm(mask: Mask3D): Vec3 {
  const grid = mask.geometry;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let planeIndex = 0; planeIndex < grid.planes.length; planeIndex++) {
    const buffer = mask.getSliceBuffer(planeIndex);
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        if (buffer[row * grid.columns + column] === 0) continue;
        const p = grid.indexToPatient(column, row, planeIndex);
        sx += p[0];
        sy += p[1];
        sz += p[2];
        n++;
      }
    }
  }
  return n === 0 ? [0, 0, 0] : [sx / n, sy / n, sz / n];
}

export function dice(a: Mask3D, b: Mask3D): number {
  let intersection = 0;
  let countA = 0;
  let countB = 0;
  const planeCount = a.dimensions[2];
  for (let planeIndex = 0; planeIndex < planeCount; planeIndex++) {
    const ba = a.getSliceBuffer(planeIndex);
    const bb = b.getSliceBuffer(planeIndex);
    for (let i = 0; i < ba.length; i++) {
      const va = ba[i] !== 0;
      const vb = bb[i] !== 0;
      if (va) countA++;
      if (vb) countB++;
      if (va && vb) intersection++;
    }
  }
  return countA + countB === 0 ? 1 : (2 * intersection) / (countA + countB);
}

export function voxelDisagreement(a: Mask3D, b: Mask3D): number {
  let disagreement = 0;
  const planeCount = a.dimensions[2];
  for (let planeIndex = 0; planeIndex < planeCount; planeIndex++) {
    const ba = a.getSliceBuffer(planeIndex);
    const bb = b.getSliceBuffer(planeIndex);
    for (let i = 0; i < ba.length; i++) {
      if ((ba[i] !== 0) !== (bb[i] !== 0)) disagreement++;
    }
  }
  return disagreement;
}

export function centroidDisplacementMm(a: Mask3D, b: Mask3D): number {
  return distance(centroidMm(a), centroidMm(b));
}
