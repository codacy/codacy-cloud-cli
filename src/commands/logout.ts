import { Command } from "commander";
import ansis from "ansis";
import {
  deleteCredentials,
  getCredentialsPath,
} from "../utils/credentials";
import { handleError } from "../utils/error";

export function registerLogoutCommand(program: Command) {
  program
    .command("logout")
    .description("Remove stored Codacy API token")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy logout`,
    )
    .action(() => {
      try {
        const deleted = deleteCredentials();
        if (deleted) {
          console.log(
            ansis.green("Logged out.") +
              ansis.dim(` Removed ${getCredentialsPath()}`),
          );
        } else {
          console.log("No stored credentials found.");
        }
      } catch (err) {
        handleError(err);
      }
    });
}
