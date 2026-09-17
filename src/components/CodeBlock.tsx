import { renderMermaidSVG, type RenderOptions } from "beautiful-mermaid";
import {
  Children,
  type ComponentPropsWithoutRef,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FileIcon, Icon } from "./Icon";
import { deviconFromHref, externalLinkIcon } from "../lib/link-visual";
import { Button } from "./ui/button";

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

function LinkBrandIcon({ href, fallback, file }: { href?: string; fallback: string; file?: string }) {
  if (file) return <FileIcon path={file} />;
  const colored = deviconFromHref(href);
  if (colored) return <Icon name={`devicon:${colored}`} />;
  return <Icon name={fallback} />;
}

function fileNameFromHref(href?: string) {
  if (!href || href.startsWith("mention:")) return "";
  try {
    const path = href.includes("://") ? new URL(href).pathname : href;
    const file = decodeURIComponent(path.split("/").at(-1) ?? "");
    const ext = file.includes(".") ? file.split(".").at(-1)?.toLowerCase() ?? "" : "";
    return ext && !/^\d+$/.test(ext) && /^[a-z0-9]{1,8}$/.test(ext) ? file : "";
  } catch {
    return "";
  }
}

export function MarkdownLink({
  href,
  children,
  className = "",
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  if (href?.startsWith("mention:")) {
    return <span className={`md-chip is-mention ${className}`.trim()}>{children}</span>;
  }

  const external = Boolean(href && /^https?:\/\//.test(href));
  const label = toText(children).trim();
  const autolink = Boolean(href && (label === href || label === href.replace(/^https?:\/\//, "")));
  const brand = external ? externalLinkIcon(href) : "globe";
  const file = autolink ? fileNameFromHref(href) : "";
  const colored = !file && external ? deviconFromHref(href) : "";
  const attrs = external ? { target: "_blank" as const, rel: "noreferrer" } : {};
  const iconName = file ? `file:${file}` : colored ? `devicon:${colored}` : brand;

  if (autolink) {
    return (
      <a {...rest} {...attrs} href={href} className={`md-autolink ${className}`.trim()}>
        <span className="md-autolink-icon" aria-hidden="true" data-link-icon={iconName}>
          {external ? <LinkBrandIcon href={href} fallback={brand} file={file} /> : file ? <FileIcon path={file} /> : <Icon name={brand} />}
        </span>
        <span className="md-autolink-label">{children}</span>
      </a>
    );
  }

  if (external) return <a {...rest} {...attrs} href={href} className={`md-external-link ${className}`.trim()}><span className="md-autolink-icon" aria-hidden="true" data-link-icon={iconName}><LinkBrandIcon href={href} fallback={brand} /></span>{children}</a>;
  return <a {...rest} {...attrs} href={href} className={className}>{children}</a>;
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  css: "CSS",
  go: "Go",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  mermaid: "Mermaid",
  plaintext: "纯文本",
  py: "Python",
  python: "Python",
  rs: "Rust",
  rust: "Rust",
  sh: "Bash",
  shell: "Bash",
  sql: "SQL",
  text: "纯文本",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  txt: "纯文本",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

const LANGUAGE_EXT: Record<string, string> = {
  bash: "sh",
  javascript: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  mermaid: "mmd",
  plaintext: "txt",
  python: "py",
  rust: "rs",
  shell: "sh",
  text: "txt",
  typescript: "ts",
  yaml: "yml",
};

function languageLabel(language?: string) {
  if (!language) return "纯文本";
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language.toUpperCase();
}

function languageExt(language?: string) {
  if (!language) return "txt";
  const key = language.toLowerCase();
  return LANGUAGE_EXT[key] ?? (key.length <= 8 ? key : "txt");
}

function CodeFrame({
  language,
  code,
  children,
}: {
  language?: string;
  code: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <figure className="md-code">
      <figcaption className="md-code-header">
        <span className="md-code-lang">
          <Icon name="code" className="md-code-icon" />
          {languageLabel(language)}
        </span>
        <span className="md-code-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md-code-action"
            title="下载"
            aria-label="下载代码"
            onClick={() => {
              const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `snippet.${languageExt(language)}`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Icon name="export" className="md-code-icon" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md-code-action"
            title={copied ? "已复制" : "复制"}
            aria-label={copied ? "已复制" : "复制代码"}
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }).catch(() => undefined);
            }}
          >
            <Icon name={copied ? "check" : "copy"} className="md-code-icon" />
          </Button>
        </span>
      </figcaption>
      <div className="md-code-body">{children}</div>
    </figure>
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
  const code = toText(child ?? children).replace(/\n$/, "");
  const body =
    language === "mermaid" ? (
      <Mermaid code={code} settleDelay={settleDelay} />
    ) : language ? (
      <Highlighted code={code} language={language} settleDelay={settleDelay} />
    ) : (
      <pre {...rest}>{children}</pre>
    );

  return (
    <CodeFrame language={language} code={code}>
      {body}
    </CodeFrame>
  );
}
