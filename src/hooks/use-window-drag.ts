import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "../lib/rpc";

export function useWindowDrag() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !native) return;
    const start = (event: MouseEvent) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,textarea,select,a,[role=button]")) return;
      event.preventDefault();
      void getCurrentWindow().startDragging();
    };
    element.addEventListener("mousedown", start);
    return () => element.removeEventListener("mousedown", start);
  }, []);
  return ref;
}
