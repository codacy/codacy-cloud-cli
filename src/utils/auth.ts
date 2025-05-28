export function checkApiToken(): string {
  const apiToken = process.env.CODACY_API_TOKEN;
  if (!apiToken) {
    throw new Error("CODACY_API_TOKEN environment variable is not set.");
  }
  return apiToken;
}
