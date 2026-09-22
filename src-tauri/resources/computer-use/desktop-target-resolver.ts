import { basename } from "node:path"
import type { AppInfo, WindowInfo } from "@trycua/cua-driver"
import { chooseBoundedOption, type JevChoiceResult } from "./jev.ts"

export type TargetResolution = {
  strategy: "exact" | "semantic"
  model?: string
  confidence?: number
  latencyMs?: number
  usage?: JevChoiceResult["usage"]
}

export async function resolveAppIntent(intent: string, apps: AppInfo[], signal?: AbortSignal): Promise<{ app: AppInfo; resolution: TargetResolution }> {
  const query = normalizeIdentity(intent)
  const exact = apps.filter(app => appIdentities(app).some(identity => normalizeIdentity(identity) === query))
  if (exact.length === 1) return { app: exact[0], resolution: { strategy: "exact" } }

  const candidates = exact.length > 1 ? exact : apps
  const choice = await chooseBoundedOption(
    `Resolve the desktop application intended by: ${intent}`,
    candidates.map((app, index) => ({
      id: `app-${index}`,
      description: `installed desktop application; name=${app.name}; running=${app.running}; active=${app.active}`,
    })),
    "Choose by application meaning, including localization or a commonly used product name. Do not infer an application that is not present in the supplied inventory.",
    signal,
  )
  if (!choice.selectedId) throw new Error(`No installed desktop application unambiguously matches: ${intent}`)
  const index = parseChoiceIndex(choice.selectedId, "app", candidates.length)
  return {
    app: candidates[index],
    resolution: { strategy: "semantic", model: choice.model, confidence: choice.confidence, latencyMs: choice.latencyMs, usage: choice.usage },
  }
}

export async function resolveWindowIntent(goal: string, titleIntent: string | undefined, windows: WindowInfo[], signal?: AbortSignal): Promise<{ window: WindowInfo; resolution?: TargetResolution }> {
  if (windows.length === 0) throw new Error("The resolved application does not expose a top-level window")
  if (titleIntent) {
    const query = normalizeIdentity(titleIntent)
    const exact = windows.filter(window => normalizeIdentity(window.title) === query)
    if (exact.length === 1) return { window: exact[0], resolution: { strategy: "exact" } }
    if (exact.length > 1) return chooseWindow(titleIntent, exact, signal)
    return chooseWindow(titleIntent, windows, signal)
  }

  if (windows.length === 1) return { window: windows[0] }
  const current = windows.filter(window => window.onCurrentSpace === true && window.isOnScreen && window.minimized !== true)
  if (current.length === 1) return { window: current[0] }
  return chooseWindow(goal, current.length > 0 ? current : windows, signal)
}

function chooseWindow(intent: string, windows: WindowInfo[], signal?: AbortSignal): Promise<{ window: WindowInfo; resolution: TargetResolution }> {
  return chooseBoundedOption(
    `Resolve the desktop window needed for: ${intent}`,
    windows.map((window, index) => ({
      id: `window-${index}`,
      description: `top-level window; app=${window.appName}; title=${window.title || "(untitled)"}; onCurrentSpace=${window.onCurrentSpace ?? "unknown"}; onScreen=${window.isOnScreen}; minimized=${window.minimized ?? "unknown"}`,
    })),
    "Choose only the window whose app and title semantics match the requested work. Prefer a usable current-space window when the goal does not distinguish otherwise.",
    signal,
  ).then(choice => {
    if (!choice.selectedId) throw new Error("No top-level window unambiguously matches the desktop goal")
    const index = parseChoiceIndex(choice.selectedId, "window", windows.length)
    return {
      window: windows[index],
      resolution: { strategy: "semantic", model: choice.model, confidence: choice.confidence, latencyMs: choice.latencyMs, usage: choice.usage },
    }
  })
}

function appIdentities(app: AppInfo): string[] {
  const launchName = app.launchPath ? basename(app.launchPath).replace(/\.app$/i, "") : ""
  return [app.name, app.bundleId ?? "", launchName].filter(Boolean)
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function parseChoiceIndex(id: string, prefix: string, length: number): number {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
  const index = match ? Number(match[1]) : -1
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error("Jev selected a target outside the supplied inventory")
  return index
}
