import { Streamdown, preprocessLaTeX } from "@lobehub/streamdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

export function Markdown({
  content,
  animated = false,
  className = "",
}: {
  content: string;
  animated?: boolean;
  className?: string;
}) {
  return (
    <div className={`${className} ${animated ? "is-streaming" : "markdown-static"}`.trim()}>
      <Streamdown
        content={content}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        latexGuard
        preprocess={preprocessLaTeX}
        granularity="char"
        smoothing="balanced"
      />
    </div>
  );
}
