import { useEffect, useId, useRef, useState, type HTMLAttributes } from "react";
import { Markdown } from "../Markdown";
import { Icon } from "../Icon";
import { Button } from "../ui/button";
import ProximitySidebar, { type ProximitySection } from "../ui/proximity-sidebar";
import { shouldCollapseMessage } from "../../lib/message-layout";

export function Message({
  from,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: string }) {
  return (
    <article {...props} className={`ai-message ${from === "user" ? "is-user" : "is-assistant"} ${className}`}>
      {children}
    </article>
  );
}

export function MessageContent({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`ai-message-content ${className}`}>
      {children}
    </div>
  );
}

export function MessageResponse({ children, animated = false }: { children: string; animated?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const collapsible = !animated && shouldCollapseMessage(children);
  const [proximitySections, setProximitySections] = useState<ProximitySection[]>([]);

  useEffect(() => {
    if (animated) return;
    const frame = window.requestAnimationFrame(() => {
      const root = viewportRef.current?.querySelector(".streamdown-animated");
      const blocks = Array.from(root?.children ?? []).filter((element): element is HTMLElement => element instanceof HTMLElement);
      const prefix = contentId.replace(/[^a-zA-Z0-9_-]/g, "") || "message";
      const sections = blocks.slice(0, 32).map<ProximitySection>((element, index) => {
        const match = element.tagName.match(/^H([1-6])$/);
        const level = match ? Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6 : undefined;
        const id = `${prefix}-block-${index + 1}`;
        element.id = id;
        return {
          id,
          label: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 72) || `Content ${index + 1}`,
          ...(level ? { level } : { kind: "body" as const }),
        };
      });
      setProximitySections(sections);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [animated, children, contentId]);

  return (
    <section className="message-response-disclosure" data-collapsible={collapsible} data-open={expanded}>
      <div ref={viewportRef} id={contentId} className="message-response-viewport">
        <Markdown content={children} animated={animated} className="ai-message-response" />
      </div>
      {collapsible && proximitySections.length >= 3 && (
        <ProximitySidebar
          sections={proximitySections}
          side="left"
          className="message-proximity-sidebar"
          onSelectSection={() => setExpanded(true)}
        />
      )}
      {collapsible && (
        <div className="message-response-more">
          {!expanded && <span className="message-response-ellipsis" aria-hidden="true">...</span>}
          <Button
            type="button"
            variant="ghost"
            className="message-response-toggle"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded(value => !value)}
          >
            <span>{expanded ? "收起" : "显示更多"}</span>
            <span className="message-response-toggle-chevron" aria-hidden="true"><Icon name="caret-down" /></span>
          </Button>
        </div>
      )}
    </section>
  );
}
