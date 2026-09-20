import { BorderBeam } from "border-beam";
import { type ReactNode } from "react";
import { useTheme } from "next-themes";
import { usePageVisible } from "@/lib/page-visibility";

export function Beam({
  children,
  active = true,
  className = "",
  borderRadius = 24,
  size = "md",
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
  borderRadius?: number;
  size?: "sm" | "md" | "line" | "pulse-outside" | "pulse-inner";
}) {
  const { resolvedTheme } = useTheme();
  const visible = usePageVisible();
  return (
    <BorderBeam
      className={className}
      active={active && visible}
      size={size}
      colorVariant="colorful"
      strength={0.85}
      theme={resolvedTheme === "light" ? "light" : resolvedTheme === "dark" ? "dark" : "auto"}
      borderRadius={borderRadius}
    >
      {children}
    </BorderBeam>
  );
}
