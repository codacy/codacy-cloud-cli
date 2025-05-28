#!/usr/bin/env node
import { Command } from "commander";
import { OpenAPI } from "./api/client/core/OpenAPI";
import { registerUserCommand } from "./commands/user";
import { registerOrgsCommand } from "./commands/orgs";
import { registerReposCommand } from "./commands/repos";

const program = new Command();

OpenAPI.BASE = "https://app.codacy.com/api/v3";
OpenAPI.HEADERS = {
  "api-token": process.env.CODACY_API_TOKEN || "",
  "X-Codacy-Origin": "cli-cloud-tool",
};

program
  .name("codacy-cloud-cli")
  .description("A CLI tool to interact with the Codacy API")
  .version("1.0.0");

registerUserCommand(program);
registerOrgsCommand(program);
registerReposCommand(program);

program
  .command("help")
  .description("Display help information for all commands and options")
  .action(() => {
    program.help();
  });

program.parse(process.argv);
