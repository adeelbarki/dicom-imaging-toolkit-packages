import { NotImplementedError } from "../errors.js";
import type { Diagnostic, GridGeometry, Mask3D, Provenance } from "../types.js";
import type { Contour } from "./types.js";

export interface RasterizeResult {
  readonly mask: Mask3D;
  readonly provenance: Provenance;
  readonly diagnostics: readonly Diagnostic[];
}

/** contours -> mask. Half-open edge rule (y0 <= y < y1) — see IMPLEMENTATION_PLAN.md Phase 3. */
export function rasterize(_contours: readonly Contour[], _grid: GridGeometry): RasterizeResult {
  throw new NotImplementedError("rasterize is not implemented yet (Phase 3)");
}
