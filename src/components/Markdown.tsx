import { Streamdown, preprocessLaTeX } from "@lobehub/streamdown";
import { useMemo } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import { MarkdownLink, Pre } from "./CodeBlock";

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
  const settleDelay = animated ? 180 : 0;
  const components = useMemo(
    () => ({
      a: MarkdownLink,
      pre: (props: Parameters<typeof Pre>[0]) => <Pre {...props} settleDelay={settleDelay} />,
    }),
    [settleDelay],
  );

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
        components={components}
      />
    </div>
  );
}
