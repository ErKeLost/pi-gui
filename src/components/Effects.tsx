import { BorderBeam } from "border-beam";
import { type ReactNode } from "react";

export function Beam({
  children,
  active = true,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <BorderBeam
      className={className}
      active={active}
      size="md"
      colorVariant="mono"
      strength={0.45}
      theme="dark"
    >
      {children}
    </BorderBeam>
  );
}
