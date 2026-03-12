# `tools`, `tool`, `patterns`, `pattern` Commands Spec

**Status:** ✅ Done (2026-02-25)

---

# `tools` Command

## Purpose

List all tools available for a repository and their status (enabled/disabled, configuration file usage).

## Usage

```
codacy tools <provider> <organization> <repository>
codacy tools gh my-org my-repo --output json
```

## API Endpoints

- [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) — `AnalysisService.listRepositoryTools(provider, org, repo)`

## Output

Two groups separated by headers: "✅ Enabled tools (N)" and "❌ Disabled tools (N)".

Each group is a columnar table with columns:

| Column | Notes |
|---|---|
| Tool | Tool name |
| Config File | `Applied` / `Available` / `—` |
| Via Standard | Coding standard name(s), or `Overwritten by file` if config file is used, or `—` |
| Notes | `Client-side tool` if applicable, otherwise `—` |

## Tests

File: `src/commands/tools.test.ts` — 6 tests.

---

# `tool` Command

## Purpose

Enable, disable, or configure a specific tool for a repository.

## Usage

```
codacy tool <provider> <organization> <repository> <toolName> --enable
codacy tool <provider> <organization> <repository> <toolName> --disable
codacy tool <provider> <organization> <repository> <toolName> --configuration-file true
```

## Options

| Option | Short | Description |
|---|---|---|
| `--enable` | `-e` | Enable the tool |
| `--disable` | `-d` | Disable the tool |
| `--configuration-file <true/false>` | `-c` | Use or stop using the tool's configuration file |

## API Endpoints

1. [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) — to resolve tool name to UUID
2. [`configureTool`](https://api.codacy.com/api/api-docs#configuretool) — `AnalysisService.configureTool(provider, org, repo, toolUuid, body)`

## Tool name matching

The API requires a tool UUID. Tool name matching uses best-match logic (implemented in `findToolByName` in `utils/formatting.ts`):
1. Exact match (case-insensitive, hyphens treated as spaces)
2. Tool name starts with input + space (e.g. `jackson` → "Jackson Linter")
3. Any prefix match — shortest wins

To match a tool with spaces in the name, replace spaces with hyphens (e.g. `eslint-(deprecated)` → "ESLint (deprecated)").

## Output

On success: confirmation message per action taken (e.g. "✓ ESLint enabled."). On failure: error from API.

## Tests

File: `src/commands/tool.test.ts` — 9 tests.

---

# `patterns` Command

## Purpose

List patterns for a specific tool in a repository, with optional filters. Also supports bulk enabling/disabling matching patterns.

## Usage

```
codacy patterns <provider> <organization> <repository> <toolName>
codacy patterns gh my-org my-repo eslint --severities Critical,High --enabled
codacy patterns gh my-org my-repo eslint --output json
codacy patterns gh my-org my-repo eslint --enable-all --categories Security
codacy patterns gh my-org my-repo eslint --disable-all --severities Minor
```

## Options

| Option | Short | Description |
|---|---|---|
| `--languages <languages>` | `-l` | Comma-separated language names |
| `--categories <categories>` | `-C` | Comma-separated category names |
| `--severities <severities>` | `-s` | Comma-separated severity levels |
| `--tags <tags>` | `-t` | Comma-separated tag names |
| `--search <term>` | `-q` | Search term |
| `--enabled` | `-e` | Show only enabled patterns (list mode only) |
| `--disabled` | `-D` | Show only disabled patterns (list mode only) |
| `--recommended` | `-r` | Show only recommended patterns |
| `--enable-all` | `-E` | Bulk enable matching patterns |
| `--disable-all` | `-X` | Bulk disable matching patterns |

## API Endpoints

1. [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) — to resolve tool name to UUID
2. [`listRepositoryToolPatterns`](https://api.codacy.com/api/api-docs#listrepositorytoolpatterns) — list mode
3. [`updateRepositoryToolPatterns`](https://api.codacy.com/api/api-docs#updaterepositorytoolpatterns) — bulk update mode (`--enable-all` / `--disable-all`)
4. [`toolPatternsOverview`](https://api.codacy.com/api/api-docs#toolpatternsoverview) — fetched after bulk update to show summary counts

## Modes

### List mode (default)

Card-style format, sorted by severity (Critical > High > Medium > Minor), then recommended (true first), then title alphabetically:

```
────────────────────────────────────────
{✅/❌} {Title} ({id dimmed}) | {Recommended? in purple}
   {Severity colored} | {Category} {SubCategory?} | {Languages} | {Tags}
   {Description}

   Why? {Rationale}
   How to fix? {Solution}

   Parameters:        ← only when enabled and parameters are set
     - {name} = {value}
────────────────────────────────────────
```

Shows pagination warning if more than 100 results exist.

### Bulk update mode (`--enable-all` / `--disable-all`)

Enables or disables all patterns matching the applied filters (languages, categories, severities, tags, search, recommended). The `--enabled`/`--disabled` filter is not used in bulk update mode since it would be redundant. `--enable-all` and `--disable-all` are mutually exclusive.

After the update, fetches the tool patterns overview and shows a summary:
```
✔ Enabled matching ESLint patterns. 120/200 patterns now enabled.
```

## Tests

File: `src/commands/patterns.test.ts` — 23 tests.

---

# `pattern` Command

## Purpose

Enable, disable, or set parameters for a specific pattern.

## Usage

```
codacy pattern <provider> <organization> <repository> <toolName> <patternId> --enable
codacy pattern <provider> <organization> <repository> <toolName> <patternId> --disable
codacy pattern <provider> <organization> <repository> <toolName> <patternId> --parameter maxParams=3
```

## Options

| Option | Short | Description |
|---|---|---|
| `--enable` | `-e` | Enable the pattern |
| `--disable` | `-d` | Disable the pattern |
| `--parameter <name=value>` | `-p` | Set a parameter (repeatable) |

## API Endpoints

1. [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) — to resolve tool name to UUID
2. [`listRepositoryToolPatterns`](https://api.codacy.com/api/api-docs#listrepositorytoolpatterns) — only when neither `--enable` nor `--disable` is set, to fetch current enabled state
3. [`configureTool`](https://api.codacy.com/api/api-docs#configuretool) — with a single-pattern `patterns` array in the body

## Output

On success: confirmation message per action taken. On failure: error from API.

## Tests

File: `src/commands/pattern.test.ts` — 8 tests.
