import { InconsistentSeriesError } from "../errors.js";
import { createDiagnostic } from "../diagnostics/index.js";
import { createGridGeometry } from "../geometry/grid-geometry.js";
import { DEFAULT_TOLERANCE } from "../geometry/tolerance.js";
import { angleBetween, cross, dot, normalize } from "../geometry/vec3.js";
import type { Diagnostic, DicomSliceReference, GridTolerance, SeriesGeometry, Vec3 } from "../types.js";
import { readDicomDataset } from "./port.js";

const SLICE_ORDER_EPSILON_MM = 1e-6;

function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range (length ${arr.length})`);
  return value;
}

interface InstanceGeometry {
  readonly sopInstanceUID: string;
  readonly seriesInstanceUID: string | undefined;
  readonly frameOfReferenceUID: string | undefined;
  readonly rows: number;
  readonly columns: number;
  readonly pixelSpacing: readonly [number, number];
  readonly rowDirection: Vec3;
  readonly columnDirection: Vec3;
  readonly imagePositionPatient: Vec3;
}

/** SOPInstanceUID, Rows/Columns, PixelSpacing, ImageOrientationPatient, and ImagePositionPatient are Type 1/1C in the General/Image Plane Modules — required for any oriented image. */
function extractInstance(dataset: Record<string, unknown>, index: number): InstanceGeometry {
  const sopInstanceUID = dataset["SOPInstanceUID"] as string | undefined;
  const rows = dataset["Rows"] as number | undefined;
  const columns = dataset["Columns"] as number | undefined;
  const pixelSpacing = dataset["PixelSpacing"] as readonly number[] | undefined;
  const orientation = dataset["ImageOrientationPatient"] as readonly number[] | undefined;
  const position = dataset["ImagePositionPatient"] as readonly number[] | undefined;

  if (sopInstanceUID === undefined) throw new RangeError(`instance ${index}: missing SOPInstanceUID`);
  if (rows === undefined) throw new RangeError(`instance ${index}: missing Rows`);
  if (columns === undefined) throw new RangeError(`instance ${index}: missing Columns`);
  if (pixelSpacing === undefined || pixelSpacing.length !== 2) {
    throw new RangeError(`instance ${index}: missing or malformed PixelSpacing`);
  }
  if (orientation === undefined || orientation.length !== 6) {
    throw new RangeError(`instance ${index}: missing or malformed ImageOrientationPatient`);
  }
  if (position === undefined || position.length !== 3) {
    throw new RangeError(`instance ${index}: missing or malformed ImagePositionPatient`);
  }

  return {
    sopInstanceUID,
    seriesInstanceUID: dataset["SeriesInstanceUID"] as string | undefined,
    frameOfReferenceUID: dataset["FrameOfReferenceUID"] as string | undefined,
    rows,
    columns,
    pixelSpacing: [at(pixelSpacing, 0), at(pixelSpacing, 1)],
    rowDirection: [at(orientation, 0), at(orientation, 1), at(orientation, 2)],
    columnDirection: [at(orientation, 3), at(orientation, 4), at(orientation, 5)],
    imagePositionPatient: [at(position, 0), at(position, 1), at(position, 2)],
  };
}

/**
 * v0.1's GridGeometry has exactly one rows/columns/pixelSpacing/orientation
 * for the whole grid, not per-plane — so unlike plane *position* (which may
 * vary freely), these must agree across every instance or there's no valid
 * grid to build. No tolerant fallback to offer, same reasoning as
 * NonParallelPlanesError.
 */
function assertConsistent(instances: readonly InstanceGeometry[], tolerance: GridTolerance): void {
  const first = at(instances, 0);
  for (let i = 1; i < instances.length; i++) {
    const inst = at(instances, i);
    if (inst.rows !== first.rows || inst.columns !== first.columns) {
      throw new InconsistentSeriesError(
        `instance ${i} is ${inst.rows}x${inst.columns}, expected ${first.rows}x${first.columns} (matching instance 0)`,
      );
    }
    if (
      Math.abs(inst.pixelSpacing[0] - first.pixelSpacing[0]) > tolerance.spacingMm ||
      Math.abs(inst.pixelSpacing[1] - first.pixelSpacing[1]) > tolerance.spacingMm
    ) {
      throw new InconsistentSeriesError(`instance ${i} has a different PixelSpacing than instance 0`);
    }
    if (
      angleBetween(inst.rowDirection, first.rowDirection) > tolerance.directionAngleRad ||
      angleBetween(inst.columnDirection, first.columnDirection) > tolerance.directionAngleRad
    ) {
      throw new InconsistentSeriesError(`instance ${i} has a different ImageOrientationPatient than instance 0`);
    }
  }
}

/** True only if every step is strictly decreasing — i.e. the exact reverse of the sort order createGridGeometry requires. */
function isReversedOrder(positions: readonly Vec3[], normal: Vec3): boolean {
  if (positions.length < 2) return false;
  const projections = positions.map((p) => dot(p, normal));
  for (let i = 1; i < projections.length; i++) {
    if (at(projections, i) >= at(projections, i - 1) - SLICE_ORDER_EPSILON_MM) return false;
  }
  return true;
}

export interface ReadSeriesGeometryResult {
  readonly geometry: SeriesGeometry;
  readonly diagnostics: readonly Diagnostic[];
}

/** A set of DICOM CT/MR slice files -> SeriesGeometry. Instance order doesn't matter; createGridGeometry sorts by position. */
export function readSeriesGeometry(
  instances: readonly ArrayBuffer[],
  tolerance: GridTolerance = DEFAULT_TOLERANCE,
): ReadSeriesGeometryResult {
  if (instances.length === 0) throw new RangeError("readSeriesGeometry requires at least one instance");

  const parsed = instances.map((bytes, i) => extractInstance(readDicomDataset(bytes).naturalized, i));
  assertConsistent(parsed, tolerance);

  const first = at(parsed, 0);
  const normal = normalize(cross(first.rowDirection, first.columnDirection));

  const diagnostics: Diagnostic[] = [];
  if (isReversedOrder(parsed.map((p) => p.imagePositionPatient), normal)) {
    diagnostics.push(
      createDiagnostic(
        "SLICE_ORDER_REVERSED",
        "info",
        "input instances were in reverse geometric order; sorted ascending along the grid normal",
      ),
    );
  }

  const grid = createGridGeometry({
    rows: first.rows,
    columns: first.columns,
    rowDirection: first.rowDirection,
    columnDirection: first.columnDirection,
    pixelSpacing: first.pixelSpacing,
    planePositions: parsed.map((p) => p.imagePositionPatient),
    frameOfReferenceUID: first.frameOfReferenceUID,
  });

  const slices: DicomSliceReference[] = parsed.map((p) => ({
    sopInstanceUID: p.sopInstanceUID,
    seriesInstanceUID: p.seriesInstanceUID,
    imagePositionPatient: p.imagePositionPatient,
  }));

  return {
    geometry: { grid, slices, frameOfReferenceUID: first.frameOfReferenceUID },
    diagnostics,
  };
}
