import { createElement, type ReactNode } from "react";

export function messageKind(element: HTMLElement): "title" | "section" | "body" {
  if (element.closest(".transcript-message.user")) return "title";
  if (element.matches(".turn-activity, .transcript-error, .transcript-compaction, .bash-execution-card")) return "section";
  return "body";
}

export function sectionText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as HTMLElement;
  if (element.matches('button, script, style, svg, [aria-hidden="true"], .md-code-header, .message-response-footer')) return "";
  return Array.from(element.childNodes, child => sectionText(child)).join(" ").replace(/[\s\u200B\uFEFF]+/g, " ").trim();
}

export function hasSectionMedia(element: HTMLElement) {
  return element.matches("img, pre, table") || Boolean(element.querySelector("img, pre, table"));
}

// Reuse the rendered Markdown structure without copying handlers, IDs or controls.
const previewTags = new Set("p strong em del s code pre blockquote ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tr th td br hr".split(" "));

export function sectionPreview(node: Node, key = "preview"): ReactNode {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (element.matches('button, script, style, svg, img, [aria-hidden="true"], .md-code-header')) return null;
  if (tag === "input") return element.hasAttribute("checked") ? "☑ " : "☐ ";
  const children = Array.from(element.childNodes, (child, index) => sectionPreview(child, `${key}-${index}`));
  return createElement(previewTags.has(tag) ? tag : "span", {
    key,
    ...(tag === "ol" && element.hasAttribute("start") ? { start: Number(element.getAttribute("start")) } : {}),
  }, ...children);
}
