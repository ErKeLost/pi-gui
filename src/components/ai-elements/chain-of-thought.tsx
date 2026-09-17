// Adapted from Beautiful UI's Reasoning variant. See docs/licenses/beautiful-ui.txt.
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/Icon";
import { ElapsedTime } from "./elapsed-time";
import { StableShimmer } from "./stable-shimmer";
import "./thinking-state.css";

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
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? running;
  const panelId = useId();

  return (
    <section className="turn-activity" data-open={expanded} data-working={running}>
      <Button
        type="button"
        variant="ghost"
        className="turn-activity-header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpandedOverride(!expanded)}
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
