/**
 * Bump alongside `package.json` `"version"`. `tests/unit/version.test.ts` asserts the two
 * are equal, so a forgotten bump fails the build rather than shipping a stale value in
 * conversion provenance.
 */
export const VERSION = "0.1.1";
