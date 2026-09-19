import { FolderClosed } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useProjects } from "../../lib/projects"
import { extraRootsFromStatus, shortenPath } from "../../lib/workspace-roots"
import { report, setSessionRoots } from "../../lib/rpc"
import { useWorkspace } from "../../lib/store"
import { Button } from "../UI"
import { Icon } from "../Icon"

export function SessionRoots({ title, rawTitle }: { title?: string; rawTitle?: string }) {
  const cwd = useWorkspace(state => state.cwd)
  const homeDir = useWorkspace(state => state.homeDir)
  const online = useWorkspace(state => state.connection === "online")
  const extras = extraRootsFromStatus(useWorkspace(state => state.statuses))
  const { projects, update } = useProjects()
  const project = projects.find(item => item.path === cwd)
  const attached = [cwd, ...extras]
  const available = projects.filter(project => project.path !== cwd && !extras.includes(project.path))

  function saveRoots(next: string[]) {
    if (project) update({ ...project, roots: [cwd, ...next] })
    return setSessionRoots(next)
  }

  return <Popover>
    <PopoverTrigger render={<Button className="session-roots-trigger" title="会话项目" />}>
      <FolderClosed className="app-header-folder" strokeWidth={1.7} aria-hidden="true" />
      <strong className="app-header-title" title={rawTitle || title}>{title}</strong>
      <Icon name="caret-up-down" className="session-roots-caret" />
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="session-roots-menu">
      <div className="session-roots-heading"><span>{title || "会话"}</span><small>{attached.length} 个项目</small></div>
      <div className="session-roots-list">
        {attached.map(path => {
          const home = path === cwd
          const name = path.split("/").filter(Boolean).at(-1) || path
          return <div className="session-roots-row" key={path}>
            <Icon name="folder-simple" />
            <span className="session-roots-copy"><strong>{name}</strong><small title={path}>{shortenPath(path, homeDir)}</small></span>
            {home ? <span className="session-roots-home">主目录</span> : <Button className="session-roots-remove" aria-label={`移除 ${name}`} disabled={!online} onClick={() => void saveRoots(extras.filter(root => root !== path)).catch(report)}><Icon name="x" /></Button>}
          </div>
        })}
      </div>
      {available.length > 0 && <div className="session-roots-available">
        {available.map(project => <Button key={project.path} className="session-roots-add" disabled={!online} onClick={() => void saveRoots([...extras, project.path]).catch(report)}>
          <Icon name="plus" /><span className="session-roots-copy"><strong>{project.name}</strong><small title={project.path}>{shortenPath(project.path, homeDir)}</small></span>
        </Button>)}
      </div>}
    </PopoverContent>
  </Popover>
}
