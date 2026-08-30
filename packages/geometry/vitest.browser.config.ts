import { defineConfig } from "vitest/config";

// rt-geometry-js has no dependencies and no Node API use, so its full unit suite runs
// unchanged in a real browser. This proves the "browser-native" claim for the one package
// that can make it unconditionally; the dcmjs-dependent domain packages are covered by the
// bundle smoke test (scripts/bundle-smoke.mjs) instead.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
