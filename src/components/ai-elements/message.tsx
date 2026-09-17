import { useId, useState, type HTMLAttributes } from "react";
import { Markdown } from "../Markdown";
import { Icon } from "../Icon";
import { Button } from "../ui/button";
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

export function MessageResponse({
  children,
  animated = false,
  collapse = false,
}: {
  children: string;
  animated?: boolean;
  collapse?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const collapsible = collapse && !animated && shouldCollapseMessage(children);

  return (
    <section className="message-response-disclosure" data-collapsible={collapsible} data-open={expanded}>
      <div id={contentId} className="message-response-viewport">
        <Markdown content={children} animated={animated} className="ai-message-response" />
      </div>
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
