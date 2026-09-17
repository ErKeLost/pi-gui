import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "next-themes";
import { gooeyToast } from "goey-toast";
import type { RpcCommand, RpcSessionState } from "@earendil-works/pi-coding-agent";
import { useWorkspace } from "../../lib/store";
import { connect, disconnect, getProjectTrustMode, loadMessages, native, refresh, report, request, setProjectTrustMode, type ProjectTrustMode } from "../../lib/rpc";
import { Button, Input, Select, Switch } from "../UI";
import { usePrompt } from "../../lib/prompt";
import { Icon } from "../Icon";
import { ModeToggle } from "../mode-toggle";

async function applySetting(command: RpcCommand) {
  await request(command);
  await refresh();
  gooeyToast.success("设置已更新", { showTimestamp: false });
}

type GuiTools = { tools: { name: string; description: string }[]; active: string[] };

function ThemeSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const preference = theme ?? "system";
  const label = preference === "system" ? "跟随系统" : resolvedTheme === "dark" ? "深色主题" : "浅色主题";
  return <section className="settings-section theme-settings"><h2>主题</h2><div className="setting-row"><div><strong>{label}</strong><p>默认跟随系统设置，也可以在这里固定使用浅色或深色。</p></div><div className="theme-settings-controls"><Select aria-label="主题" value={preference} onChange={event => setTheme(event.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></Select><ModeToggle /></div></div></section>;
}

function ProjectDirectorySettings({ path, setPath, busy, running, status, onReconnect }: { path: string; setPath: (value: string) => void; busy: boolean; running: boolean; status: string; onReconnect: () => Promise<void> }) {
  return <section className="settings-section"><h2>项目目录</h2><div className="input-row"><Input value={path} onChange={event => setPath(event.target.value)} aria-label="工作目录" /><Button className="primary" disabled={busy || running || !native} onClick={() => void onReconnect()}>{busy ? "连接中…" : "连接此目录"}</Button></div><p className="field-note">Pi 以此目录为工作区，沿用你现有的模型与凭据配置。</p><Button className="secondary" disabled={status !== "online"} onClick={() => void disconnect().catch(report)}>断开连接</Button></section>;
}

function TrustSettings({ mode, busy, onChange }: { mode: ProjectTrustMode; busy: boolean; onChange: (mode: ProjectTrustMode) => Promise<void> }) {
  return <section className="settings-section"><h2>项目权限</h2><div className="setting-row"><div><strong>项目资源信任</strong><p>Pi 没有内置沙箱或逐工具授权弹窗，工具会继承当前用户权限。此设置只控制是否加载项目本地的设置、扩展、技能和主题。</p></div><Select aria-label="项目资源信任" disabled={busy || !native} value={mode} onChange={event => void onChange(event.target.value as ProjectTrustMode)}><option value="always">完全访问项目资源</option><option value="ask">每次询问</option><option value="never">禁止项目资源</option></Select></div><p className="field-note">切换后会重启当前 Pi 连接；“完全访问”不等于绕过 macOS 文件权限。</p></section>;
}

function ContextSettings({ cwd, status, running, state, onCompact }: { cwd: string; status: string; running: boolean; state: RpcSessionState | null; onCompact: () => Promise<void> }) {
  const stats = useQuery({ queryKey: ["pi", "stats", cwd], queryFn: () => request<{ tokens: { total: number }; cost: number; contextUsage?: { percent: number | null; contextWindow: number } }>({ type: "get_session_stats" }), enabled: status === "online" });
  return <section className="settings-section"><h2>上下文</h2><div className="setting-row"><div><strong>自动压缩</strong><p>接近上下文容量时，让 Pi 整理较早的内容。</p></div><Switch aria-label="自动压缩" checked={state?.autoCompactionEnabled ?? false} disabled={status !== "online" || running} onChange={checked => void applySetting({ type: "set_auto_compaction", enabled: checked }).catch(report)} /></div><div className="setting-row"><div><strong>立即压缩</strong><p>可以补充这次摘要需要保留的重点。</p></div><Button className="secondary" disabled={status !== "online" || running} onClick={() => void onCompact().catch(report)}>压缩</Button></div><div className="stat-strip"><div><span>累计 tokens</span><strong>{stats.data?.tokens.total.toLocaleString() ?? "—"}</strong></div><div><span>上下文占用</span><strong>{stats.data?.contextUsage?.percent == null ? "—" : `${stats.data.contextUsage.percent.toFixed(1)}%`}</strong></div><div><span>Pi 报告费用</span><strong>{stats.data ? `$${stats.data.cost.toFixed(4)}` : "—"}</strong></div></div><p className="field-note">自定义模型未配置价格时，Pi 的费用统计不代表服务商实际账单。</p></section>;
}

function QueueSettings({ status, state }: { status: string; state: RpcSessionState | null }) {
  return <section className="settings-section"><h2>消息队列</h2>{(["steering", "followUp"] as const).map(kind => <div className="setting-row" key={kind}><div><strong>{kind === "steering" ? "引导消息" : "跟进消息"}</strong><p>{kind === "steering" ? "当前工具调用完成后交给模型。" : "本轮任务全部结束后交给模型。"}</p></div><Select disabled={status !== "online"} value={kind === "steering" ? state?.steeringMode : state?.followUpMode} onChange={event => void applySetting({ type: kind === "steering" ? "set_steering_mode" : "set_follow_up_mode", mode: event.target.value as "all" | "one-at-a-time" }).catch(report)}><option value="one-at-a-time">每次一条</option><option value="all">全部送入</option></Select></div>)}</section>;
}

function ToolsSettings({ tools, running }: { tools: GuiTools; running: boolean }) {
  const active = new Set(tools.active);
  return <section className="settings-section"><h2>可用工具</h2>{tools.tools.map(tool => <label className="setting-row" key={tool.name}><div><strong>{tool.name}</strong><p>{tool.description}</p></div><Switch aria-label={tool.name} checked={active.has(tool.name)} disabled={running} onChange={checked => { const next = checked ? [...tools.active, tool.name] : tools.active.filter(name => name !== tool.name); void request({ type: "prompt", message: `/gui-tools-set ${JSON.stringify(next)}` }).catch(report); }} /></label>)}{!tools.tools.length && <p>连接 Pi 后读取工具列表。</p>}</section>;
}

function TerminalSettings({ cwd }: { cwd: string }) {
  return <section className="settings-section"><h2>原生终端环境</h2><p>账户登录、包安装、终端主题及交互可在独立终端中使用。</p><Button className="secondary" disabled={!native || !cwd} onClick={() => void invoke("open_pi_terminal", { cwd, session: null }).catch(report)}><Icon name="terminal-window" />打开终端</Button><p className="field-note">完整能力与参数边界见文档说明。</p></section>;
}

export function GeneralSettingsPanel() {
  const ask = usePrompt();
  const cwd = useWorkspace(state => state.cwd);
  const status = useWorkspace(state => state.connection);
  const state = useWorkspace(workspace => workspace.state);
  const running = useWorkspace(workspace => workspace.transcript.running);
  const toolStatus = useWorkspace(workspace => workspace.statuses["gui-tools"]);
  const [path, setPath] = useState(cwd);
  const [busy, setBusy] = useState(false);
  const [trustMode, setTrustMode] = useState<ProjectTrustMode>("ask");
  const [trustBusy, setTrustBusy] = useState(false);
  let tools: GuiTools = { tools: [], active: [] };
  try { if (toolStatus) tools = JSON.parse(toolStatus); } catch { /* Older extension output stays in diagnostics. */ }

  useEffect(() => {
    if (status !== "online") return;
    void request<{ commands: { name: string }[] }>({ type: "get_commands" }).then(data => {
      if (data.commands.some(command => command.name === "gui-tools")) return request({ type: "prompt", message: "/gui-tools" });
    }).catch(report);
  }, [status]);
  useEffect(() => { if (native) void getProjectTrustMode().then(setTrustMode).catch(report); }, []);

  async function manualCompact() {
    const instructions = await ask({ title: "压缩说明（可以留空）", multiline: true });
    if (instructions !== null) await request({ type: "compact", customInstructions: instructions }, 180000).then(() => loadMessages(cwd));
  }
  async function reconnect() {
    setBusy(true);
    try { await connect(path, "project"); gooeyToast.success("项目已连接", { description: path, showTimestamp: false }); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function changeTrustMode(mode: ProjectTrustMode) {
    setTrustBusy(true);
    try {
      await setProjectTrustMode(mode);
      setTrustMode(mode);
      if (status === "online") { await disconnect(); await connect(cwd); }
      gooeyToast.success("项目权限已更新", { showTimestamp: false });
    } catch (error) { report(error); }
    finally { setTrustBusy(false); }
  }

  return <>
    <div className="panel-heading"><div><h1>常规</h1><p>连接、外观与当前会话的运行方式。</p></div></div>
    <ThemeSettings />
    <ProjectDirectorySettings path={path} setPath={setPath} busy={busy} running={running} status={status} onReconnect={reconnect} />
    <TrustSettings mode={trustMode} busy={trustBusy} onChange={changeTrustMode} />
    <ContextSettings cwd={cwd} status={status} running={running} state={state} onCompact={manualCompact} />
    <QueueSettings status={status} state={state} />
    <ToolsSettings tools={tools} running={running} />
    <TerminalSettings cwd={cwd} />
  </>;
}
