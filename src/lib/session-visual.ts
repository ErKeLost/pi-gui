const RULES: Array<{ icon: string; test: RegExp }> = [
  { icon: "image-square", test: /图片|照片|截图|清晰|插画|svg|png|jpe?g|webp|gif|image|photo|icon/i },
  { icon: "film-strip", test: /视频|影片|video|movie/i },
  { icon: "music-notes", test: /音乐|音频|audio|song|podcast/i },
  { icon: "cloud-sun", test: /天气|weather/i },
  { icon: "bug", test: /bug|修复|报错|error|fix\b/i },
  { icon: "database", test: /数据库|sql|postgres|sqlite|mongo/i },
  { icon: "git-commit", test: /\bgit\b|commit|pull request|\bpr\b/i },
  { icon: "translate", test: /翻译|translate|i18n/i },
  { icon: "list-checks", test: /todo|待办|清单|checklist/i },
  { icon: "calendar-blank", test: /日程|日历|定时|schedule|calendar/i },
  { icon: "rocket-launch", test: /发布|上线|launch|changelog/i },
  { icon: "magic-wand", test: /创意|方案|生成|spark/i },
  { icon: "palette", test: /设计|主题|视觉|配色|落地页|landing|ui|ux|theme|design/i },
  { icon: "code", test: /代码|开发|全栈|网站|website|react|python|rust|\bapp\b/i },
  { icon: "book-open", test: /指南|文档|readme|docs|手册/i },
  { icon: "robot", test: /agent|你好|你谁|助手|hello/i },
  { icon: "globe", test: /https?:\/\/|www\./i },
];

const FALLBACKS = [
  "chat-teardrop-text",
  "sparkle",
  "cube",
  "note-pencil",
  "stack",
  "compass",
  "lightbulb",
  "browser",
  "package",
  "leaf",
];

export function compactTitle(label?: string, fallback = "新会话", limit = 24) {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export function sessionGlyph(label: string) {
  const text = label.trim();
  if (!text) return "chat-teardrop-text";
  for (const rule of RULES) if (rule.test.test(text)) return rule.icon;
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return FALLBACKS[(hash >>> 0) % FALLBACKS.length];
}
