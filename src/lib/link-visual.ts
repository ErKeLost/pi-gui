const domainIcons: [string[], string][] = [
  [["github.com", "gist.github.com"], "github-logo"],
  [["youtube.com", "youtu.be"], "youtube-logo-fill"],
  [["x.com", "twitter.com"], "x-logo"],
  [["figma.com"], "figma-logo"],
  [["discord.com", "discord.gg"], "discord-logo"],
  [["slack.com"], "slack-logo"],
  [["linkedin.com"], "linkedin-logo"],
  [["reddit.com"], "reddit-logo"],
];

export function externalLinkIcon(href?: string) {
  if (!href) return "globe";
  try {
    const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return domainIcons.find(([domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[1] ?? "globe";
  } catch {
    return "globe";
  }
}
