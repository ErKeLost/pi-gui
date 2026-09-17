import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/Markdown";

describe("shared Markdown renderer", () => {
  test("renders GFM tables and KaTeX through LobeHub Streamdown", () => {
    const html = renderToStaticMarkup(
      <Markdown content={"| Item | Value |\n| --- | --- |\n| math | $x^2$ |"} />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain('class="katex"');
    expect(html).toContain("markdown-static");
  });

  test("normalizes bracket-style math before rendering", () => {
    const html = renderToStaticMarkup(<Markdown content={String.raw`\[x + y\]`} animated />);

    expect(html).toContain("x + y</annotation>");
    expect(html).not.toContain(String.raw`\[x + y\]`);
    expect(html).toContain("is-streaming");
  });

  test("renders fenced code as a pre block before Shiki upgrades it", () => {
    const html = renderToStaticMarkup(<Markdown content={"```ts\nconst reveal = (chars: string[]) => chars.map((char, i) => ({ char, delay: i * 18 }));\n```"} />);

    expect(html).toContain("<pre>");
    expect(html).toContain("const reveal");
    expect(html).toContain("md-code");
    expect(html).toContain("TypeScript");
    expect(html).toContain("aria-label=\"复制代码\"");
  });

  test("labels unlabeled fences as plain text with copy and download actions", () => {
    const html = renderToStaticMarkup(<Markdown content={"```\nhello\n```"} />);

    expect(html).toContain("md-code");
    expect(html).toContain("纯文本");
    expect(html).toContain("aria-label=\"下载代码\"");
    expect(html).toContain("hello");
  });

  test("renders settled mermaid fences as SVG", () => {
    const html = renderToStaticMarkup(
      <Markdown content={"```mermaid\nflowchart LR\n  A --> B\n```"} />,
    );

    expect(html).toContain("class=\"mermaid\"");
    expect(html).toContain("<svg");
  });

  test("keeps mermaid fences as plain code while streaming", () => {
    const html = renderToStaticMarkup(
      <Markdown animated content={"```mermaid\nflowchart LR\n  A --> B\n```"} />,
    );

    expect(html).toContain("<pre>");
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("class=\"mermaid\"");
  });

  test("renders GFM task lists, strikethrough, quotes and autolinks", () => {
    const html = renderToStaticMarkup(
      <Markdown
        content={
          "- [x] Task list item\n\n~~strikethrough~~\n\n> quoted line\n\nhttps://streamdown.lobehub.com"
        }
      />,
    );

    expect(html).toContain("checkbox");
    expect(html).toContain("<del>");
    expect(html).toContain("<blockquote");
    expect(html).toContain("href=\"https://streamdown.lobehub.com\"");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("md-autolink");
    expect(html).not.toContain("node=\"[object Object]\"");
  });

  test("renders file autolinks with an icon and package mentions as chips", () => {
    const html = renderToStaticMarkup(
      <Markdown content={"Read https://lobehub.com/icons/skill.md and follow @lobehub/icons"} />,
    );

    expect(html).toContain("md-autolink");
    expect(html).toContain("href=\"https://lobehub.com/icons/skill.md\"");
    expect(html).toContain("md-chip is-mention");
  });
});
