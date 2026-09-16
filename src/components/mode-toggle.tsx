import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="relative"
      disabled={!resolvedTheme}
      aria-label="切换主题"
      title="切换主题"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-4 rotate-0 opacity-100 transition-[opacity,transform] dark:-rotate-90 dark:opacity-0" />
      <Moon className="absolute size-4 rotate-90 opacity-0 transition-[opacity,transform] dark:rotate-0 dark:opacity-100" />
      <span className="sr-only">切换主题</span>
    </Button>
  );
}
