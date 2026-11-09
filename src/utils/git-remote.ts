import { execFileSync } from "child_process";

export interface RepoContext {
  provider: string;
  organization: string;
  repository: string;
}

const HOST_TO_PROVIDER: Record<string, string> = {
  "github.com": "gh",
  "gitlab.com": "gl",
  "bitbucket.org": "bb",
};

const SSH_REGEX = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/;
const HTTPS_REGEX = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/;

function stripUserinfo(host: string): string {
  const atIndex = host.indexOf("@");
  return atIndex >= 0 ? host.slice(atIndex + 1) : host;
}

export function parseGitRemoteUrl(url: string): RepoContext | null {
  const match = (SSH_REGEX.exec(url)) ?? (HTTPS_REGEX.exec(url));
  if (!match) return null;

  const [, rawHost, org, repo] = match;
  const host = stripUserinfo(rawHost);
  const provider = HOST_TO_PROVIDER[host];
  if (!provider) return null;

  return { provider, organization: org, repository: repo };
}

export function getGitRemoteUrl(remoteName = "origin"): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", remoteName], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

export function detectRepoContext(): RepoContext {
  const url = getGitRemoteUrl();
  if (!url) {
    throw new Error(
      "Could not detect repository from git remote. " +
        "Specify <provider> <organization> <repository> explicitly, " +
        "or ensure you are inside a git repository with an 'origin' remote.",
    );
  }

  const parsed = parseGitRemoteUrl(url);
  if (!parsed) {
    const supported = Object.entries(HOST_TO_PROVIDER)
      .map(([host, code]) => `${host} (${code})`)
      .join(", ");
    throw new Error(
      `Could not determine provider from git remote URL '${redactUrl(url)}'. ` +
        `Supported providers: ${supported}.`,
    );
  }

  return parsed;
}
