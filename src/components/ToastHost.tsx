import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { GooeyToaster, gooeyToast } from "goey-toast";
import { useWorkspace } from "../lib/store";

/** Bridges protocol-level notifications into the single app-wide toast surface. */
export function ToastHost() {
  const { resolvedTheme } = useTheme();
  const error = useWorkspace((state) => state.error);
  const notices = useWorkspace((state) => state.notices);
  const lastError = useRef<string | null>(null);

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error;
      gooeyToast.error(error, {
        description: "操作未完成",
        duration: 6000,
        showTimestamp: false,
      });
      useWorkspace.getState().set({ error: null });
    } else if (!error) {
      lastError.current = null;
    }
  }, [error]);

  useEffect(() => {
    if (!notices.length) return;
    notices.forEach((notice) => gooeyToast.info(notice, { showTimestamp: false }));
    useWorkspace.getState().set({ notices: [] });
  }, [notices]);

  return (
    <GooeyToaster
      position="bottom-right"
      theme={resolvedTheme === "light" ? "light" : "dark"}
      preset="smooth"
      closeButton="top-right"
      showTimestamp={false}
      visibleToasts={4}
      offset="24px"
    />
  );
}
