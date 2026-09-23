export type ContextCategory = "tools" | "messages";

export type ContextBreakdownInput = {
  toolChars?: number;
};

export type ContextSegment = {
  id: ContextCategory;
  label: string;
  color: string;
  tokens: number;
};

export const CONTEXT_CATEGORIES: { id: ContextCategory; label: string; color: string }[] = [
  { id: "tools", label: "Tools", color: "#9d94c7" },
  { id: "messages", label: "Messages & prompt", color: "#c98b86" },
];

/** Pi uses chars/4 when it must estimate content without provider token usage. */
export function estimateTokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

export function contextSegments(input: ContextBreakdownInput, usedTokens: number | null): ContextSegment[] {
  const estimatedToolTokens = estimateTokensFromChars(input.toolChars ?? 0);
  const toolTokens = usedTokens == null ? estimatedToolTokens : Math.min(estimatedToolTokens, usedTokens);
  return CONTEXT_CATEGORIES.map(category => ({
    ...category,
    tokens: category.id === "tools" ? toolTokens : usedTokens == null ? 0 : usedTokens - toolTokens,
  }));
}
