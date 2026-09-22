---
"@codacy/codacy-cloud-cli": minor
---

`--reanalyze-and-wait` (on `repository` and `pull-request`) now prints an `elapsed <N>m, status=<status>` progress line to stderr every 60s when stderr is not a TTY. The ora spinner never wrote anything to a piped/non-interactive stderr, so silent CI/agent shells could kill the process as hung during the up-to-20-minute wait. TTY behavior, the 10s poll interval, and the 20-minute cap are unchanged.
