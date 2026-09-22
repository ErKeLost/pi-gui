import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "next-themes";
import { gooeyToast } from "goey-toast";
import { Eye, EyeOff, ScanLine } from "lucide-react";
import QRCode from "antd/es/qr-code";
import type { RpcCommand, RpcSessionState } from "@earendil-works/pi-coding-agent";
import { useWorkspace } from "../../lib/store";
import { computerUseKeyStatus, connect, desktopRuntime, disconnect, getProjectTrustMode, loadMessages, native, refresh, report, request, saveComputerUseKey, setComputerUseMode, setProjectTrustMode, type ProjectTrustMode } from "../../lib/rpc";
import { getRemoteHost, relaySettingsStatus, saveRelaySettings, startRemoteHost, stopRemoteHost, type RelaySettingsStatus, type RemoteHostInfo } from "../../lib/remote-host";
import { checkMobileUpdate, mobileUpdateErrorMessage } from "../../lib/mobile-update";
import { offerMobileUpdate } from "../UpdateChecker";
import { Button, Input, Select, Switch } from "../UI";
import { usePrompt } from "../../lib/prompt";
import { Icon } from "../Icon";
import { ModeToggle } from "../mode-toggle";
import { Card, CardContent } from "../ui/card";
import "../../styles/remote-access.css";

async function applySetting(command: RpcCommand) {
  await request(command);
  await refresh();
  gooeyToast.success("设置已更新", { showTimestamp: false });
}

type GuiTools = { tools: { name: string; description: string }[]; active: string[] };

function SettingsGroup({ title, icon, description, children }: { title: string; icon: string; description?: string; children: ReactNode }) {
  return <section className="settings-group">
    <header className="settings-group-heading"><h2><Icon name={icon} />{title}</h2>{description && <p>{description}</p>}</header>
    <Card className="settings-group-card"><CardContent>{children}</CardContent></Card>
  </section>;
}

function SettingRow({ title, description, children, className = "" }: { title: string; description: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`settings-item ${className}`}>
    <div className="settings-item-copy"><strong>{title}</strong><p>{description}</p></div>
    <div className="settings-item-control">{children}</div>
  </div>;
}

function ThemeSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const remoteTheme = useWorkspace(state => state.remoteTheme);
  if (runtimeTarget === "mobile") {
    const current = remoteTheme === "dark" ? "当前为深色" : remoteTheme === "light" ? "当前为浅色" : "等待电脑主题";
    return <SettingRow title="跟随电脑" description="手机主题由当前连接的电脑控制，电脑切换主题后会自动同步。"><span className="remote-settings-note" aria-live="polite">{current}</span></SettingRow>;
  }
  const preference = theme ?? "system";
  const label = preference === "system" ? "跟随系统" : resolvedTheme === "dark" ? "深色主题" : "浅色主题";
  return <SettingRow title={label} description="默认跟随系统设置，也可以固定使用浅色或深色主题。"><div className="theme-settings-controls"><Select aria-label="主题" value={preference} onChange={event => setTheme(event.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></Select><ModeToggle /></div></SettingRow>;
}

function ProjectDirectorySettings({ path, setPath, busy, running, status, onReconnect }: { path: string; setPath: (value: string) => void; busy: boolean; running: boolean; status: string; onReconnect: () => Promise<void> }) {
  return <SettingRow title="项目目录" description="Pi 以此目录为工作区，并沿用现有的模型与凭据配置。" className="settings-item-directory"><div className="settings-directory-control"><Input value={path} onChange={event => setPath(event.target.value)} aria-label="工作目录" /><div className="settings-directory-actions"><Button variant="default" disabled={busy || running || !native} onClick={() => void onReconnect()}>{busy ? "连接中…" : "连接"}</Button><Button variant="outline" disabled={status !== "online"} onClick={() => void disconnect().catch(report)}>断开</Button></div></div></SettingRow>;
}

function TrustSettings({ mode, busy, desktop, onChange }: { mode: ProjectTrustMode; busy: boolean; desktop: boolean; onChange: (mode: ProjectTrustMode) => Promise<void> }) {
  return <SettingRow title="项目资源信任" description={desktop ? "控制是否加载项目本地的设置、扩展、技能和主题。切换后会重启 Pi 连接。" : "项目资源信任由电脑端管理，请在电脑端查看和修改。"}>{desktop ? <Select aria-label="项目资源信任" disabled={busy} value={mode} onChange={event => void onChange(event.target.value as ProjectTrustMode)}><option value="always">完全访问</option><option value="ask">每次询问</option><option value="never">禁止加载</option></Select> : <span className="remote-settings-note">电脑端设置</span>}</SettingRow>;
}

function ContextSettings({ cwd, status, running, state, onCompact }: { cwd: string; status: string; running: boolean; state: RpcSessionState | null; onCompact: () => Promise<void> }) {
  const stats = useQuery({ queryKey: ["pi", "stats", cwd], queryFn: () => request<{ tokens: { total: number }; cost: number; contextUsage?: { percent: number | null; contextWindow: number } }>({ type: "get_session_stats" }), enabled: status === "online" });
  return <>
    <SettingRow title="自动压缩" description="接近上下文容量时，让 Pi 整理较早的内容。"><Switch aria-label="自动压缩" checked={state?.autoCompactionEnabled ?? false} disabled={status !== "online" || running} onChange={checked => void applySetting({ type: "set_auto_compaction", enabled: checked }).catch(report)} /></SettingRow>
    <SettingRow title="立即压缩" description="现在生成摘要，并可补充需要保留的重点。"><Button variant="outline" disabled={status !== "online" || running} onClick={() => void onCompact().catch(report)}>压缩</Button></SettingRow>
    <div className="settings-stats" aria-busy={stats.isLoading}>
      <div><span>累计 tokens</span><strong>{stats.data?.tokens.total.toLocaleString() ?? "—"}</strong></div>
      <div><span>上下文占用</span><strong>{stats.data?.contextUsage?.percent == null ? "—" : `${stats.data.contextUsage.percent.toFixed(1)}%`}</strong></div>
      <div><span>Pi 报告费用</span><strong>{stats.data ? `$${stats.data.cost.toFixed(4)}` : "—"}</strong></div>
    </div>
  </>;
}

function QueueSettings({ status, state }: { status: string; state: RpcSessionState | null }) {
  return <>{(["steering", "followUp"] as const).map(kind => <SettingRow key={kind} title={kind === "steering" ? "引导消息" : "跟进消息"} description={kind === "steering" ? "当前工具调用完成后交给模型。" : "本轮任务全部结束后交给模型。"}><Select aria-label={kind === "steering" ? "引导消息模式" : "跟进消息模式"} disabled={status !== "online"} value={kind === "steering" ? state?.steeringMode : state?.followUpMode} onChange={event => void applySetting({ type: kind === "steering" ? "set_steering_mode" : "set_follow_up_mode", mode: event.target.value as "all" | "one-at-a-time" }).catch(report)}><option value="one-at-a-time">每次一条</option><option value="all">全部送入</option></Select></SettingRow>)}</>;
}

function ComputerUseSettings({ desktop, online, running }: { desktop: boolean; online: boolean; running: boolean }) {
  const enabled = useWorkspace(state => state.computerUseEnabled);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (desktop) void computerUseKeyStatus().then(status => setHasKey(status.hasKey)).catch(report); }, [desktop]);
  async function saveKey() {
    setBusy(true);
    try {
      const status = await saveComputerUseKey(apiKey);
      setHasKey(status.hasKey);
      setApiKey("");
      gooeyToast.success(status.hasKey ? "Jev Key 已保存" : "Jev Key 已清除", { showTimestamp: false });
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  return <>
    <SettingRow title="电脑操作" description={desktop ? "由你手动打开。打开后用平常说话即可，例如「打开日历翻到上个月」。macOS 请在系统设置里允许「Orbit」的辅助功能和屏幕录制（两页都要开），不要去找 Node。改完后完全退出 Orbit 再打开。" : "电脑操作只能在运行 Pi 的电脑上使用。"}>
      {desktop ? <Switch aria-label="电脑操作" checked={enabled} disabled={!online || running} onChange={checked => void setComputerUseMode(checked).catch(report)} /> : <span className="remote-settings-note">电脑端设置</span>}
    </SettingRow>
    <SettingRow title="Jev API Key" description={desktop ? "从 TypeSafe 控制台粘贴，只存在这台电脑。保存不等于打开电脑操作，开关仍由你控制。" : "Jev Key 由电脑端保管。"}>
      {desktop ? <div className="settings-directory-control"><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={hasKey ? "已保存，留空再保存可覆盖" : "粘贴 TypeSafe API Key"} autoComplete="off" aria-label="Jev API Key" /><div className="settings-directory-actions"><Button variant="default" disabled={busy || !apiKey.trim()} onClick={() => void saveKey()}>{busy ? "保存中…" : "保存"}</Button><Button variant="outline" disabled={busy || !hasKey} onClick={() => { setApiKey(""); void saveComputerUseKey("").then(status => { setHasKey(status.hasKey); gooeyToast.success(status.hasKey ? "已清除 Orbit 保存的 Key，当前仍检测到环境 Key" : "Jev Key 已清除", { showTimestamp: false }); }).catch(report); }}>清除</Button></div></div> : <span className="remote-settings-note">{hasKey ? "电脑端已保存" : "电脑端设置"}</span>}
    </SettingRow>
  </>;
}

function ToolsSettings({ tools, running }: { tools: GuiTools; running: boolean }) {
  const active = new Set(tools.active);
  return <>{tools.tools.map(tool => <SettingRow key={tool.name} title={tool.name} description={tool.description}><Switch aria-label={tool.name} checked={active.has(tool.name)} disabled={running} onChange={checked => { const next = checked ? [...tools.active, tool.name] : tools.active.filter(name => name !== tool.name); void request({ type: "prompt", message: `/gui-tools-set ${JSON.stringify(next)}` }).catch(report); }} /></SettingRow>)}{!tools.tools.length && <p className="settings-empty-note">连接 Pi 后读取工具列表。</p>}</>;
}

function TerminalSettings({ cwd, desktop }: { cwd: string; desktop: boolean }) {
  return <SettingRow title="原生终端环境" description={desktop ? "在独立终端中使用账户登录、包安装和完整的 Pi 交互能力。" : "原生终端需要在电脑端打开。"}><Button variant="outline" disabled={!desktop || !cwd} onClick={() => { if (desktopRuntime()) void invoke("open_pi_terminal", { cwd, session: null, piArgs: [] }).catch(report); }}><Icon name="terminal-window" />打开终端</Button></SettingRow>;
}

function MobileAppUpdateSettings() {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getVersion().then(setVersion).catch(() => undefined); }, []);
  async function check() {
    setBusy(true);
    try {
      const current = version || await getVersion();
      if (!version) setVersion(current);
      const update = await checkMobileUpdate(current);
      if (update) offerMobileUpdate(update);
      else gooeyToast.success(`已是最新版本（${current}）`, { showTimestamp: false });
    } catch (error) {
      gooeyToast.error(mobileUpdateErrorMessage(error), { showTimestamp: false });
    } finally {
      setBusy(false);
    }
  }
  return <SettingRow title="检查更新" description={version ? `当前版本 ${version}。从 GitHub 检查 Android 安装包；网络不好时可稍后重试。` : "从 GitHub 检查 Android 安装包；网络不好时可稍后重试。"}><Button variant="outline" disabled={busy} onClick={() => void check()}>{busy ? "检查中…" : "检查更新"}</Button></SettingRow>;
}

function remoteAddress(host: RemoteHostInfo) {
  const address = host.advertisedAddress.includes(":") ? `[${host.advertisedAddress}]` : host.advertisedAddress;
  return `${address}:${host.port}`;
}

function randomRelaySecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hiddenPairingUri(uri: string) {
  return uri.replace(/([?&]token=)[^&]*/i, "$1********");
}

export function DesktopHostSettings({ pageMode = false }: { pageMode?: boolean } = {}) {
  const [host, setHost] = useState<RemoteHostInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [connectionFeedback, setConnectionFeedback] = useState("");
  const [transport, setTransport] = useState<"lan" | "relay">(() => typeof window === "undefined" ? "lan" : localStorage.getItem("orbit.remote.transport") === "relay" ? "relay" : "lan");
  const [relay, setRelay] = useState<RelaySettingsStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [relaySaving, setRelaySaving] = useState(false);
  const previousClients = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void relaySettingsStatus().then(value => {
      if (!mounted) return;
      setRelay(value);
      setRelayUrl(value.relayUrl);
      if (!value.hasHostKey) setTransport("lan");
    }).catch(report);
    const refreshHost = () => void getRemoteHost().then(info => {
      if (!mounted) return;
      const clients = info?.connectedClients ?? 0;
      if (previousClients.current !== null && clients !== previousClients.current) {
        setConnectionFeedback(clients > previousClients.current ? `手机已连接 · 当前 ${clients} 台` : "手机已断开");
      }
      previousClients.current = clients;
      setHost(info);
      if (info) setTransport(info.mode);
    }).catch(report).finally(() => { if (mounted) setLoading(false); });
    refreshHost();
    const timer = window.setInterval(refreshHost, 2000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  async function start() {
    setBusy("start");
    try {
      if (transport === "relay" && relay && !relay.hasHostKey) throw new Error("请先保存 Relay 地址和 Host Key");
      localStorage.setItem("orbit.remote.transport", transport);
      const info = await startRemoteHost({ mode: transport });
      previousClients.current = info.connectedClients;
      setConnectionFeedback(info.mode === "relay" && !info.relayConnected ? "正在连接中转服务器…" : "");
      setHost(info);
      gooeyToast.success("移动访问已开启", { description: info.mode === "relay" ? info.relayUrl || "公网中转" : `${info.advertisedAddress}:${info.port}`, showTimestamp: false });
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  }

  async function saveRelay() {
    setRelaySaving(true);
    try {
      const normalized = relayUrl.trim().replace(/\/+$/, "");
      if (!/^wss:\/\//i.test(normalized)) throw new Error("Relay 地址必须以 wss:// 开头");
      if (hostKey.trim().length < 32) throw new Error("Host Key 至少 32 位，可点「生成」自动创建");
      const next = await saveRelaySettings({ relayUrl: normalized, hostKey: hostKey.trim() });
      setRelay(next);
      setHostKey("");
      gooeyToast.success("Relay 配置已保存", { showTimestamp: false });
    } catch (error) {
      report(error);
    } finally {
      setRelaySaving(false);
    }
  }

  async function stop() {
    setBusy("stop");
    try {
      await stopRemoteHost();
      setHost(null);
      previousClients.current = null;
      setConnectionFeedback("");
      setRevealed(false);
      setShowQr(false);
      gooeyToast.success("移动访问已关闭", { showTimestamp: false });
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  }

  async function copyPairingUri() {
    if (!host) return;
    try {
      await navigator.clipboard.writeText(host.pairingUri);
      gooeyToast.success("配对链接已复制", { showTimestamp: false });
    } catch (error) {
      report(error);
    }
  }

  const statusLabel = loading ? "正在读取" : host ? "已开启" : "未开启";
  const connectedLabel = host ? (host.connectedClients > 0 ? `手机已连接 · ${host.connectedClients}` : host.mode === "relay" ? (host.relayConnected ? "中转已连接 · 等待手机" : "正在连接中转服务器…") : "等待手机连接") : "";
  const transportSetting = <SettingRow title="连接方式" description={transport === "lan" ? "同一 Wi-Fi 下手机直连电脑，不经过服务器。" : "手机在任何网络（含 5G）通过你自己的阿里云中转服务器连接电脑，电脑无需开放端口。"} className="remote-address-setting">
    <Select aria-label="移动端连接方式" value={transport} disabled={Boolean(host) || Boolean(busy) || Boolean(relay && !relay.hasHostKey && transport === "relay")} onChange={event => setTransport(event.target.value as "lan" | "relay")}>
      <option value="lan">局域网直连</option>
      <option value="relay" disabled={Boolean(relay && !relay.hasHostKey)}>公网中转 · 阿里云</option>
    </Select>
  </SettingRow>;
  const relaySetting = <div className="remote-relay-config">
    <SettingRow title="Relay 地址" description="你的阿里云中转服务器地址，格式 wss://IP 或 wss://域名。" className="remote-relay-setting">
      <Input aria-label="Relay 地址" value={relayUrl} disabled={Boolean(host) || relaySaving} placeholder="wss://101.201.45.25" autoCapitalize="none" autoComplete="off" spellCheck={false} onChange={event => setRelayUrl(event.target.value)} />
    </SettingRow>
    <SettingRow title="Host Key" description={relay?.hasHostKey ? "已保存在本机，只有你的电脑能以这台电脑身份连入中转。留空表示不修改。" : "电脑连入中转服务器的身份密钥，不会出现在手机二维码里。可用「生成」自动创建。"} className="remote-relay-setting">
      <div className="remote-host-key-row">
        <Input type="password" aria-label="Host Key" value={hostKey} disabled={Boolean(host) || relaySaving} placeholder={relay?.hasHostKey ? "已配置，留空保持不变" : "粘贴或生成 Host Key"} autoComplete="off" onChange={event => setHostKey(event.target.value)} />
        <Button variant="outline" disabled={Boolean(host) || relaySaving} onClick={() => setHostKey(randomRelaySecret())}>生成</Button>
      </div>
    </SettingRow>
    <div className="remote-relay-actions"><Button disabled={Boolean(host) || relaySaving || !relayUrl.trim()} onClick={() => void saveRelay()}>{relaySaving ? "保存中…" : "保存 Relay 配置"}</Button></div>
  </div>;
  if (pageMode) {
    return <>
      <section className="mobile-access-host-card" aria-label="电脑 Host">
        <SettingRow title="电脑 Host" description="手机通过局域网直连，或经你自己的阿里云中转服务器从外网连接这台电脑。">
          <div className="remote-host-control">
            <span className="remote-host-status" aria-live="polite"><span className="remote-host-status-dot" data-online={Boolean(host)} />{statusLabel}{host && <small>{connectedLabel}</small>}</span>
            <Switch aria-label="电脑 Host" checked={Boolean(host)} disabled={loading || Boolean(busy)} onChange={checked => void (checked ? start() : stop())} />
          </div>
        </SettingRow>
        {transportSetting}
        {relaySetting}
        <div className="mobile-access-host-body">
          {host ? <>
            <div className="mobile-access-qr-copy">{host.mode === "relay" ? "用手机扫描二维码，任何网络都能连接这台电脑" : "用手机扫描二维码，连接同一 Wi-Fi 下的这台电脑"}</div>
            <div className="mobile-access-qr"><QRCode type="svg" errorLevel="M" value={host.pairingUri} size={280} bordered={false} color="#111111" bgColor="#ffffff" /></div>
            <div className="mobile-access-uri-row">
              <code title={host.pairingUri}>{host.pairingUri}</code>
              <Button variant="ghost" size="icon" title="复制配对链接" aria-label="复制配对链接" onClick={() => void copyPairingUri()}><Icon name="copy" /></Button>
            </div>
            {host.mode === "relay" && <div className="mobile-access-address">中转服务器 <code>{host.relayUrl ?? ""}</code></div>}
            {host.mode === "lan" && <div className="mobile-access-address">局域网地址 <code>{remoteAddress(host)}</code></div>}
            {connectionFeedback && <p className="remote-host-feedback" role="status">{connectionFeedback}</p>}
          </> : <div className="mobile-access-qr-empty"><ScanLine /><strong>开启电脑 Host 后显示二维码</strong><span>手机扫描二维码即可连接当前电脑</span></div>}
        </div>
      </section>
      <section className="mobile-access-devices-card" aria-label="已连接的设备">
        <header><h2>已连接的设备</h2><span>{host?.connectedClients ?? 0} 台</span></header>
        {host?.connectedClients ? Array.from({ length: host.connectedClients }, (_, index) => <div className="remote-host-device" key={index}><Icon name="device-mobile" /><span>移动端设备 {index + 1}</span><small><i />在线</small></div>) : <p>暂无设备连接</p>}
      </section>
    </>;
  }
  return <>
    <SettingRow title="电脑 Host" description="手机通过局域网直连，或经你自己的阿里云中转服务器从外网连接这台电脑。">
      <div className="remote-host-control">
        <span className="remote-host-status" aria-live="polite"><span className="remote-host-status-dot" data-online={Boolean(host)} />{statusLabel}{host && <small>{connectedLabel}</small>}</span>
        <Switch aria-label="电脑 Host" checked={Boolean(host)} disabled={loading || Boolean(busy)} onChange={checked => void (checked ? start() : stop())} />
      </div>
    </SettingRow>
    {transportSetting}
    {relaySetting}
    <div className="remote-host-details">
      {host ? <>
        <div className="remote-host-detail">
          <span>电脑</span>
          <strong className="remote-host-machine">{host.machineName}</strong>
        </div>
        <div className="remote-host-detail">
          <span>{host.mode === "relay" ? "中转服务器" : "连接地址"}</span>
          <code title={host.mode === "relay" ? host.relayUrl ?? "" : remoteAddress(host)}>{host.mode === "relay" ? host.relayUrl ?? "" : remoteAddress(host)}</code>
        </div>
        <div className="remote-host-detail remote-host-pairing">
          <span>配对链接</span>
          <code title={revealed ? host.pairingUri : "配对凭据已隐藏"}>{revealed ? host.pairingUri : hiddenPairingUri(host.pairingUri)}</code>
          <div className="remote-host-detail-actions">
            <Button variant="ghost" size="icon" title={revealed ? "隐藏配对链接" : "显示配对链接"} aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff /> : <Eye />}</Button>
            <Button variant="ghost" size="icon" title="复制配对链接" onClick={() => void copyPairingUri()}><Icon name="copy" /></Button>
            <Button variant="ghost" size="icon" title={showQr ? "隐藏二维码" : "显示二维码"} aria-pressed={showQr} onClick={() => setShowQr(value => !value)}><ScanLine /></Button>
          </div>
        </div>
        {showQr && <div className="remote-host-qr"><QRCode type="svg" errorLevel="M" value={host.pairingUri} size={240} bordered={false} color="#111111" bgColor="#ffffff" /><span>用手机 Orbit 扫描此二维码，连接这台电脑</span></div>}
        {connectionFeedback && <p className="remote-host-feedback" role="status">{connectionFeedback}</p>}
        <p className="remote-host-security"><Icon name="shield-check" />配对链接包含访问凭据，请只发送到自己的设备。</p>
        <div className="remote-host-devices">
          <strong>已连接的设备</strong>
          {host.connectedClients > 0
            ? Array.from({ length: host.connectedClients }, (_, index) => <div className="remote-host-device" key={index}><Icon name="device-mobile" /><span>移动端设备 {index + 1}</span><small><i />在线</small></div>)
            : <p>暂无设备连接</p>}
        </div>
      </> : <>
        <div className="remote-host-qr remote-host-qr-empty"><ScanLine /><strong>开启电脑 Host 后显示二维码</strong><span>手机扫描二维码即可连接当前电脑</span></div>
        <div className="remote-host-detail remote-host-detail-muted"><span>配对状态</span><span>等待开启</span></div>
      </>}
    </div>
  </>;
}

export function MobileAccessSettings() {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const connection = useWorkspace(state => state.connection);
  if (runtimeTarget !== "mobile") return <DesktopHostSettings pageMode />;
  return <SettingRow title="电脑连接" description="移动访问地址和配对凭据由电脑端管理，请在电脑端开启或关闭 Host。"><span className="remote-host-status" aria-live="polite"><span className="remote-host-status-dot" data-online={connection === "online"} />{connection === "online" ? "已连接电脑" : connection === "connecting" ? "正在连接电脑" : "未连接电脑"}</span></SettingRow>;
}

export function GeneralSettingsPanel() {
  const ask = usePrompt();
  const cwd = useWorkspace(state => state.cwd);
  const status = useWorkspace(state => state.connection);
  const state = useWorkspace(workspace => workspace.state);
  const running = useWorkspace(workspace => workspace.transcript.running);
  const toolStatus = useWorkspace(workspace => workspace.statuses["gui-tools"]);
  const runtimeTarget = useWorkspace(workspace => workspace.runtimeTarget);
  const desktop = runtimeTarget === "desktop";
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
  useEffect(() => { if (desktop) void getProjectTrustMode().then(setTrustMode).catch(report); }, [desktop]);

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
    if (!desktopRuntime()) return;
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
    <div className="panel-heading"><div><h1><Icon name="gear-six" />常规</h1></div></div>
    <SettingsGroup title="外观" icon="palette"><ThemeSettings /></SettingsGroup>
    <SettingsGroup title="工作区" icon="folder-simple"><ProjectDirectorySettings path={path} setPath={setPath} busy={busy} running={running} status={status} onReconnect={reconnect} /><TrustSettings mode={trustMode} busy={trustBusy} desktop={desktop} onChange={changeTrustMode} /></SettingsGroup>
    <SettingsGroup title="移动端" icon="device-mobile" description={desktop ? "从手机连接到这台电脑。" : "连接运行 Pi 的电脑。"}><MobileAccessSettings /></SettingsGroup>
    {runtimeTarget === "mobile" && <SettingsGroup title="软件更新" icon="arrows-clockwise" description="主动从 GitHub Release 检查 Android 安装包。"><MobileAppUpdateSettings /></SettingsGroup>}
    <SettingsGroup title="上下文" icon="brain" description="管理当前会话的容量与压缩方式。"><ContextSettings cwd={cwd} status={status} running={running} state={state} onCompact={manualCompact} /></SettingsGroup>
    <SettingsGroup title="消息队列" icon="chats"><QueueSettings status={status} state={state} /></SettingsGroup>
    <SettingsGroup title="电脑操作" icon="desktop" description="让当前 Pi 模型通过界面观察和点击桌面应用。有可靠 API 或 CLI 时不要用。"><ComputerUseSettings desktop={desktop} online={status === "online"} running={running} /></SettingsGroup>
    <SettingsGroup title="工具与终端" icon="wrench"><ToolsSettings tools={tools} running={running} /><TerminalSettings cwd={cwd} desktop={desktop} /></SettingsGroup>
  </>;
}
