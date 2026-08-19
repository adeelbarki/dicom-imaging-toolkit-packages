import { describe, expect, it } from "vitest";
import { chunkPoints } from "../../src/dicom/port.js";
import { MalformedContourError } from "../../src/errors.js";

describe("chunkPoints: ContourData must be a multiple of 3, never silently truncated", () => {
  it("a well-formed flat array chunks into the expected points", () => {
    expect(chunkPoints([0, 0, 0, 1, 2, 3])).toEqual([
      [0, 0, 0],
      [1, 2, 3],
    ]);
  });

  it("an empty array is valid — zero points, not malformed", () => {
    expect(chunkPoints([])).toEqual([]);
  });

  it("a length not divisible by 3 throws instead of dropping the trailing values", () => {
    expect(() => chunkPoints([0, 0, 0, 1, 2])).toThrow(MalformedContourError);
    expect(() => chunkPoints([0, 0])).toThrow(MalformedContourError);
    expect(() => chunkPoints([0, 0, 0, 1, 2, 3, 9])).toThrow(MalformedContourError);
  });
});
