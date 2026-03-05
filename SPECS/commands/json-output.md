# JSON Output Improvements

**Status:** ✅ Done (2026-03-05)

## Purpose

Improve the JSON output of all commands to match exactly what is shown in the console output — no extra noise or internal fields.

## Approach

Use `pickDeep(data, paths)` from `src/utils/output.ts` to deep-pick only the fields that are shown in the console output. The function uses lodash `get`/`set` to handle nested paths.

```typescript
const picked = pickDeep(data, ["a.b.c", "x"]);
```

For arrays, map each item individually:
```typescript
items.map((item) => pickDeep(item, [...paths]))
```

## Special cases

- **Commit SHAs**: include the full SHA, not the first 7 characters shown in console
- **Dates**: include full ISO timestamps, not the pretty-formatted date
- **IDs**: only include IDs already shown in the console output

## Tasks

- [x] Update all commands to filter out unnecessary data and show only the data that is shown in their console output
- [x] Add tests for the new JSON output
- [x] Update `src/commands/CLAUDE.md` to document the pattern for new commands

## Commands updated

`info`, `repositories`, `repository`, `pull-request` (default, `--issue`, `--diff` modes), `issues` (list and overview modes), `issue`, `findings`, `finding`, `tools`, `patterns`
