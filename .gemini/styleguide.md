# Codacy Cloud CLI — review style guide

Project-specific conventions for reviewing this repository (a TypeScript +
Commander.js CLI). Please weigh these before flagging style or correctness
concerns.

## Testing
- Tests mutate `process.env` directly: set the variable in `beforeEach` (which
  re-assigns it before every test, so leakage between tests is a non-issue) and,
  when a specific test needs it unset, `delete` it inside that test. An
  `afterEach` cleanup block is **not** required and is **not** the convention —
  ~13 of the 14 test files (`repositories.test.ts`, `issue.test.ts`,
  `findings.test.ts`, …) use `beforeEach` only. Do **not** suggest adding
  `afterEach`, and do **not** suggest `vi.stubEnv` / `vi.unstubAllEnvs` — the
  codebase deliberately does not use them, and consistency across the suite is
  preferred.
- API service calls are mocked with `vi.mock(...)`; tests are co-located as
  `<module>.test.ts` next to the source.

## Output streams
- The command's data payload goes to **stdout**; all human-readable diagnostics
  (spinners via `ora`, the "update available" notice) go to **stderr**.
  `--output json` must keep stdout byte-clean.
- The update-available notice uses `update-notifier`, which prints to stderr and
  self-suppresses for non-TTY / CI / `--output json`. Don't flag it as stdout or
  JSON-output pollution.

## Dependencies
- Runtime dependencies, devDependencies, and `overrides` are all pinned to exact
  versions (no `^`/`~`) for reproducibility and to avoid dependency-confusion
  risk. Flagging an unpinned range is correct; suggesting a range is not.

## CLI output / rendering
- `src/utils/formatting.ts` has two issue-card renderers that differ **on
  purpose**: `printIgnoredIssueCard` omits the "Potential false positive"
  warning that `printIssueCard` shows, because an ignored issue already surfaces
  its ignore reason (usually `FalsePositive`) on the metadata line. Don't flag
  the missing warning as a parity gap. The shared header/message/file-line block
  is factored into `printIssueCardBody`; the trailing sections diverge by design.

## Generated files
- `package-lock.json` and everything under `src/api/client/**` are generated.
  Complexity, duplication, and size findings on these are false positives.

## Terminal output that looks like markup
- Angle brackets in help text, hints and error messages are CLI placeholder
  notation for an argument (`--tag <tag>`, `<image>`), not HTML. A
  "template literal looks like HTML" finding on CLI copy is a false positive —
  nothing here reaches a browser.
- Before flagging a missing `sanitizeText()`, check the sink: values that came
  back from the **API** are the untrusted ones. A value the user typed on their
  own command line is not, and neither is the `console.log` boundary or the
  `--output json` path. `AGENTS.md` lists the sinks.
