import icons from "../icons.generated.json";

const bundledIcons = icons.icons as Record<string, unknown>;
const defaultSessionIcon = "chat-teardrop-text";

export function compactTitle(label?: string, fallback = "新会话", limit = 24) {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export function sessionGlyph(icon?: string) {
  return icon && Object.hasOwn(bundledIcons, icon) ? icon : defaultSessionIcon;
}
