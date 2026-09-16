import { Markdown } from "./Markdown";
import { ReasoningPanel } from "./ai-elements/chain-of-thought";

export function RichMarkdown({ text, animated = false }: { text: string; animated?: boolean }) {
  return <Markdown content={text} animated={animated} className="markdown-renderer" />;
}
export function Thinking({ text, running = false }: { text: string; running?: boolean }) {
  return <ReasoningPanel className="reasoning" steps={[{ title: "Reasoning", body: text }]} streaming={running} restingLabel="Reasoned" />;
}
