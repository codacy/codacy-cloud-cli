import { Command } from "commander";
import ansis from "ansis";
import { AccountService } from "../api/client/services/AccountService";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import ora from "ora";

export function registerUserCommand(program: Command) {
  program
    .command("user")
    .description(
      "Get information about the authenticated user from the Codacy API"
    )
    .action(async () => {
      try {
        checkApiToken();
        const spinner = ora("Fetching user info...").start();
        let response;
        try {
          response = await AccountService.getUser();
          spinner.succeed("User info fetched.");
        } catch (apiErr) {
          spinner.fail("Failed to fetch user info.");
          throw apiErr;
        }
        const user = response.data;
        console.log(ansis.cyan("User information:"));
        console.log(`${ansis.bold("ID:")} ${user.id}`);
        if (user.name) {
          console.log(`${ansis.bold("Name:")} ${user.name}`);
        }
        console.log(`${ansis.bold("Email:")} ${user.mainEmail}`);
        if (user.otherEmails && user.otherEmails.length > 0) {
          console.log(
            `${ansis.bold("Other Emails:")} ${user.otherEmails.join(", ")}`
          );
        }
        console.log(
          `${ansis.bold("Admin:")} ${
            user.isAdmin ? ansis.green("Yes") : ansis.yellow("No")
          }`
        );
        console.log(
          `${ansis.bold("Active:")} ${
            user.isActive ? ansis.green("Yes") : ansis.red("No")
          }`
        );
        console.log(`${ansis.bold("Created:")} ${user.created}`);
      } catch (err) {
        handleError(err);
      }
    });
}
