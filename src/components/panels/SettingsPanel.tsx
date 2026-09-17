import { lazy, Suspense, useState, type ReactNode } from "react";
import type { SettingsPage } from "../../lib/store";
import { useWorkspace } from "../../lib/store";
import { Button, Input, Skeleton } from "../UI";
import { Icon } from "../Icon";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";

const SessionsPanel = lazy(() => import("./SessionsPanel").then(module => ({ default: module.SessionsPanel })));
const TreePanel = lazy(() => import("./TreePanel").then(module => ({ default: module.TreePanel })));
const PiToolsPanel = lazy(() => import("./PiToolsPanel").then(module => ({ default: module.PiToolsPanel })));
const ChangesPanel = lazy(() => import("./ChangesPanel").then(module => ({ default: module.ChangesPanel })));
const ConsolePanel = lazy(() => import("./ConsolePanel").then(module => ({ default: module.ConsolePanel })));
const ProviderSettings = lazy(() => import("../ProviderSettings").then(module => ({ default: module.ProviderSettings })));

const settingsGroups: { label: string; items: { id: SettingsPage; label: string; icon: string }[] }[] = [
  { label: "个人", items: [{ id: "general", label: "常规", icon: "gear-six" }, { id: "providers", label: "Provider 与模型", icon: "database" }] },
  { label: "会话", items: [{ id: "sessions", label: "所有会话", icon: "chats" }, { id: "tree", label: "会话树", icon: "tree-structure" }] },
  { label: "高级", items: [{ id: "pi-tools", label: "常用工具", icon: "wrench" }, { id: "changes", label: "代码变更", icon: "code" }, { id: "console", label: "控制台", icon: "terminal-window" }] },
];

function SettingsContent({ page }: { page: SettingsPage }) {
  let content: ReactNode;
  if (page === "general") content = <GeneralSettingsPanel />;
  else if (page === "providers") content = <><div className="panel-heading"><div><h1>Provider 与模型</h1><p>管理端点、凭据和 Pi 可用的模型目录。</p></div></div><ProviderSettings /></>;
  else if (page === "sessions") content = <SessionsPanel />;
  else if (page === "tree") content = <TreePanel />;
  else if (page === "pi-tools") content = <PiToolsPanel />;
  else if (page === "changes") content = <ChangesPanel />;
  else content = <ConsolePanel />;
  return <Suspense fallback={<Skeleton active paragraph={{ rows: 5 }} />}>{content}</Suspense>;
}

export function SettingsPanel() {
  const page = useWorkspace(state => state.settingsPage);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visibleGroups = settingsGroups.map(group => ({ ...group, items: group.items.filter(item => item.label.toLowerCase().includes(query)) })).filter(group => group.items.length);
  return <div className="settings-workspace">
    <aside className="settings-sidebar">
      <Button className="settings-back" onClick={() => useWorkspace.getState().set({ panel: "chat" })}><Icon name="arrow-left" /><span>返回应用</span></Button>
      <label className="settings-search"><Icon name="magnifying-glass" /><Input aria-label="搜索设置" placeholder="搜索设置…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <nav aria-label="设置分类">{visibleGroups.map(group => <section key={group.label}><h2>{group.label}</h2>{group.items.map(item => <Button key={item.id} className={`settings-nav-item ${page === item.id ? "selected" : ""}`} aria-current={page === item.id ? "page" : undefined} onClick={() => useWorkspace.getState().set({ settingsPage: item.id })}><Icon name={item.icon} /><span>{item.label}</span></Button>)}</section>)}{!visibleGroups.length && <p className="settings-search-empty">没有匹配的设置</p>}</nav>
    </aside>
    <main className="settings-main"><div key={page} className={`settings-content settings-${page}-page`}><SettingsContent page={page} /></div></main>
  </div>;
}
