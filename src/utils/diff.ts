import gitDiffParser, { File } from "gitdiff-parser";
import { sortBy } from "lodash";

// TODO: remove this when the API has the correct diff for commits coming from Git
const curatePath = (path: string, fixLegacyDiff?: boolean) => {
  const res = path
    .replace("/dev/null", "")
    .replace(/"/g, "")
    .replace(/\t/g, "");

  // TODO: remove this as soon as we stop using the old git diff and we only use the one coming from the git provider
  return fixLegacyDiff && res.startsWith("t") ? res.slice(1) : res;
};

export const parseDiff = (diff: string, fixLegacyDiff?: boolean) => {
  const parsedDiff = gitDiffParser.parse(diff);

  return {
    files: sortBy(parsedDiff, ["newPath", "oldPath"])
      .map((file) => ({
        ...file,
        oldPath: curatePath(file.oldPath, fixLegacyDiff),
        newPath: curatePath(file.newPath, fixLegacyDiff),
      }))
      .map((file) => ({
        ...file,
        path: file.newPath || file.oldPath,
      }))
      .map((file) => ({
        ...file,
        directory: file.path.split("/").slice(0, -1).join("/"),
        filename: file.path.split("/").slice(-1)[0],
      })),
  };
};
