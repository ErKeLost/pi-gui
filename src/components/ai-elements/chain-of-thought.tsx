// Adapted from Beautiful UI's Reasoning variant. See docs/licenses/beautiful-ui.txt.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/Icon";
import { ElapsedTime } from "./elapsed-time";
import { StableShimmer } from "./stable-shimmer";
import "./thinking-state.css";

export type ReasoningStep = { title: string; body: string };

export function ProcessingPanel({
  running,
  startedAt,
  durationMs,
  children,
}: {
  running: boolean;
  startedAt?: number;
  durationMs?: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(running);
  const panelId = useId();

  return (
    <section className="turn-activity" data-open={expanded} data-working={running}>
      <Button
        type="button"
        variant="ghost"
        className="turn-activity-header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(open => !open)}
      >
        <ElapsedTime
          running={running}
          startedAt={startedAt}
          durationMs={durationMs}
          locale="zh"
          prefix={running ? "正在处理 " : "用时 "}
          shimmer={running}
        />
        {!expanded && <Icon name="caret-right" className="turn-activity-chevron" aria-hidden="true" />}
      </Button>
      <span className="turn-activity-rule" aria-hidden="true" />
      <div id={panelId} className="turn-activity-panel" aria-hidden={!expanded} inert={!expanded}>
        <div className="turn-activity-panel-inner">{children}</div>
      </div>
    </section>
  );
}

export function ThinkingSummary({ text, running }: { text: string; running: boolean }) {
  const summary = text.replace(/\s+/g, " ").trim() || "正在思考";
  return (
    <div className="thinking-summary" data-working={running} title={summary}>
      {running
        ? <StableShimmer text={summary} className="thinking-summary-text" />
        : <span className="thinking-summary-text">{summary}</span>}
    </div>
  );
}

export function ReasoningPanel({
  steps,
  streaming,
  restingLabel,
  elapsed,
  className = "",
}: {
  steps: ReasoningStep[];
  streaming: boolean;
  restingLabel: string;
  elapsed?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(streaming);
  const wasStreaming = useRef(streaming);
  const panelId = useId();
  const visibleSteps = steps.filter(step => step.body.trim());

  useEffect(() => {
    if (streaming && !wasStreaming.current) setExpanded(true);
    if (!streaming && wasStreaming.current) setExpanded(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  return (
    <section className={`thinking-state ${className}`} data-open={expanded} data-working={streaming}>
      <Button
        type="button"
        variant="ghost"
        className="thinking-state-header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(open => !open)}
      >
        <svg className="thinking-state-star" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className={streaming ? "thinking-shimmer" : "thinking-state-label"}>
          {streaming ? "Thinking" : restingLabel}
        </span>
        <ElapsedTime running={streaming} value={elapsed} />
        <Icon name="caret-down" className="thinking-state-chevron size-3.5" />
      </Button>
      <div id={panelId} className="thinking-state-panel" aria-hidden={!expanded} inert={!expanded}>
        <div className="thinking-state-panel-inner">
          <div className="thinking-state-trace">
            {visibleSteps.map((step) => (
              <div className="thinking-state-row" key={`${step.title}-${step.body}`}>
                {visibleSteps.length > 1 && <strong>{step.title}</strong>}
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
