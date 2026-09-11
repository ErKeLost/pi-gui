// Adapted from Beautiful UI's Reasoning variant. See docs/licenses/beautiful-ui.txt.
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ElapsedTime } from "./elapsed-time";
import "./thinking-state.css";

export type ReasoningStep = { title: string; body: string };

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
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? streaming;
  const panelId = useId();
  const visibleSteps = steps.filter(step => step.body.trim());

  return (
    <section className={`thinking-state ${className}`} data-open={expanded} data-working={streaming}>
      <Button
        type="button"
        variant="ghost"
        className="thinking-state-header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setManualExpanded(!expanded)}
      >
        <svg className="thinking-state-star" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className={streaming ? "thinking-shimmer" : "thinking-state-label"}>
          {streaming ? "Thinking" : restingLabel}
        </span>
        <ElapsedTime running={streaming} value={elapsed} />
        <ChevronDown size={14} className="thinking-state-chevron" aria-hidden="true" />
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
