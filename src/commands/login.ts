import { Command } from "commander";
import ansis from "ansis";
import ora from "ora";
import { OpenAPI } from "../api/client/core/OpenAPI";
import { AccountService } from "../api/client/services/AccountService";
import { handleError } from "../utils/error";
import {
  saveCredentials,
  getCredentialsPath,
  promptForToken,
} from "../utils/credentials";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Authenticate with Codacy by storing your API token")
    .option("-t, --token <token>", "API token (skips interactive prompt)")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy login
  $ codacy login --token <your-api-token>

Get your token at: https://app.codacy.com/account/access-management
  My Account > Access Management > API Tokens`,
    )
    .action(async (options) => {
      try {
        let token: string;

        if (options.token) {
          token = options.token;
        } else {
          console.log(ansis.bold("\nCodacy Login\n"));
          console.log("You need an Account API Token to authenticate.");
          console.log(
            `Get one at: ${ansis.cyan("https://app.codacy.com/account/access-management")}`,
          );
          console.log(
            ansis.dim("  My Account > Access Management > API Tokens\n"),
          );

          token = await promptForToken("API Token: ");

          if (!token.trim()) {
            console.error(ansis.red("Error: Token cannot be empty."));
            process.exit(1);
          }

          token = token.trim();
        }

        const spinner = ora("Validating token...").start();

        OpenAPI.HEADERS = {
          "api-token": token,
          "X-Codacy-Origin": "cli-cloud-tool",
        };

        let userName: string;
        let userEmail: string;
        try {
          const response = await AccountService.getUser();
          userName = response.data.name || "Unknown";
          userEmail = response.data.mainEmail;
        } catch (apiErr: any) {
          spinner.fail("Authentication failed.");
          if (apiErr?.status === 401) {
            throw new Error(
              "Invalid API token. Check that it is correct and not expired.",
            );
          }
          throw new Error(
            "Could not reach the Codacy API. Check your network connection.",
          );
        }

        saveCredentials(token);
        spinner.succeed(`Logged in as ${ansis.bold(userName)} (${userEmail})`);
        console.log(ansis.dim(`  Token stored at ${getCredentialsPath()}`));
      } catch (err) {
        handleError(err);
      }
    });
}
