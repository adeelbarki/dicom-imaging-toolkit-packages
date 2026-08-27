import type { Vec3 } from "../types.js";

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
