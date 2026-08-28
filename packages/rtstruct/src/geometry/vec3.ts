import type { Vec3 } from "../types.js";

/** Vectors shorter than this are treated as degenerate — floating-point noise, not a real direction. */
const MIN_VECTOR_LENGTH = 1e-9;

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/**
 * normalize() is the trust boundary for direction vectors: it's only ever called at grid
 * construction (row/column direction, their cross product), never in a per-voxel or
 * per-contour-point hot path — so this is where bad input (NaN/Infinity from a malformed
 * DICOM value, or a near-zero vector that's really float noise) should fail, rather than
 * silently propagating as NaN through everything downstream. add/dot/cross/scale stay
 * unchecked on purpose: they run in hot loops and trust their inputs.
 */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (!Number.isFinite(len)) throw new Error(`cannot normalize a non-finite vector: [${a.join(", ")}]`);
  if (len < MIN_VECTOR_LENGTH) throw new Error(`cannot normalize a degenerate (near-zero) vector: [${a.join(", ")}]`);
  return scale(a, 1 / len);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** Angle between two vectors, in radians, independent of magnitude. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const cosTheta = dot(normalize(a), normalize(b));
  return Math.acos(Math.min(1, Math.max(-1, cosTheta)));
}
