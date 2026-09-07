#!/usr/bin/env node
import { Command } from "commander";
import { OpenAPI } from "./api/client/core/OpenAPI";
import { cliVersion } from "./version";
import { getOutputFormat } from "./utils/output";
import { BASE_HEADERS, repositoryTokenOption } from "./utils/auth";
import { maybeNotifyUpdate } from "./utils/update-check";
import { configureProxyFromEnv } from "./utils/proxy";
import { registerInfoCommand } from "./commands/info";
import { registerRepositoriesCommand } from "./commands/repositories";
import { registerRepositoryCommand } from "./commands/repository";
import { registerLsCommand } from "./commands/ls";
import { registerDirectoriesCommand } from "./commands/directories";
import { registerPullRequestCommand } from "./commands/pull-request";
import { registerPullRequestsCommand } from "./commands/pull-requests";
import { registerIssuesCommand } from "./commands/issues";
import { registerIssueCommand } from "./commands/issue";
import { registerFindingsCommand } from "./commands/findings";
import { registerFindingCommand } from "./commands/finding";
import { registerToolsCommand } from "./commands/tools";
import { registerToolCommand } from "./commands/tool";
import { registerPatternsCommand } from "./commands/patterns";
import { registerPatternCommand } from "./commands/pattern";
import { registerLoginCommand } from "./commands/login";
import { registerLogoutCommand } from "./commands/logout";

const program = new Command();

// Route all outbound fetch traffic through HTTP(S)_PROXY / NO_PROXY and any
// corporate CA before anything can make a request. Delegated to
// `@codacy/tooling` so the environment contract is identical to the Codacy
// Analysis CLI. No-op when no proxy or TLS variable is set. It only has to run
// before `program.parse` — every request happens inside a command action — but
// it goes first so the network stack is configured before we point it at the API.
configureProxyFromEnv();

OpenAPI.BASE = (process.env.CODACY_API_BASE_URL || "https://app.codacy.com").replace(/\/$/, "") + "/api/v3";
// No token here. Which header carries it depends on the token kind, which isn't
// known until a command resolves its auth — every API path installs headers
// first, via `resolveAuth()` in commands or `applyAccountToken()` in `login`.
// Baking in `api-token` would send an empty account header on every
// repository-token run. Shared with `applyAuthHeaders`, which replaces
// OpenAPI.HEADERS wholesale and would otherwise drop anything set only here.
OpenAPI.HEADERS = { ...BASE_HEADERS };

program
  .name("codacy-cloud-cli")
  .description("A CLI tool to interact with the Codacy API")
  .version(cliVersion)
  .option("-o, --output <format>", "output format (table or json)", "table")
  // Declared on the root so `codacy --repository-token X tools` parses; each
  // command declares its own too, so it also works after the command name.
  .addOption(repositoryTokenOption())
  // update-notifier reads `--no-update-notifier` straight from argv to opt out.
  // Declared here (and on every subcommand below) so Commander accepts the flag
  // instead of failing with "unknown option" when a user passes it.
  .option("--no-update-notifier", "disable the 'update available' notice");

// Before any command runs, schedule the "update available" notice. The hook
// fires after option parsing, so the command's output format is known; the
// notice itself is gated to `table` output and printed to stderr on exit.
// Wiring it here (rather than per-command) keeps the entry point thin and avoids
// churn across every command file.
program.hook("preAction", (_thisCommand, actionCommand) => {
  maybeNotifyUpdate(getOutputFormat(actionCommand));
});

registerInfoCommand(program);
registerRepositoriesCommand(program);
registerRepositoryCommand(program);
registerLsCommand(program);
registerDirectoriesCommand(program);
registerPullRequestCommand(program);
registerPullRequestsCommand(program);
registerIssuesCommand(program);
registerIssueCommand(program);
registerFindingsCommand(program);
registerFindingCommand(program);
registerToolsCommand(program);
registerToolCommand(program);
registerPatternsCommand(program);
registerPatternCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);

// Also accept `--no-update-notifier` after a subcommand (e.g.
// `codacy info --no-update-notifier`). update-notifier reads the flag from argv;
// we only need Commander not to reject it as an unknown option.
for (const cmd of program.commands) {
  cmd.option("--no-update-notifier", "disable the 'update available' notice");
}

program.parse(process.argv);
