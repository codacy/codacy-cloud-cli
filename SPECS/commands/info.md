# `info` Command Spec

**Status:** ✅ Done (2026-02-17)

## Purpose

Show authenticated user information and their available organizations.

## Usage

```
codacy info
codacy info --output json
```

## API Endpoints

- [`getUser`](https://api.codacy.com/api/api-docs#getuser) — `AccountService.getUser()`
- [`listUserOrganizations`](https://api.codacy.com/api/api-docs#listuserorganizations) — `AccountService.listUserOrganizations()`

Both calls are made in parallel via `Promise.all`.

## Output

### User section (key-value table)

| Field | Source |
|---|---|
| Name | `user.name` |
| Email | `user.email` |
| Other Emails | `user.emails` (comma-separated) |
| Administrator | `user.isAdmin` |
| Active | `user.status === 'active'` |

### Organizations section (columnar table)

| Column | Source |
|---|---|
| Name | `org.name` |
| Provider | `org.provider` (mapped via `utils/providers.ts`) |
| Type | `org.type` |
| Join Status | `org.joinStatus` |

Shows pagination warning if more pages exist.

## Tests

File: `src/commands/info.test.ts` — 4 tests.
