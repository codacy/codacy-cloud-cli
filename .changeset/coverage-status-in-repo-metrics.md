---
"@codacy/codacy-cloud-cli": minor
---

Show the repository's coverage **status**, not just its percentage.

Codacy now reports whether a repository's coverage is up to date, still waiting
on a report, has stopped receiving them, or was never set up — and the CLI can
tell those apart:

- `codacy repos` marks a repository whose latest commit has no report yet with a
  dim `⋯` after its last known value, and shows a dim `⊘` instead of a number
  for one that has stopped receiving reports. A legend under the table explains
  only the states actually present in the listing.
- `codacy repo`'s Metrics section spells the same states out, with the date and
  commit of the last report, and notes when a stopped repository's coverage gate
  is no longer being enforced. A repository that never had coverage now reads
  `Not set up` rather than a bare `N/A`.
- `codacy repo`'s Analysis row reads coverage state from the API's own status
  field instead of inferring it from a separate request. This fixes repositories
  that were reported as healthy while showing a stale percentage, drops one
  request per run, and makes the coverage state available under a repository
  token for the first time.

`--output json` gains `coverage.status`, `coverage.lastCommitWithCoverage`,
`coverage.statusUpdatedAt` and `coverage.valueUpdatedAt` on both commands. Under
a repository token, `codacy repo`'s `unavailable` array is now `["pullRequests"]`
only.
