import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";

describe("VERSION", () => {
  it("CONV-VER-01 matches package.json (a forgotten bump would ship a stale value in provenance)", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
