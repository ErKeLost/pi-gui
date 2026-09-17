import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { gooeyToast } from "goey-toast";
import { useWorkspace } from "../../lib/store";
import { loadMessages, native, refresh, report, request } from "../../lib/rpc";
import { Button, Input } from "../UI";
import { usePrompt } from "../../lib/prompt";
import { Icon } from "../Icon";

export function PiToolsPanel() {
  const cwd = useWorkspace(state => state.cwd);
  const online = useWorkspace(state => state.connection === "online");
  const running = useWorkspace(state => state.transcript.running);
  const ask = usePrompt();
  const [packageName, setPackageName] = useState("");

  async function command(message: string) {
    try { await request({ type: "prompt", message }, 60000, cwd); await refresh(cwd); }
    catch (error) { report(error); }
  }
  async function terminalCommand(message: string) {
    if (!native) { report("该 Pi 功能需要桌面应用"); return; }
    try { await invoke("open_pi_terminal", { cwd, session: null, command: message }); gooeyToast.info("已在终端打开 Pi 命令", { description: message, showTimestamp: false }); }
    catch (error) { report(error); }
  }
  async function importSession() {
    if (!native) { report("会话导入需要桌面应用"); return; }
    const selected = await open({ multiple: false, title: "导入 Pi 会话", filters: [{ name: "Pi 会话", extensions: ["jsonl"] }] });
    if (typeof selected !== "string") return;
    await command(`/import ${JSON.stringify(selected)}`);
    await loadMessages(cwd);
    gooeyToast.success("会话已导入", { showTimestamp: false });
  }
  async function rename() {
    const name = await ask({ title: "会话名称", initial: useWorkspace.getState().state?.sessionName ?? "" });
    if (name === null) return;
    try { await request({ type: "set_session_name", name }, 30000, cwd); await refresh(cwd); gooeyToast.success("会话名称已更新", { showTimestamp: false }); }
    catch (error) { report(error); }
  }
  async function copyLast() {
    try {
      const result = await request<{ text: string | null }>({ type: "get_last_assistant_text" }, 30000, cwd);
      if (result.text) { await navigator.clipboard.writeText(result.text); gooeyToast.success("已复制最后一条助手消息", { showTimestamp: false }); }
      else gooeyToast.info("没有可复制的助手消息", { showTimestamp: false });
    } catch (error) { report(error); }
  }
  async function packageCommand(action: "install" | "update" | "remove") {
    if (!native) { report("Pi Package 管理需要桌面应用"); return; }
    if (!packageName.trim() && action !== "update") { report("请输入 Pi Package 名称"); return; }
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const cli = action === "install" ? `pi install ${quote(packageName.trim())}` : action === "remove" ? `pi remove ${quote(packageName.trim())}` : "pi update --extensions";
    try { await invoke("open_pi_terminal", { cwd, session: null, command: cli }); setPackageName(""); }
    catch (error) { report(error); }
  }

  return <>
    <div className="panel-heading"><div><h1>常用工具</h1><p>终端常用能力直接集成在桌面界面。</p></div></div>
    <section className="settings-section"><h2>会话操作</h2><div className="tool-action-grid"><Button disabled={!online || running} onClick={() => void importSession().catch(report)}><Icon name="download" />导入 JSONL</Button><Button disabled={!online} onClick={() => void terminalCommand("/share").catch(report)}><Icon name="share-network" />分享会话</Button><Button disabled={!online} onClick={() => void rename().catch(report)}><Icon name="pencil-simple" />重命名</Button><Button disabled={!online} onClick={() => void copyLast().catch(report)}><Icon name="copy" />复制最后回复</Button></div></section>
    <section className="settings-section"><h2>模型范围与资源</h2><div className="tool-action-grid"><Button disabled={!online || running} onClick={() => void terminalCommand("/scoped-models").catch(report)}><Icon name="funnel" />Scoped Models</Button><Button disabled={!online} onClick={() => void command("/reload").then(() => gooeyToast.success("资源已刷新", { showTimestamp: false })).catch(report)}><Icon name="arrows-clockwise" />重新加载资源</Button><Button disabled={!online} onClick={() => void terminalCommand("/hotkeys").catch(report)}><Icon name="keyboard" />快捷键</Button><Button disabled={!online} onClick={() => void terminalCommand("/changelog").catch(report)}><Icon name="list" />变更记录</Button></div></section>
    <section className="settings-section"><h2>Pi Package</h2><div className="input-row"><Input value={packageName} onChange={event => setPackageName(event.target.value)} placeholder="npm:包名 或 git:仓库" aria-label="Pi Package 名称" /><Button disabled={!online || running} onClick={() => void packageCommand("install").catch(report)}>安装</Button></div><div className="tool-action-grid"><Button disabled={!online || running} onClick={() => void packageCommand("update").catch(report)}>更新全部</Button><Button disabled={!online || running || !packageName.trim()} onClick={() => void packageCommand("remove").catch(report)}>移除</Button></div></section>
    <section className="settings-section"><h2>资源来源</h2><p>技能与命令面板会显示 Pi 返回的 source 信息；扩展的状态、Widget、通知和交互请求会实时同步到当前项目。</p><Button disabled={!online} onClick={() => void command("/reload").then(() => gooeyToast.success("技能、模板与扩展已刷新", { showTimestamp: false })).catch(report)}><Icon name="arrows-clockwise" />刷新技能、模板与扩展</Button></section>
  </>;
}
