import type { PiMessage } from "./protocol";

export type ContextCategory = "system" | "tools" | "rules" | "skills" | "dynamic" | "subagents" | "conversation";

export type ContextBreakdownInput = {
  systemChars?: number;
  skillsChars?: number;
  rulesChars?: number;
  toolChars?: number;
  dynamicChars?: number;
  subagentChars?: number;
};

export type ContextSegment = {
  id: ContextCategory;
  label: string;
  color: string;
  tokens: number;
};

const IMAGE_CHARS = 4800;

export const CONTEXT_CATEGORIES: { id: ContextCategory; label: string; color: string }[] = [
  { id: "system", label: "System prompt", color: "#8b9099" },
  { id: "tools", label: "Tool definitions", color: "#9d94c7" },
  { id: "rules", label: "Rules", color: "#7eae98" },
  { id: "skills", label: "Skills", color: "#c4ae78" },
  { id: "dynamic", label: "MCP & dynamic tools", color: "#b48aaf" },
  { id: "subagents", label: "Subagent definitions", color: "#88a0c4" },
  { id: "conversation", label: "Conversation", color: "#c98b86" },
];

/** Pi compaction.ts uses chars/4 and treats an image as 4,800 characters. */
export function estimateTokensFromChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

export function messageChars(message: PiMessage | undefined): number {
  if (!message) return 0;
  if (typeof message.content === "string") return message.content.length;
  if (message.role === "bashExecution") return (message.command?.length ?? 0) + (message.output?.length ?? 0);
  if (typeof message.summary === "string" && !Array.isArray(message.content)) return message.summary.length;
  if (!Array.isArray(message.content)) return 0;
  return message.content.reduce((total, part) => {
    if (part.type === "text") return total + (part.text?.length ?? 0);
    if (part.type === "thinking") return total + (part.thinking?.length ?? 0);
    if (part.type === "image") return total + IMAGE_CHARS;
    if (part.type === "toolCall") return total + (part.name?.length ?? 0) + (part.argsText?.length ?? JSON.stringify(part.arguments ?? {}).length);
    return total;
  }, 0);
}

export function fixedContextChars(input: ContextBreakdownInput): Record<Exclude<ContextCategory, "conversation">, number> {
  return {
    system: input.systemChars ?? 0,
    tools: input.toolChars ?? 0,
    rules: input.rulesChars ?? 0,
    skills: input.skillsChars ?? 0,
    dynamic: input.dynamicChars ?? 0,
    subagents: input.subagentChars ?? 0,
  };
}

export function contextSegments(input: ContextBreakdownInput, usedTokens: number | null): ContextSegment[] {
  const chars = fixedContextChars(input);
  const raw = CONTEXT_CATEGORIES.map(category => ({
    ...category,
    tokens: category.id === "conversation" ? 0 : estimateTokensFromChars(chars[category.id]),
  }));
  const fixed = raw.reduce((total, segment) => total + (segment.id === "conversation" ? 0 : segment.tokens), 0);
  const conversation = raw.find(segment => segment.id === "conversation");
  if (conversation) conversation.tokens = usedTokens == null ? 0 : Math.max(0, usedTokens - Math.min(fixed, usedTokens));
  if (usedTokens == null) return raw;
  if (fixed > usedTokens && fixed > 0) {
    let remaining = usedTokens;
    for (const segment of raw) {
      if (segment.id === "conversation") continue;
      const scaled = Math.min(remaining, Math.round((segment.tokens / fixed) * usedTokens));
      segment.tokens = scaled;
      remaining -= scaled;
    }
    if (conversation) conversation.tokens = remaining;
  }
  return raw;
}
