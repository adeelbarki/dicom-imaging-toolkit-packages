import { writeRTStruct } from "../src/dicom/port.js";
import type { Contour } from "../src/contour/types.js";

interface FixtureRoiSpec {
  readonly name: string;
  readonly contours?: readonly Contour[];
  readonly referencedFrameOfReferenceUID?: string;
}

interface FixtureSpec {
  readonly rois: readonly FixtureRoiSpec[];
  readonly shuffleSequences?: boolean;
  readonly omitRTROIObservations?: boolean;
}

/** A small, arbitrary closed contour — stands in wherever a test doesn't care about geometry. */
function defaultContour(): Contour {
  return {
    geometricType: "CLOSED_PLANAR",
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  };
}

/** Fixtures are BUILT, never checked in — see IMPLEMENTATION_PLAN.md section 7. */
export function buildFixture(spec: FixtureSpec): ArrayBuffer {
  return writeRTStruct({
    rois: spec.rois.map((roi) => ({
      name: roi.name,
      contours: roi.contours ?? [defaultContour()],
      referencedFrameOfReferenceUID: roi.referencedFrameOfReferenceUID,
    })),
    shuffleSequences: spec.shuffleSequences,
    omitRTROIObservations: spec.omitRTROIObservations,
  });
}
