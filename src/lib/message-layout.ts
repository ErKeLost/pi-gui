export const COLLAPSED_MESSAGE_LINES = 18;

function visibleMarkdownLine(line: string) {
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

export function estimateMarkdownLines(content: string, charactersPerLine = 60) {
  return content.split(/\r?\n/).reduce((total, line) => {
    const visible = Array.from(visibleMarkdownLine(line)).length;
    return total + Math.max(1, Math.ceil(visible / charactersPerLine));
  }, 0);
}

export function shouldCollapseMessage(content: string) {
  return estimateMarkdownLines(content) > COLLAPSED_MESSAGE_LINES;
}

export function markdownHeadingSections(content: string, idPrefix: string) {
  let fenced = false;
  const sections: Array<{ id: string; label: string; level: 1 | 2 | 3 | 4 | 5 | 6 }> = [];

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const label = visibleMarkdownLine(match[2]);
    if (!label) continue;
    sections.push({
      id: `${idPrefix}-heading-${sections.length + 1}`,
      label,
      level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    });
  }

  return sections;
}
