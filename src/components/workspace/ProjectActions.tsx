import { useState } from "react"
import type { Project } from "../../lib/projects"
import { projectRoots } from "../../lib/projects"
import { shortenPath } from "../../lib/workspace-roots"
import { Icon } from "../Icon"
import { Button } from "../UI"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

type ProjectActionsProps = {
  project: Project
  homeDir: string
  taskCount: number
  onEdit: () => void
  onRemove: () => void
}

export function ProjectActions({ project, homeDir, taskCount, onEdit, onRemove }: ProjectActionsProps) {
  const [open, setOpen] = useState(false)
  const roots = projectRoots(project)
  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button className="sidebar-project-actions" aria-label={`${project.name} 项目菜单`} />}>
      <Icon name="dots-three-bold" />
    </PopoverTrigger>
    <PopoverContent className="project-actions-menu" align="end" side="bottom" sideOffset={5}>
      <div className="project-actions-summary">
        <Icon name="folder-open" />
        <strong>{project.name}</strong>
        {roots.length > 1 && <em>{roots.length} 个目录</em>}
      </div>
      <div className="project-actions-items">
        <div className="project-actions-info"><Icon name="chat-circle" /><span>{taskCount} 个任务</span></div>
        <div className="project-actions-info"><Icon name="folder-simple" /><span title={project.path}>{shortenPath(project.path, homeDir)}</span></div>
        <Button onClick={() => choose(onEdit)}><Icon name="gear-six" />编辑项目</Button>
        <Button className="project-actions-danger" variant="destructive" onClick={() => choose(onRemove)}><Icon name="trash" />移除项目</Button>
      </div>
    </PopoverContent>
  </Popover>
}
