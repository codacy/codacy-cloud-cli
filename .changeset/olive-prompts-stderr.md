---
"@codacy/codacy-cloud-cli": patch
---

Confirmation prompts are now written to stderr instead of stdout.

`--output json` promises that stdout carries exactly one JSON document, and `process.stdin.isTTY` is still true when stdout is a pipe — so `codacy image gh my-org my-service --tag 1.2.3 --delete --output json | jq` sent the question and the echoed keystroke into `jq`, which failed on them. The prompt is interaction, not program output, so it now goes to stderr alongside the spinners and error lines, for every command that confirms (`image --delete`, `issues --ignore`, `tools --import`). Interactive runs look the same; piped ones no longer break.
