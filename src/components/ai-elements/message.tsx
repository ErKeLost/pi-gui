import type { HTMLAttributes } from "react";
import { Markdown } from "../Markdown";

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
  return <Markdown content={children} animated={animated} className="ai-message-response" />;
}
