import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace peer from source so tests run without a build step. The
      // published entry point (dist/) is what npm consumers get; its shape is validated by
      // rt-geometry-js's own build.
      "rt-geometry-js": fileURLToPath(new URL("../geometry/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});
