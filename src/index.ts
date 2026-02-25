#!/usr/bin/env node
import { Command } from "commander";
import { OpenAPI } from "./api/client/core/OpenAPI";
import { registerInfoCommand } from "./commands/info";
import { registerRepositoriesCommand } from "./commands/repositories";
import { registerRepositoryCommand } from "./commands/repository";
import { registerPullRequestCommand } from "./commands/pull-request";
import { registerIssuesCommand } from "./commands/issues";
import { registerIssueCommand } from "./commands/issue";
import { registerFindingsCommand } from "./commands/findings";
import { registerFindingCommand } from "./commands/finding";
import { registerToolsCommand } from "./commands/tools";
import { registerToolCommand } from "./commands/tool";
import { registerPatternsCommand } from "./commands/patterns";
import { registerPatternCommand } from "./commands/pattern";

const program = new Command();

OpenAPI.BASE = "https://app.codacy.com/api/v3";
OpenAPI.HEADERS = {
  "api-token": process.env.CODACY_API_TOKEN || "",
  "X-Codacy-Origin": "cli-cloud-tool",
};

program
  .name("codacy-cloud-cli")
  .description("A CLI tool to interact with the Codacy API")
  .version("1.0.0")
  .option("-o, --output <format>", "output format (table or json)", "table");

registerInfoCommand(program);
registerRepositoriesCommand(program);
registerRepositoryCommand(program);
registerPullRequestCommand(program);
registerIssuesCommand(program);
registerIssueCommand(program);
registerFindingsCommand(program);
registerFindingCommand(program);
registerToolsCommand(program);
registerToolCommand(program);
registerPatternsCommand(program);
registerPatternCommand(program);

program.parse(process.argv);
