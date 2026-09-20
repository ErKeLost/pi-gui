import { BorderBeam } from "border-beam";
import { type ReactNode } from "react";
import { useTheme } from "next-themes";
import { usePageVisible } from "@/lib/page-visibility";

export function Beam({
  children,
  active = true,
  className = "",
  borderRadius = 24,
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
  borderRadius?: number;
}) {
  const { resolvedTheme } = useTheme();
  const visible = usePageVisible();
  return (
    <BorderBeam
      className={className}
      active={active && visible}
      size="md"
      colorVariant="colorful"
      strength={0.85}
      theme={resolvedTheme === "light" ? "light" : resolvedTheme === "dark" ? "dark" : "auto"}
      borderRadius={borderRadius}
    >
      {children}
    </BorderBeam>
  );
}
