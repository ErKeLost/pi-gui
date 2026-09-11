import { useEffect, useState } from "react";

export function ElapsedTime({ running = true, value }: { running?: boolean; value?: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!running || value !== undefined) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [running, value]);

  if (!running && elapsedMs === 0 && value === undefined) return null;
  // Round before splitting minutes so 59.96 seconds becomes 1m 0.0s.
  const seconds = Math.round(elapsedMs / 100) / 10;
  const elapsed = value ?? (seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`);

  return <span className="ai-elapsed-time" aria-hidden="true">{elapsed}</span>;
}
