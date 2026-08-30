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
  /**
   * `ReferencedSOPInstanceUID`(s) from this contour's `ContourImageSequence` (3006,0016),
   * if the file carried one. When a matching image series is supplied to `RTStruct.load`,
   * these give the *authoritative* contour → slice association; without them (or when a
   * UID doesn't resolve) association falls back to nearest-plane geometry.
   */
  readonly referencedSOPInstanceUIDs?: readonly string[];
}
