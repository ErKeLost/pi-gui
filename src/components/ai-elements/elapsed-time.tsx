import { useEffect, useRef, useState } from "react";

export function ElapsedTime({ running = true, value }: { running?: boolean; value?: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running || value !== undefined) { startedAt.current = 0; return; }
    if (startedAt.current === 0) startedAt.current = performance.now();
    const update = () => setElapsedMs(performance.now() - startedAt.current);
    let timer:number|undefined;
    const stop=()=>{if(timer!==undefined){window.clearInterval(timer);timer=undefined;}};
    const sync=()=>{if(document.hidden){stop();return}update();if(timer===undefined)timer=window.setInterval(update,250);};
    sync();document.addEventListener('visibilitychange',sync);
    return()=>{stop();document.removeEventListener('visibilitychange',sync)};
  }, [running, value]);

  if (!running && elapsedMs === 0 && value === undefined) return null;
  // Round before splitting minutes so 59.96 seconds becomes 1m 0.0s.
  const seconds = Math.round(elapsedMs / 100) / 10;
  const elapsed = value ?? (seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`);

  return <span className="ai-elapsed-time" aria-hidden="true">{elapsed}</span>;
}
