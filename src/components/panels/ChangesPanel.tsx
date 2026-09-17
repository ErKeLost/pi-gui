import { lazy, Suspense, useMemo } from "react";
import { useWorkspace } from "../../lib/store";
import { getChange } from "../../lib/changes";
import { Skeleton } from "../UI";
import { Icon } from "../Icon";

const CodeChange = lazy(() => import("../CodeChange").then(module => ({ default: module.CodeChange })));

export function ChangesPanel() {
  const transcript = useWorkspace(state => state.transcript);
  const changes = useMemo(() => transcript.messages.flatMap(item => Array.isArray(item.message.content) ? item.message.content.flatMap(part => {
    if (part.type !== "toolCall") return [];
    const tool = transcript.tools[part.id ?? ""];
    const change = getChange(part.name ?? "", part.arguments, tool?.result);
    return change ? [{ id: part.id, change }] : [];
  }) : []), [transcript.messages, transcript.tools]);
  return <>
    <div className="panel-heading"><div><h1>代码变更</h1><p>Pi 工具返回的真实补丁与写入内容。</p></div></div>
    {!changes.length && <div className="empty-panel"><Icon name="code" /><h3>当前会话尚无文件变更</h3><p>edit 的完整 patch 会显示在这里；write 展示写入内容。</p></div>}
    <Suspense fallback={<Skeleton active />}>{changes.map(item => item.change && <CodeChange key={item.id} change={item.change} />)}</Suspense>
  </>;
}
