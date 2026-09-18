import { useQueries, useQuery } from "@tanstack/react-query";
import type { Session } from "../lib/protocol";
import type { LiveSession } from "../lib/store";
import { listSessions } from "../lib/rpc";
import { useWorkspace } from "../lib/store";

export function useProjectSessions(cwd: string) {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  return useQuery({
    queryKey: ["pi", "sessions", cwd],
    queryFn: () => listSessions(cwd),
    enabled: (runtimeTarget === "desktop" || runtimeTarget === "mobile") && Boolean(cwd),
  });
}

export function useProjectSessionGroups(projects: string[]) {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const queries = useQueries({
    queries: projects.map(cwd => ({
      queryKey: ["pi", "sessions", cwd],
      queryFn: () => listSessions(cwd),
      enabled: (runtimeTarget === "desktop" || runtimeTarget === "mobile") && Boolean(cwd),
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
