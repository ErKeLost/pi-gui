import { useSyncExternalStore } from "react";

export const NARROW_WORKSPACE_QUERY = "(max-width: 992px)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(NARROW_WORKSPACE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window !== "undefined" && window.matchMedia(NARROW_WORKSPACE_QUERY).matches;
}

export function useNarrowWorkspace() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
