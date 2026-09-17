import { useQuery } from "@tanstack/react-query";
import type { RpcResponse } from "@earendil-works/pi-coding-agent";
import { request } from "../lib/rpc";
import { useWorkspace } from "../lib/store";
import { usePageVisible } from "../lib/page-visibility";

export type Stats = Extract<RpcResponse, { command: "get_session_stats"; success: true }>["data"];
export type RuntimeInfo = { compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number }; retry: { enabled: boolean; maxRetries: number; baseDelayMs: number }; providerRetry: Record<string, unknown>; transport: string; projectTrusted: boolean; systemPrompt: string; thinkingBudgets?: Record<string, number>; idle: boolean; pending: boolean; scopedModels: unknown[] };

export function useMetrics() {
  const cwd = useWorkspace(state => state.cwd);
  const connectionId = useWorkspace(state => state.connectionId);
  const online = useWorkspace(state => state.connection === "online");
  const sessionId = useWorkspace(state => state.state?.sessionId);
  const runtimeText = useWorkspace(state => state.statuses["gui-runtime"]);
  const visible = usePageVisible();
  const stats = useQuery({ queryKey: ["pi", "live-stats", connectionId || cwd, sessionId], queryFn: () => request<Stats>({ type: "get_session_stats" }, 30000, connectionId || cwd), enabled: online && visible, refetchInterval: 2000 });
  let runtime: RuntimeInfo | null = null;
  try { if (runtimeText) runtime = JSON.parse(runtimeText); } catch { /* Keep absent metrics absent. */ }
  return { stats: stats.data, runtime, error: stats.error, updatedAt: stats.dataUpdatedAt, online };
}
