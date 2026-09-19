export const WORKSPACE_STATUS = "gui-workspace"

export function extraRootsFromStatus(statuses: Record<string, string>): string[] {
  const text = statuses[WORKSPACE_STATUS]
  return text ? (JSON.parse(text) as { roots: string[] }).roots : []
}

export function shortenPath(path: string, homeDir: string): string {
  if (path === homeDir) return "~"
  return homeDir && path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path
}
