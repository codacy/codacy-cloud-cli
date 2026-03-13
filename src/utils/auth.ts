import { OpenAPI } from "../api/client/core/OpenAPI";
import { loadCredentials } from "./credentials";

export function updateApiHeaders(token: string): void {
  OpenAPI.HEADERS = {
    "api-token": token,
    "X-Codacy-Origin": "cli-cloud-tool",
  };
}

export function checkApiToken(): string {
  const envToken = process.env.CODACY_API_TOKEN;
  if (envToken) {
    updateApiHeaders(envToken);
    return envToken;
  }

  const stored = loadCredentials();
  if (stored) {
    updateApiHeaders(stored);
    return stored;
  }

  throw new Error(
    "No API token found. Set CODACY_API_TOKEN or run 'codacy login'.",
  );
}
