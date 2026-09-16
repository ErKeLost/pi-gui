import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { ThemeProvider } from "./theme-provider";
import { PromptProvider } from "./UI";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastHost } from "./ToastHost";
import { UpdateChecker } from "./UpdateChecker";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey="pi-gui.theme"
      disableTransitionOnChange
    >
      <LazyMotion features={domAnimation}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <PromptProvider>
              <UpdateChecker />
              <ToastHost />
              {children}
            </PromptProvider>
          </TooltipProvider>
        </MotionConfig>
      </LazyMotion>
    </ThemeProvider>
  );
}
