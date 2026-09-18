import { setTheme as setNativeTheme } from "@tauri-apps/api/app";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";
import { isResolvedTheme, nativeThemePreference, themeColor } from "../lib/theme";
import { useWorkspace } from "../lib/store";
import { setRemoteHostTheme } from "../lib/remote-host";

function ThemeSync() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const remoteTheme = useWorkspace(state => state.remoteTheme);

  useEffect(() => {
    if (runtimeTarget === "mobile" && remoteTheme && theme !== remoteTheme) setTheme(remoteTheme);
  }, [remoteTheme, runtimeTarget, setTheme, theme]);

  useEffect(() => {
    if (!isResolvedTheme(resolvedTheme)) return;
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", themeColor[resolvedTheme]);

    if (runtimeTarget === "desktop") {
      void setNativeTheme(nativeThemePreference(theme)).catch(() => {
        // Theme sync is cosmetic; the webview theme remains authoritative.
      });
      void setRemoteHostTheme(resolvedTheme).catch(() => {
        // The Host may be unavailable during desktop startup or shutdown.
      });
    }
  }, [resolvedTheme, runtimeTarget, theme]);

  return null;
}

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}><ThemeSync />{children}</NextThemesProvider>;
}
