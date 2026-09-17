export function messageKind(element: HTMLElement): "title" | "section" | "body" {
  if (element.closest(".transcript-message.user")) return "title";
  if (element.matches(".turn-activity, .transcript-error, .transcript-compaction, .bash-execution-card")) return "section";
  return "body";
}
