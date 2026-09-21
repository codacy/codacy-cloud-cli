import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // CODACY_PROJECT_TOKEN outranks CODACY_API_TOKEN in the auth precedence, and
    // it is the variable the Codacy coverage reporter reads — so it is routinely
    // exported job-wide in CI and set in many developers' shells. Neutralize it
    // here so token resolution under test never depends on the ambient
    // environment. Empty string is falsy for every `if (env)` check.
    // Terminal styling is environment-dependent: ansis stays off on a
    // developer's non-TTY test run but turns itself on under GitHub Actions,
    // where a bold count inside a sentence ("Would delete <b>2</b> of 3 tags")
    // splits the string assertions match against. Pin it off so a test that
    // passes locally passes in CI.
    env: { CODACY_PROJECT_TOKEN: "", NO_COLOR: "1" },
  },
});
