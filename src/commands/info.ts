import { Command } from "commander";
import ora from "ora";
import ansis from "ansis";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import {
  createTable,
  getOutputFormat,
  pickDeep,
  printJson,
  printPaginationWarning,
} from "../utils/output";
import { providerDisplayName } from "../utils/providers";
import { AccountService } from "../api/client/services/AccountService";

export function registerInfoCommand(program: Command) {
  program
    .command("info")
    .alias("i")
    .description("Show authenticated user information and organizations")
    .addHelpText(
      "after",
      `
Examples:
  $ codacy-cloud-cli info
  $ codacy-cloud-cli info --output json`,
    )
    .action(async function (this: Command) {
      try {
        checkApiToken();
        const format = getOutputFormat(this);
        const spinner = ora("Fetching user info...").start();

        const [userResponse, orgsResponse] = await Promise.all([
          AccountService.getUser(),
          AccountService.listUserOrganizations(),
        ]);

        spinner.stop();

        const user = userResponse.data;
        const orgs = orgsResponse.data;

        if (format === "json") {
          printJson(pickDeep({ user, organizations: orgs }, [
            "user.name",
            "user.mainEmail",
            "user.otherEmails",
            "user.isAdmin",
            "user.isActive",
            "organizations",
          ]));
          return;
        }

        // User info
        console.log(ansis.bold("\nUser Information\n"));
        const userTable = createTable();
        userTable.push(
          { Name: user.name || "N/A" },
          { Email: user.mainEmail },
          {
            "Other Emails":
              user.otherEmails.length > 0
                ? user.otherEmails.join(", ")
                : "None",
          },
          { Administrator: user.isAdmin ? ansis.green("Yes") : "No" },
          { Active: user.isActive ? ansis.green("Yes") : ansis.red("No") },
        );
        console.log(userTable.toString());

        // Organizations
        if (orgs.length === 0) {
          console.log(ansis.dim("\nNo organizations found."));
          return;
        }

        console.log(ansis.bold("\nOrganizations\n"));
        const orgsTable = createTable({
          head: ["Name", "Provider", "Type", "Join Status"],
        });

        for (const org of orgs) {
          orgsTable.push([
            org.name,
            providerDisplayName(org.provider),
            org.type,
            org.joinStatus || "N/A",
          ]);
        }

        console.log(orgsTable.toString());

        printPaginationWarning(
          orgsResponse.pagination,
          "Not all organizations are shown.",
        );
      } catch (err) {
        handleError(err);
      }
    });
}
