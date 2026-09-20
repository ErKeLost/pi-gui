import { useEffect, useRef, useState } from "react";
import { StableShimmer } from "./stable-shimmer";

function formatDuration(elapsedMs: number, locale: "compact" | "zh") {
  if (locale === "zh") {
    const seconds = Math.max(0, Math.round(elapsedMs / 1000));
    return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分钟 ${seconds % 60}秒`;
  }
  const seconds = Math.round(elapsedMs / 100) / 10;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export function ElapsedTime({
  running = true,
  value,
  startedAt,
  durationMs,
  locale = "compact",
  prefix = "",
  shimmer = false,
  className,
}: {
  running?: boolean;
  value?: string;
  startedAt?: number;
  durationMs?: number;
  locale?: "compact" | "zh";
  prefix?: string;
  shimmer?: boolean;
  className?: string;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running || value !== undefined) { startRef.current = 0; return; }
    if (startedAt !== undefined) startRef.current = startedAt;
    else if (startRef.current === 0) startRef.current = Date.now();
    const update = () => {
      const next = Math.max(0, Date.now() - startRef.current);
      setElapsedMs(locale === "zh" ? Math.round(next / 1000) * 1000 : next);
    };
    let timer:number|undefined;
    const stop=()=>{if(timer!==undefined){window.clearInterval(timer);timer=undefined;}};
    const sync=()=>{if(document.hidden){stop();return}update();if(timer===undefined)timer=window.setInterval(update,250);};
    sync();document.addEventListener('visibilitychange',sync);
    return()=>{stop();document.removeEventListener('visibilitychange',sync)};
  }, [locale, running, startedAt, value]);

  if (!running && durationMs === undefined && elapsedMs === 0 && value === undefined) {
    return prefix ? <span className="ai-elapsed-time"><span className="ai-elapsed-time-label">{prefix.trim()}</span></span> : null;
  }
  const duration = value ?? formatDuration(durationMs ?? elapsedMs, locale);
  const elapsed = `${prefix}${duration}`;

  return shimmer
    ? <StableShimmer text={elapsed} className={className ?? "ai-elapsed-time processing-time-shimmer"} />
    : <span className={className ?? "ai-elapsed-time"}><span className="ai-elapsed-time-label">{prefix.trim()}</span><span className="ai-elapsed-time-value">{duration}</span></span>;
}
