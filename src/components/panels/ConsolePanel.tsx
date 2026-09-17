import { useState } from "react";
import type { RpcCommand } from "@earendil-works/pi-coding-agent";
import { useWorkspace } from "../../lib/store";
import { loadMessages, refresh, report, request } from "../../lib/rpc";
import { Button, Select, TextArea } from "../UI";
import { Icon } from "../Icon";

const samples: Record<RpcCommand["type"], Record<string, unknown>> = { prompt: { message: "" }, steer: { message: "" }, follow_up: { message: "" }, abort: {}, clear_queue: {}, new_session: {}, get_state: {}, get_messages: {}, set_model: { provider: "", modelId: "" }, cycle_model: {}, get_available_models: {}, set_thinking_level: { level: "high" }, cycle_thinking_level: {}, get_available_thinking_levels: {}, set_steering_mode: { mode: "one-at-a-time" }, set_follow_up_mode: { mode: "one-at-a-time" }, compact: { customInstructions: "" }, set_auto_compaction: { enabled: true }, set_auto_retry: { enabled: true }, abort_retry: {}, bash: { command: "pwd", excludeFromContext: true }, abort_bash: {}, get_session_stats: {}, export_html: {}, switch_session: { sessionPath: "" }, fork: { entryId: "" }, clone: {}, get_fork_messages: {}, get_entries: {}, get_tree: {}, get_last_assistant_text: {}, set_session_name: { name: "" }, get_commands: {} };
const format = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

export function ConsolePanel() {
  const online = useWorkspace(state => state.connection === "online");
  const [kind, setKind] = useState<RpcCommand["type"]>("get_state");
  const [body, setBody] = useState("{}");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const args = JSON.parse(body);
      if (typeof args !== "object" || Array.isArray(args) || args === null) throw new Error("参数必须为 JSON 对象");
      const data = await request({ ...args, type: kind } as RpcCommand, 180000);
      setResult(format(data ?? "完成"));
      if (["new_session", "switch_session", "fork", "clone"].includes(kind)) await loadMessages();
      else await refresh();
    } catch (error) { setResult(String(error)); report(error); }
    finally { setBusy(false); }
  }
  return <>
    <div className="panel-heading"><div><h1><Icon name="terminal-window" />控制台</h1><p>调用已注册的 RPC 服务与底层命令。</p></div><span className="badge"><Icon name="command" />{Object.keys(samples).length} 个命令</span></div>
    <section className="console-workbench">
      <div className="console-controls"><Select aria-label="RPC 命令" value={kind} onChange={event => { const value = event.target.value as RpcCommand["type"]; setKind(value); setBody(JSON.stringify(samples[value], null, 2)); }}>{Object.keys(samples).map(name => <option key={name}>{name}</option>)}</Select><Button className="primary" disabled={!online || busy} onClick={() => void run()}><Icon name="play-circle" />{busy ? "等待结果…" : "执行"}</Button><Button className="secondary" disabled={!online} onClick={() => void request({ type: "abort_bash" }).catch(report)}><Icon name="stop-fill" />停止 Bash</Button><Button className="secondary" disabled={!online} onClick={() => void request({ type: "abort_retry" }).catch(report)}><Icon name="x" />停止重试</Button></div>
      <label className="console-label"><span><Icon name="code" />参数 JSON</span><TextArea className="code-input" value={body} onChange={event => setBody(event.target.value)} spellCheck={false} /></label>
      <section className="console-label" aria-label="返回结果"><span><Icon name="arrow-bend-up-right" />返回结果</span><pre className="console-result">{result || "执行后显示 Pi 返回的数据。"}</pre></section>
    </section>
  </>;
}
