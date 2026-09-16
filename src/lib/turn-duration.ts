import type { DisplayMessage } from "./protocol";

const STORAGE_PREFIX = "pi-gui:turn-durations:v1:";
const MAX_TURNS_PER_SESSION = 500;

type DurationMap = Record<string, number>;

function keyForSession(sessionFile: string) {
  return `${STORAGE_PREFIX}${sessionFile}`;
}

export function turnDurationId(items: DisplayMessage[]) {
  const assistant = items.find(item => item.message.role === "assistant");
  if (!assistant) return null;
  if (typeof assistant.message.timestamp === "number" && Number.isFinite(assistant.message.timestamp)) {
    return `timestamp:${assistant.message.timestamp}`;
  }
  const content = Array.isArray(assistant.message.content) ? assistant.message.content : [];
  const toolCall = content.find(part => part.type === "toolCall" && part.id);
  return toolCall?.id ? `tool:${toolCall.id}` : null;
}

export function readTurnDurations(sessionFile: string): DurationMap {
  if (!sessionFile || typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(keyForSession(sessionFile)) ?? "{}") as DurationMap;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Number.isFinite(value) && value >= 0));
  } catch {
    return {};
  }
}

export function saveTurnDurations(sessionFile: string, entries: DurationMap) {
  if (!sessionFile || typeof localStorage === "undefined" || Object.keys(entries).length === 0) return;
  const current = readTurnDurations(sessionFile);
  const merged = { ...current, ...entries };
  const recent = Object.fromEntries(Object.entries(merged).slice(-MAX_TURNS_PER_SESSION));
  try {
    localStorage.setItem(keyForSession(sessionFile), JSON.stringify(recent));
  } catch {
    // A missing duration is preferable to disrupting the conversation when storage is unavailable.
  }
}
