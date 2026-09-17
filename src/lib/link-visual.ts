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

export function linkHostname(href?: string) {
  if (!href) return "";
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function faviconUrl(href?: string) {
  const hostname = linkHostname(href);
  return hostname ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}` : "";
}

export function externalLinkIcon(href?: string) {
  const hostname = linkHostname(href);
  if (!hostname) return "globe";
  return domainIcons.find(([domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[1] ?? "globe";
}
