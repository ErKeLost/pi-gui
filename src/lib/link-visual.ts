import devicon from "@iconify-json/devicon/icons.json";

const domainIcons: [string[], string][] = [
  [["youtube.com", "youtu.be"], "youtube-logo-fill"],
  [["x.com", "twitter.com"], "x-logo"],
  [["discord.com", "discord.gg"], "discord-logo"],
  [["reddit.com"], "reddit-logo"],
];

const tlds = new Set([
  "com", "org", "net", "io", "ai", "co", "app", "dev", "sh", "gg", "be", "cn",
  "info", "edu", "gov", "me", "tv", "cc", "to", "so", "im", "fm", "xyz", "www",
]);

const coloredDevicons = new Set(
  Object.keys(devicon.icons).filter(name => !name.endsWith("-wordmark")),
);

export function linkHostname(href?: string) {
  if (!href) return "";
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function deviconFromHref(href?: string) {
  const hostname = linkHostname(href);
  if (!hostname) return "";
  const labels = hostname.split(".").filter(label => label.length >= 2 && !tlds.has(label));
  const exact = labels.filter(label => coloredDevicons.has(label)).sort((a, b) => b.length - a.length);
  if (exact[0]) return exact[0];
  for (const label of labels) {
    const compact = label.replace(/-/g, "");
    if (compact !== label && coloredDevicons.has(compact)) return compact;
  }
  return "";
}

export function externalLinkIcon(href?: string) {
  const hostname = linkHostname(href);
  if (!hostname) return "globe";
  return domainIcons.find(([domains]) => domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.[1] ?? "globe";
}

export function coloredDeviconCollection() {
  return {
    prefix: devicon.prefix,
    width: devicon.width,
    height: devicon.height ?? 128,
    icons: Object.fromEntries(Object.entries(devicon.icons).filter(([name]) => !name.endsWith("-wordmark"))),
  };
}
