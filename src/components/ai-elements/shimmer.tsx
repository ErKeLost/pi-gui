"use client";

import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
import { memo, useMemo } from "react";

export interface TextShimmerProps {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    <span
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent shimmer-animated",
        className
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
          backgroundImage: [
            "linear-gradient(90deg, transparent 0%, transparent calc(50% - var(--spread)), color-mix(in oklch, var(--foreground) 88%, transparent) 50%, transparent calc(50% + var(--spread)), transparent 100%)",
            "linear-gradient(color-mix(in oklch, var(--muted-foreground) 58%, transparent), color-mix(in oklch, var(--muted-foreground) 58%, transparent))",
          ].join(", "),
          backgroundSize: "250% 100%, auto",
          backgroundRepeat: "no-repeat, padding-box",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent",
          willChange: "background-position",
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
};

export const Shimmer = memo(ShimmerComponent);
