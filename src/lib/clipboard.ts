export function normalizeSelectionText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u00a0", " ")
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .join("\n")
    .trim();
}
