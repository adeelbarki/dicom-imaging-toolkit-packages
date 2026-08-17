import { NotImplementedError } from "../errors.js";
import type { Mask3D } from "../types.js";
import type { Contour } from "./types.js";

/** mask -> contours. Never the inverse gate — see IMPLEMENTATION_PLAN.md Phase 4. */
export function vectorize(_mask: Mask3D): readonly Contour[] {
  throw new NotImplementedError("vectorize is not implemented yet (Phase 4)");
}
