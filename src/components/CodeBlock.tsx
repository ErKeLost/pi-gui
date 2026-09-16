import { renderMermaidSVG, type RenderOptions } from "beautiful-mermaid";
import {
  Children,
  type ComponentPropsWithoutRef,
  isValidElement,
  memo,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Highlighting and diagram rendering are far more expensive than a reveal
 * commit, so neither runs while the fence is still arriving — the block stays
 * plain text until its source has held still, then upgrades in place.
 * Matches LobeHub Streamdown playground (`site/src/components/CodeBlock.tsx`).
 */
const useSettled = (value: string, delay = 180) => {
  const [settled, setSettled] = useState("");

  useEffect(() => {
    if (delay === 0) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return delay === 0 ? value : settled;
};

const MERMAID_OPTIONS: RenderOptions = {
  accent: "var(--foreground)",
  bg: "var(--card)",
  border: "var(--border)",
  fg: "var(--foreground)",
  font: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  line: "var(--muted-foreground)",
  muted: "var(--muted-foreground)",
  surface: "var(--muted)",
  transparent: true,
};

const Mermaid = memo<{ code: string; settleDelay: number }>(({ code, settleDelay }) => {
  const settled = useSettled(code, settleDelay);
  const svg = useMemo(() => {
    if (!settled) return "";
    try {
      return renderMermaidSVG(settled, MERMAID_OPTIONS);
    } catch {
      return "";
    }
  }, [settled]);

  if (!svg || settled !== code) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
});

const Highlighted = memo<{ code: string; language: string; settleDelay: number }>(
  ({ code, language, settleDelay }) => {
    const settled = useSettled(code, settleDelay);
    const [html, setHtml] = useState("");

    useEffect(() => {
      if (!settled) return;
      let cancelled = false;

      void import("shiki")
        .then(({ codeToHtml }) =>
          codeToHtml(settled, {
            lang: language,
            themes: { dark: "vitesse-dark", light: "vitesse-light" },
          }),
        )
        .then((result) => {
          if (!cancelled) setHtml(result);
        })
        .catch(() => {
          if (!cancelled) setHtml("");
        });

      return () => {
        cancelled = true;
      };
    }, [settled, language]);

    if (!html || settled !== code) {
      return (
        <pre>
          <code>{code}</code>
        </pre>
      );
    }

    return <div className="highlighted" dangerouslySetInnerHTML={{ __html: html }} />;
  },
);

const toText = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  if (isValidElement<{ children?: unknown }>(node)) return toText(node.props.children);
  return "";
};

export function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  const external = Boolean(href && /^https?:\/\//.test(href));
  return (
    <a {...rest} href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

export function Pre({
  children,
  settleDelay = 180,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<"pre"> & { settleDelay?: number; node?: unknown }) {
  const child = Children.toArray(children).find((node) =>
    isValidElement<{ className?: string }>(node),
  ) as ReactElement<{ className?: string }> | undefined;

  const language = /language-([^\s]+)/.exec(child?.props.className ?? "")?.[1];
  if (!language) return <pre {...rest}>{children}</pre>;

  const code = toText(child).replace(/\n$/, "");
  if (language === "mermaid") return <Mermaid code={code} settleDelay={settleDelay} />;

  return <Highlighted code={code} language={language} settleDelay={settleDelay} />;
}
