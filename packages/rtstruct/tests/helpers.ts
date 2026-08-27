import { createGridGeometry } from "../src/geometry/grid-geometry.js";
import type { GridGeometry, Vec3 } from "../src/types.js";

/** An axial (identity-orientation) grid with the given plane z-positions. */
export function axialGrid(zPositionsMm: readonly number[], pixelSpacing: readonly [number, number] = [1, 1]): GridGeometry {
  return createGridGeometry({
    rows: 16,
    columns: 16,
    rowDirection: [1, 0, 0],
    columnDirection: [0, 1, 0],
    pixelSpacing,
    planePositions: zPositionsMm.map((z): Vec3 => [0, 0, z]),
  });
}
