import { BorderBeam } from "border-beam";
import { type ReactNode } from "react";

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
  return (
    <BorderBeam
      className={className}
      active={active}
      size="md"
      colorVariant="colorful"
      strength={0.85}
      theme="dark"
      borderRadius={borderRadius}
    >
      {children}
    </BorderBeam>
  );
}
