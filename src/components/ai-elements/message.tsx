import { useEffect, useId, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { Markdown } from "../Markdown";
import { Icon } from "../Icon";
import { Button } from "../ui/button";
import ProximitySidebar from "../ui/proximity-sidebar";
import { markdownHeadingSections, shouldCollapseMessage } from "../../lib/message-layout";

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
  const headingSections = useMemo(
    () => markdownHeadingSections(children, contentId.replace(/[^a-zA-Z0-9_-]/g, "") || "message"),
    [children, contentId],
  );

  useEffect(() => {
    const headings = viewportRef.current?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (!headings) return;
    headingSections.forEach((section, index) => headings[index]?.setAttribute("id", section.id));
  }, [headingSections]);

  return (
    <section className="message-response-disclosure" data-collapsible={collapsible} data-open={expanded}>
      <div ref={viewportRef} id={contentId} className="message-response-viewport">
        <Markdown content={children} animated={animated} className="ai-message-response" />
      </div>
      {!animated && expanded && headingSections.length >= 3 && (
        <ProximitySidebar sections={headingSections} side="right" className="message-proximity-sidebar" />
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
