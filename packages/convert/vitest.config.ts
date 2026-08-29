import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace peers from source so tests run without a build step. The
      // published entry points (dist/) are what npm consumers get; their shapes are
      // validated by each package's own build.
      "rt-geometry-js": fileURLToPath(new URL("../geometry/src/index.ts", import.meta.url)),
      "rtstruct-js": fileURLToPath(new URL("../rtstruct/src/index.ts", import.meta.url)),
      "dicom-seg-js": fileURLToPath(new URL("../dicom-seg/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
