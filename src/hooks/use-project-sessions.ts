import { useQueries, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../lib/protocol";
import type { LiveSession } from "../lib/store";
import { native } from "../lib/rpc";

export function useProjectSessions(cwd: string) {
  return useQuery({
    queryKey: ["pi", "sessions", cwd],
    queryFn: () => invoke<Session[]>("list_sessions", { cwd }),
    enabled: native && Boolean(cwd),
  });
}

export function useProjectSessionGroups(projects: string[]) {
  const queries = useQueries({
    queries: projects.map(cwd => ({
      queryKey: ["pi", "sessions", cwd],
      queryFn: () => invoke<Session[]>("list_sessions", { cwd }),
      enabled: native && Boolean(cwd),
    })),
  });
  return projects.map((cwd, index) => ({ cwd, query: queries[index] }));
}

export function mergeProjectSessions(cwd: string, listed: Session[], live: LiveSession[]) {
  const listedPaths = new Set(listed.map(session => session.path));
  const sessions: Session[] = [
    ...live.flatMap(session => session.cwd === cwd && session.path && !listedPaths.has(session.path) ? [{
      path: session.path,
      id: session.path,
      cwd,
      firstMessage: session.title,
      icon: undefined,
      messageCount: 0,
      modified: new Date().toISOString(),
    } satisfies Session] : []),
    ...listed,
  ];
  return { listedPaths, sessions };
}
