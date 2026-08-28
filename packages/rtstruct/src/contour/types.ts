import type { Vec3 } from "rt-geometry-js";

export type ContourGeometricType =
  | "CLOSED_PLANAR"
  | "CLOSEDPLANAR_XOR"
  | "OPEN_PLANAR"
  | "OPEN_NONPLANAR"
  | "POINT";

export interface Contour {
  readonly geometricType: ContourGeometricType;
  readonly points: readonly Vec3[];
}
