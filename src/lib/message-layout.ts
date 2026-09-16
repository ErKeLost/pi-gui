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
