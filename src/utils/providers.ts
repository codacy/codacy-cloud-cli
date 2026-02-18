const providerNames: Record<string, string> = {
  gh: "GitHub",
  gl: "GitLab",
  bb: "Bitbucket",
};

export function providerDisplayName(provider: string): string {
  return providerNames[provider] || provider;
}
