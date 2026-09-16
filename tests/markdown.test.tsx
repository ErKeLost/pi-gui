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
});
