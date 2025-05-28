import { Command } from "commander";
import ansis from "ansis";
import { AccountService } from "../api/client/services/AccountService";
import { checkApiToken } from "../utils/auth";
import { handleError } from "../utils/error";
import Table from "cli-table3";
import ora from "ora";

function providerLabel(provider: string): string {
  switch (provider) {
    case "gh":
      return "GitHub";
    case "gl":
      return "GitLab";
    case "bb":
      return "BitBucket";
    default:
      return provider;
  }
}

export function registerOrgsCommand(program: Command) {
  program
    .command("orgs")
    .description("List organizations available to the authenticated user")
    .action(async () => {
      try {
        checkApiToken();
        const spinner = ora("Fetching organizations...").start();
        let response;
        try {
          response = await AccountService.listUserOrganizations();
          spinner.succeed("Organizations fetched.");
        } catch (apiErr) {
          spinner.fail("Failed to fetch organizations.");
          throw apiErr;
        }
        let orgs = response.data;
        if (!orgs.length) {
          console.log(ansis.yellow("No organizations found."));
          return;
        }
        // Sort by provider, then name
        orgs = orgs.sort((a, b) => {
          if (a.provider !== b.provider)
            return a.provider.localeCompare(b.provider);
          return a.name.localeCompare(b.name);
        });
        const table = new Table({
          head: [
            ansis.bold("Provider"),
            ansis.bold("Name"),
            ansis.bold("Type"),
            ansis.bold("Join Mode"),
            ansis.bold("Join Status"),
            ansis.bold("Created"),
          ],
          style: { head: [], border: [] },
        });
        let lastProvider = null;
        for (const org of orgs) {
          const provider = providerLabel(org.provider);
          // Optionally group by provider with a separator row
          if (provider !== lastProvider) {
            if (lastProvider !== null) table.push([]); // blank row between groups
            lastProvider = provider;
          }
          table.push([
            provider,
            org.name,
            org.type,
            org.joinMode || "-",
            org.joinStatus || "-",
            org.created ? org.created.split("T")[0] : "-",
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        handleError(err);
      }
    });
}
