import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Shimmer, type TextShimmerProps } from "./shimmer";

type StableShimmerProps = Omit<TextShimmerProps, "children"> & { text: string };

export function StableShimmer({
  text,
  as = "span",
  className,
  duration = 1.6,
  spread = 2,
}: StableShimmerProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [initialText] = useState(text);
  const shimmer = useMemo(() => (
    <Shimmer as={as} className={className} duration={duration} spread={spread}>
      {initialText}
    </Shimmer>
  ), [as, className, duration, initialText, spread]);

  useLayoutEffect(() => {
    const element = hostRef.current?.firstElementChild as HTMLElement | null;
    if (!element) return;
    if (element.textContent !== text) element.textContent = text;
    element.style.setProperty("--spread", `${text.length * spread}px`);
  }, [spread, text]);

  return <span ref={hostRef} className="stable-shimmer-host">{shimmer}</span>;
}
