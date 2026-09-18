import type { PiMessage } from "./protocol";

export type BranchEntry = { id: string; parentId: string | null; type: string; message?: PiMessage };

function messageIdentity(message: PiMessage) {
  const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
  return JSON.stringify(content.map(part => ({
    type: part.type, text: part.text, thinking: part.thinking,
    id: part.id, name: part.name, data: part.data,
  })));
}

// Display IDs are local UI IDs. Resolve the durable entry only on the active branch.
export function findBranchEntry(entries: BranchEntry[], leafId: string | null, message: PiMessage) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const candidates: BranchEntry[] = [];
  const visited = new Set<string>();
  let id = leafId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    if (entry.type === "message" && entry.message?.role === message.role
      && entry.message.timestamp === message.timestamp
      && messageIdentity(entry.message) === messageIdentity(message)) candidates.push(entry);
    id = entry.parentId;
  }
  if (candidates.length !== 1) throw new Error("无法准确定位这条消息，请刷新会话后重试");
  return candidates[0].id;
}
