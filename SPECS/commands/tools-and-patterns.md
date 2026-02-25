# `tools` Command Spec

## Purpose
List all tools available for a repository and their status (enabled/disabled, using configuration file or not)


## Usage
```
codacy tools <provider> <organization> <repository>
codacy tools gh my-org my-repo --output json
```

## API Endpoints
- [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools)

## Considerations
- Tools can be enabled by users for that specific repository, or by an applied Coding Standard.
- Tools may support local configuration files; if so, they would indicate if a configuration file was detected and if it is being used.


## Output

List first all enabled tools for the repository (under a title "✅ Enabled tools"), then all disabled tools for the repository (under a title "❌ Disabled tools").

For each tool, show the following information:
- Tool name
- If enabled in a Coding Standard, show the Coding Standard name
- Tool configuration file status (Available, Not Available, Applied)
- Notes
  - if the tool is client-side, show 'Client-side tool'

# `tool` Command Spec
## Purpose
Enable or disable a specific tool for a repository.

## Usage
```
codacy tool <provider> <organization> <repository> <tool name> --enable
codacy tool <provider> <organization> <repository> <tool name> --disable
codacy tool <provider> <organization> <repository> <tool name> --configuration-file true
```

### Options
- `--enable, -e`
- `--disable, -d`
- `--configuration-file, -cf <true/false>`

### Output
If successful, return a success message with the action taken ("Tool X enabled", "Tool X uses now a configuration file", etc). Otherwise, return an error message with the error details provided by the API.


## API Endpoints
- [`configureTool`](https://api.codacy.com/api/api-docs#configuretool)

## Considerations
The API expects a tool UUID, not the tool name, so we need to fetch the tool UUID first. We can do this by calling the [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools) API endpoint. We should match the tool name by "best match" using the `name` field.

e.g.
- for `trivy`, we'll match the tool called "Trivy"
- for `eslint`, we'll match the tool called "ESLint", but not the tool called "ESLint (deprecated)" nor the tool called "ESLint9"
- for `jackson`, we'll match the tool called "Jackson Linter"
- to match a tool with spaces in the name, the user needs to replace the spaces with a hyphen `-`; e.g. `eslint-(deprecated)` should match the tool called "ESLint (deprecated)"



# `patterns` Command Spec

## Purpose
List all tool patterns for a repository and their status (enabled/disabled, parameters)

## Options
- `--languages <languages>`
- `--categories <categories>`
- `--severities <severities>`
- `--tags <tags>`
- `--search <search>`
- `--enabled`
- `--disabled`
- `--recommended`

## Usage
```
codacy patterns <provider> <organization> <repository> <tool name>
codacy patterns gh my-org my-repo eslint
codacy patterns gh my-org my-repo eslint ---categories security,errorprone --severities critical,high --search "sql injection" --disabled --recommended
```

## API Endpoints
- [`listRepositoryTools`](https://api.codacy.com/api/api-docs#listrepositorytools)
- [`listRepositoryToolPatterns`](https://api.codacy.com/api/api-docs#listrepositorytoolpatterns)

## Considerations
Have the same considerations described in the `tool` command spec about matching the tool name.


## Output
Instead of a table, show a card-style format for each pattern.
```
────────────────────────────────────────
{✅/❌} {Title in white if enabled, gray if disabled} ({id in dark gray}) | {Recommended? in purple}
   {Severity colored} | {Category} {SubCategory?} | {Languages} | {Tags}
   {Description}

   Why? {Rationale}
   How to fix? {Solution}

  <IF THERE ARE PARAMETERS SET AND PATTERN IS ENABLED>
  Parameters:
    - {Parameter name} = {Parameter value}
    ...
  </IF THERE ARE PARAMETERS SET AND PATTERN IS ENABLED>
────────────────────────────────────────
```

- "Why?" and "How to fix?" should be in white; their content should be in dim gray
- Sort the results by severity (Critical > High > Medium > Minor), then by recommended (true > false), then by title alphabetically
- As with other commands, if the results return more than 100 items, show a pagination warning and suggest filters to use.


#`pattern` Command Spec
## Purpose
Enable or disable a specific pattern for a repository, and set its parameters if available.

## Usage
```
codacy pattern <provider> <organization> <repository> <tool name> <pattern id> --enable
codacy pattern <provider> <organization> <repository> <tool name> <pattern id> --disable
codacy pattern <provider> <organization> <repository> <tool name> <pattern id> --parameter <parameter name> <parameter value>
```

### Options
- `--enable, -e`
- `--disable, -d`
- `--parameter, -p <parameter name> <parameter value>`

## API Endpoints
- [`configureTool`](https://api.codacy.com/api/api-docs#configuretool)

## Considerations
Have the same considerations described in the `tool` command spec about matching the tool name.