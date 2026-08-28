export type Vec3 = readonly [number, number, number];

/**
 * A physical sampling grid. NOT necessarily DICOM-derived — may come from an
 * AI model, a resampling operation, NIfTI, or a synthetic phantom.
 *
 * v0.1 grid constraint: all planes share rows/columns/pixelSpacing/direction
 * and are mutually parallel. Plane-to-plane distance MAY vary.
 */
export interface GridGeometry {
  readonly rows: number;
  readonly columns: number;
  readonly rowDirection: Vec3;
  readonly columnDirection: Vec3;
  readonly pixelSpacing: readonly [number, number];
  /** Sorted along the normal, strictly increasing. Spacing may be irregular. */
  readonly planes: readonly GridPlane[];
  readonly frameOfReferenceUID?: string;

  normal(): Vec3;
  /**
   * THE authority for operation safety. Tolerance-based, NOT transitive. If both grids
   * declare a `frameOfReferenceUID` and they differ, always `false` regardless of
   * tolerance — physically non-comparable coordinate systems. Either side undefined is
   * not treated as a mismatch (falls through to the geometric comparison).
   */
  equals(other: GridGeometry, tol?: GridTolerance): boolean;
  /**
   * Cache/lookup hint ONLY. A pure hash of raw values (~0.001 precision), not aligned with
   * equals()'s tolerances (which are looser, per-field, and caller-overridable). A MATCH
   * must still be confirmed with equals(); a MISMATCH is not proof of inequality.
   */
  fingerprint(): string;
  isUniformlySpaced(tolMm?: number): boolean;
  indexToPatient(column: number, row: number, planeIndex: number): Vec3;
  /**
   * Orthogonally projects a patient-space point onto the given plane and returns
   * continuous pixel coordinates — this does not check whether the point actually lies on
   * (or near) that plane. A point arbitrarily far out of plane still returns a result.
   */
  patientToPixel(p: Vec3, planeIndex: number): { column: number; row: number };
  findNearestPlane(p: Vec3): { planeIndex: number; distanceMm: number };
  /**
   * Physical thickness attributed to one plane: the average of the distances to its
   * neighbours, or the single-neighbour distance at the ends of the stack. For uniformly
   * spaced grids this is exactly the slice spacing. Throws for a single-plane grid — with
   * no second plane there is nothing to measure spacing from.
   */
  planeThicknessMm(planeIndex: number): number;
}

export interface GridPlane {
  readonly position: Vec3;
}

export interface GridTolerance {
  positionMm: number;
  spacingMm: number;
  directionAngleRad: number;
}

export type SliceAssociation = "sop-reference" | "geometric-fallback";
export type HoleInterpretation = "xor" | "keyhole" | "nested-even-odd" | "none";

/** History: how did we get this result? */
export interface Provenance {
  readonly sliceAssociation: SliceAssociation;
  readonly holeInterpretation: HoleInterpretation;
  readonly frameOfReferenceOverride: boolean;
  readonly sourceSOPInstanceUIDs?: readonly string[];
  /** Strips quasi-identifiers (UIDs) so the object is safe to log. */
  redact(): Provenance;
}

export type Severity = "info" | "warning" | "error";

/**
 * Problems and ambiguities. Distinct from Provenance. `code` is a free string here: the
 * geometry core has no fixed vocabulary of its own beyond a handful of plane-sort codes,
 * and downstream packages (rtstruct, rtdose, dicom-seg) each layer their own code unions
 * on top without this package needing to know about them.
 */
export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly detail?: Readonly<Record<string, number | string | boolean>>;
  redact(): Diagnostic;
}

export type VolumeMethod = "voxel" | "contour";

export interface VolumeResult {
  readonly valueMm3: number;
  /** Always attached. A physicist WILL compare this against their TPS. */
  readonly method: VolumeMethod;
}

/** Interface, never a class: storage representation must stay internal. */
export interface Mask3D {
  readonly geometry: GridGeometry;
  /** [columns, rows, planes] */
  readonly dimensions: readonly [number, number, number];
  /** Convenience. NOT the fast path. */
  get(column: number, row: number, planeIndex: number): boolean;
  /** Bulk access. Length === rows * columns. */
  getSliceBuffer(planeIndex: number): Uint8Array;
  count(): number;
  volume(opts?: { method?: VolumeMethod }): VolumeResult;
}
