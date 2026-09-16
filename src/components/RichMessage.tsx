import { Markdown } from "./Markdown";
import { ProcessingPanel, ThinkingSummary } from "./ai-elements/chain-of-thought";

export function RichMarkdown({ text, animated = false }: { text: string; animated?: boolean }) {
  return <Markdown content={text} animated={animated} className="markdown-renderer" />;
}
export function Thinking({ text, running = false }: { text: string; running?: boolean }) {
  return <ThinkingSummary text={text} running={running} />;
}
export { ProcessingPanel };
