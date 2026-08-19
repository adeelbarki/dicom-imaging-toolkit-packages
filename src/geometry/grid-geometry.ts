import type { GridGeometry, GridPlane, GridTolerance, Vec3 } from "../types.js";
import { sortPlanes } from "./plane-sort.js";
import { DEFAULT_TOLERANCE } from "./tolerance.js";
import { add, angleBetween, cross, distance, dot, normalize, scale, sub } from "./vec3.js";

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`plane index ${index} out of range (length ${arr.length})`);
  return value;
}

function computeFingerprint(g: GridGeometry): string {
  const r = (n: number) => n.toFixed(3);
  return [
    g.rows,
    g.columns,
    g.pixelSpacing.map(r).join(","),
    g.rowDirection.map(r).join(","),
    g.columnDirection.map(r).join(","),
    g.planes.map((p) => p.position.map(r).join(",")).join(";"),
    g.frameOfReferenceUID ?? "",
  ].join("|");
}

function gridEquals(self: GridGeometry, other: GridGeometry, tol: GridTolerance): boolean {
  // Both frames known and different: physically non-comparable coordinate systems, no
  // amount of geometric tolerance can paper over that. Either side unknown (the common
  // case for createUniformGrid/phantoms) falls through — there's nothing to contradict.
  if (
    self.frameOfReferenceUID !== undefined &&
    other.frameOfReferenceUID !== undefined &&
    self.frameOfReferenceUID !== other.frameOfReferenceUID
  ) {
    return false;
  }
  if (self.rows !== other.rows || self.columns !== other.columns) return false;
  if (self.planes.length !== other.planes.length) return false;
  if (Math.abs(self.pixelSpacing[0] - other.pixelSpacing[0]) > tol.spacingMm) return false;
  if (Math.abs(self.pixelSpacing[1] - other.pixelSpacing[1]) > tol.spacingMm) return false;
  if (angleBetween(self.rowDirection, other.rowDirection) > tol.directionAngleRad) return false;
  if (angleBetween(self.columnDirection, other.columnDirection) > tol.directionAngleRad) return false;

  for (let i = 0; i < self.planes.length; i++) {
    if (distance(at(self.planes, i).position, at(other.planes, i).position) > tol.positionMm) return false;
  }
  return true;
}

function computeIsUniformlySpaced(planes: readonly GridPlane[], normal: Vec3, tolMm: number): boolean {
  if (planes.length < 3) return true;
  const projections = planes.map((p) => dot(p.position, normal));
  const firstDelta = at(projections, 1) - at(projections, 0);
  for (let i = 2; i < projections.length; i++) {
    const delta = at(projections, i) - at(projections, i - 1);
    if (Math.abs(delta - firstDelta) > tolMm) return false;
  }
  return true;
}

export interface CreateGridGeometryParams {
  readonly rows: number;
  readonly columns: number;
  readonly rowDirection: Vec3;
  readonly columnDirection: Vec3;
  readonly pixelSpacing: readonly [number, number];
  readonly planePositions: readonly Vec3[];
  readonly frameOfReferenceUID?: string;
}

/**
 * The low-level grid constructor: caller supplies explicit plane positions.
 * Planes are sorted and validated (parallelism, dedup) via sortPlanes.
 * Prefer createUniformGrid for the common evenly-spaced case.
 */
export function createGridGeometry(params: CreateGridGeometryParams): GridGeometry {
  const rowDirection = normalize(params.rowDirection);
  const columnDirection = normalize(params.columnDirection);
  const gridNormal = normalize(cross(rowDirection, columnDirection));

  const { planes } = sortPlanes(
    params.planePositions.map((position): GridPlane => ({ position })),
    gridNormal,
  );

  const geometry: GridGeometry = {
    rows: params.rows,
    columns: params.columns,
    rowDirection,
    columnDirection,
    pixelSpacing: params.pixelSpacing,
    planes,
    frameOfReferenceUID: params.frameOfReferenceUID,

    normal(): Vec3 {
      return gridNormal;
    },

    equals(other: GridGeometry, tol: GridTolerance = DEFAULT_TOLERANCE): boolean {
      return gridEquals(geometry, other, tol);
    },

    fingerprint(): string {
      return computeFingerprint(geometry);
    },

    isUniformlySpaced(tolMm = 1e-3): boolean {
      return computeIsUniformlySpaced(geometry.planes, gridNormal, tolMm);
    },

    indexToPatient(column: number, row: number, planeIndex: number): Vec3 {
      const plane = at(geometry.planes, planeIndex);
      return add(
        plane.position,
        add(scale(rowDirection, column * geometry.pixelSpacing[1]), scale(columnDirection, row * geometry.pixelSpacing[0])),
      );
    },

    patientToPixel(p: Vec3, planeIndex: number): { column: number; row: number } {
      const plane = at(geometry.planes, planeIndex);
      const rel = sub(p, plane.position);
      return {
        column: dot(rel, rowDirection) / geometry.pixelSpacing[1],
        row: dot(rel, columnDirection) / geometry.pixelSpacing[0],
      };
    },

    findNearestPlane(p: Vec3): { planeIndex: number; distanceMm: number } {
      let best = { planeIndex: -1, distanceMm: Infinity };
      geometry.planes.forEach((plane, planeIndex) => {
        const distanceMm = Math.abs(dot(sub(p, plane.position), gridNormal));
        if (distanceMm < best.distanceMm) best = { planeIndex, distanceMm };
      });
      return best;
    },
  };

  return geometry;
}

export interface CreateUniformGridParams {
  readonly rows: number;
  readonly columns: number;
  readonly planeCount: number;
  readonly pixelSpacing: readonly [number, number];
  readonly sliceSpacingMm: number;
  readonly rowDirection?: Vec3;
  readonly columnDirection?: Vec3;
  readonly origin?: Vec3;
  readonly frameOfReferenceUID?: string;
}

/** Sugar over createGridGeometry for the common case: N evenly-spaced parallel planes. */
export function createUniformGrid(params: CreateUniformGridParams): GridGeometry {
  const rowDirection = params.rowDirection ?? ([1, 0, 0] as Vec3);
  const columnDirection = params.columnDirection ?? ([0, 1, 0] as Vec3);
  const origin = params.origin ?? ([0, 0, 0] as Vec3);
  const normal = normalize(cross(rowDirection, columnDirection));

  const planePositions: Vec3[] = Array.from({ length: params.planeCount }, (_, i) =>
    add(origin, scale(normal, i * params.sliceSpacingMm)),
  );

  return createGridGeometry({
    rows: params.rows,
    columns: params.columns,
    rowDirection,
    columnDirection,
    pixelSpacing: params.pixelSpacing,
    planePositions,
    frameOfReferenceUID: params.frameOfReferenceUID,
  });
}
