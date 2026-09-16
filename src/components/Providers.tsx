import { useEffect, type ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { ThemeProvider } from "./theme-provider";
import { PromptProvider } from "./UI";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastHost } from "./ToastHost";
import { UpdateChecker } from "./UpdateChecker";

function PageVisibilitySync() {
  useEffect(() => {
    const update = () => { document.documentElement.dataset.pageVisible = String(!document.hidden); };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return null;
}

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
              <PageVisibilitySync />
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
