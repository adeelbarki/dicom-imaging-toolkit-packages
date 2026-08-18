import { buildFixture } from "./fixtures.js";

/** io.test.ts references buildFixture as an ambient global (`declare function buildFixture(...)`). */
(globalThis as typeof globalThis & { buildFixture: typeof buildFixture }).buildFixture = buildFixture;
