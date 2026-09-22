import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { collectCandidateSet, nodeLabel, type OutlineNode, type Rect } from "./candidate-policy.ts"
import { resolveAppIntent, resolveWindowIntent, type TargetResolution } from "./desktop-target-resolver.ts"
import type { GuiAction, GuiActionResult, GuiObservation, GuiTargetResolution, GuiTaskDriver, GuiTaskInput } from "./gui-task-contract.ts"

type CuaModule = typeof import("@trycua/cua-driver")
type CuaRuntime = import("@trycua/cua-driver").CuaDriverLike
type WindowState = import("@trycua/cua-driver").WindowStateOutput
type ToolResult = import("@trycua/cua-driver").ToolResult
type ActionResult = import("@trycua/cua-driver").ActionResult
type AppInfo = import("@trycua/cua-driver").AppInfo
type WindowInfo = import("@trycua/cua-driver").WindowInfo
type CuaContext = { api: CuaModule; driver: CuaRuntime }
type WindowTarget = { pid: number; windowId: bigint; appName: string; title: string; appResolution: TargetResolution; windowResolution?: TargetResolution }

let sharedRuntime: Promise<{ api: CuaModule; driver: CuaRuntime }> | undefined
const session = `orbit-gui-${process.pid}`

async function runtime(): Promise<{ api: CuaModule; driver: CuaRuntime }> {
  if (sharedRuntime) return sharedRuntime
  const creating = import("@trycua/cua-driver").then(api => {
    if (process.platform === "darwin") {
      let permissions = api.currentMacOsPermissionStatus()
      if (!permissions.accessibility || !permissions.screenRecording) permissions = api.requestMacOsPermissions()
      if (!permissions.accessibility || !permissions.screenRecording) throw new Error(`Cua Driver requires macOS Accessibility and Screen Recording permissions. accessibility=${permissions.accessibility} screenRecording=${permissions.screenRecording}`)
    }
    const driver = api.CuaDriver.create(undefined)
    if (!driver.isAvailable()) throw new Error("Cua Driver is unavailable on this platform")
    return { api, driver }
  })
  sharedRuntime = creating
  try { return await creating }
  catch (error) {
    if (sharedRuntime === creating) sharedRuntime = undefined
    throw error
  }
}

export async function shutdownCuaDriver(): Promise<void> {
  const current = sharedRuntime
  sharedRuntime = undefined
  if (!current) return
  const resolved = await current.catch(() => undefined)
  if (!resolved) return
  const { driver } = resolved
  await driver.shutdown().catch(() => undefined)
  const destructible = driver as CuaRuntime & { uniffiDestroy?: () => void }
  destructible.uniffiDestroy?.()
}

export function createCuaDriver(_ctx: unknown, signal?: AbortSignal): GuiTaskDriver {
  let input: GuiTaskInput | undefined
  let target: WindowTarget | undefined
  return {
    async start(task) {
      input = task
      const current = await runtime()
      target = await resolveTarget(current, task, signal)
      return observe(current, target, task, signal)
    },
    async refresh() {
      if (!input || !target) throw new Error("Cua Driver observation has no task owner")
      return observe(await runtime(), target, input, signal)
    },
    async act(observation, action) {
      if (!input || !target) throw new Error("Cua Driver observation has no task owner")
      assertCurrentTarget(observation, action)
      const current = await runtime()
      const executed = await executeAction(current, target, action, signal)
      const next = await observe(current, target, input, signal)
      const observed = action.action === "typeText" && next.presentSlotIds.includes(action.slotId)
      const textDelivery = action.action === "typeText"
        ? observed || executed.outcome === "worked" ? "verified" : executed.outcome === "unknown" ? "unverified" : undefined
        : undefined
      if (textDelivery === "verified" && action.action === "typeText" && !next.presentSlotIds.includes(action.slotId)) next.presentSlotIds.push(action.slotId)
      return { observation: next, outcome: textDelivery === "verified" ? "worked" : executed.outcome, textDelivery } satisfies GuiActionResult
    },
  }
}

async function resolveTarget(current: CuaContext, task: GuiTaskInput, signal?: AbortSignal): Promise<WindowTarget> {
  const { target } = task
  const inventory = await listApps(current, signal)
  const resolvedApp = await resolveAppIntent(target.app, inventory, signal)
  let app = resolvedApp.app
  const deadline = Date.now() + (target.launch?.timeoutMs ?? 0)
  let launchRequested = false

  if (!app.running) {
    if (!target.launch) throw new Error(`The resolved desktop application is not running: ${app.name}`)
    await launchApp(current, app, signal)
    launchRequested = true
    app = await waitForRunningApp(current, app, deadline, signal)
  }

  let windows = await listWindows(current, app.pid, signal)
  if (windows.length === 0 && target.launch && !launchRequested) {
    await launchApp(current, app, signal)
    windows = await listWindows(current, app.pid, signal)
  }
  if (windows.length === 0) windows = await waitForWindows(current, app.pid, deadline, signal)
  const resolvedWindow = await resolveWindowIntent(task.goal, target.windowTitle, windows, signal)
  const window = resolvedWindow.window
  if (target.activation === "foreground") {
    const liveApp = (await listApps(current, signal)).find(candidate => candidate.running && sameAppIdentity(candidate, app))
    if (!liveApp?.active) {
      const activation = await callTool(current, "bring_to_front", { pid: app.pid, window_id: safeWindowId(window.windowId) }, signal)
      if (toolResultOutcome(current.api, activation) !== "worked") throw new Error(`Cua Driver could not verify foreground activation for: ${app.name}`)
    }
  }
  return {
    pid: app.pid,
    windowId: window.windowId,
    appName: window.appName,
    title: window.title,
    appResolution: resolvedApp.resolution,
    windowResolution: resolvedWindow.resolution,
  }
}

async function listApps(current: CuaContext, signal?: AbortSignal): Promise<AppInfo[]> {
  return (await current.driver.listApps(current.api.ListAppsInput.new({}), abortOptions(signal))).apps
}

async function launchApp(current: CuaContext, app: AppInfo, signal?: AbortSignal): Promise<void> {
  const args = app.bundleId ? { bundle_id: app.bundleId } : { name: app.name }
  await callTool(current, "launch_app", args, signal)
}

async function listWindows(current: CuaContext, pid: number, signal?: AbortSignal): Promise<WindowInfo[]> {
  return (await current.driver.listWindows(current.api.ListWindowsInput.new({ pid, onScreenOnly: false }), abortOptions(signal))).windows
}

async function waitForRunningApp(current: CuaContext, expected: AppInfo, deadline: number, signal?: AbortSignal): Promise<AppInfo> {
  while (true) {
    const running = (await listApps(current, signal)).filter(app => app.running && sameAppIdentity(app, expected))
    if (running.length === 1) return running[0]
    if (running.length > 1) throw new Error(`Cua Driver returned multiple running processes for: ${expected.name}`)
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the application process: ${expected.name}`)
    await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal })
  }
}

async function waitForWindows(current: CuaContext, pid: number, deadline: number, signal?: AbortSignal): Promise<WindowInfo[]> {
  while (true) {
    const windows = await listWindows(current, pid, signal)
    if (windows.length > 0) return windows
    if (Date.now() >= deadline) throw new Error(`The resolved application process ${pid} does not expose a top-level window`)
    await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal })
  }
}

function sameAppIdentity(left: AppInfo, right: AppInfo): boolean {
  if (left.bundleId && right.bundleId) return left.bundleId === right.bundleId
  if (left.launchPath && right.launchPath) return left.launchPath === right.launchPath
  return left.name === right.name
}

async function observe(current: CuaContext, target: WindowTarget, task: GuiTaskInput, signal?: AbortSignal): Promise<GuiObservation> {
  const state = await current.driver.getWindowState(current.api.GetWindowStateInput.new({
    pid: target.pid,
    windowId: target.windowId,
    session,
    includeAccessibilityTree: true,
    includeScreenshot: true,
    maxElements: 4_000,
    maxDimension: 1_600,
  }), abortOptions(signal))
  return toObservation(state, task, target)
}

async function executeAction(current: CuaContext, target: WindowTarget, action: GuiAction, signal?: AbortSignal): Promise<{ outcome: GuiActionResult["outcome"] }> {
  const exactTarget = current.api.ActionTarget.Window.new({ pid: target.pid, windowId: target.windowId })
  if (action.action === "click") {
    if (action.target.kind === "element") {
      const result = await current.driver.click(current.api.ClickInput.new({
        target: exactTarget,
        position: current.api.ClickPosition.Element.new({ elementToken: action.target.ref }),
        deliveryMode: current.api.InputDeliveryMode.Background,
        session,
      }), abortOptions(signal))
      return { outcome: actionResultOutcome(current.api, result) }
    }
    return { outcome: toolResultOutcome(current.api, await callTool(current, "click", {
      target: { kind: "window", pid: target.pid, window_id: safeWindowId(target.windowId) },
      x: action.target.x,
      y: action.target.y,
      delivery_mode: "background",
      session,
    }, signal)) }
  }

  if (action.action === "typeText") {
    if (action.target.kind === "element") return { outcome: toolResultOutcome(current.api, await callTool(current, "set_value", {
      pid: target.pid,
      element_token: action.target.ref,
      value: action.text,
      session,
    }, signal)) }
    const targetArgs = { target: { kind: "window", pid: target.pid, window_id: safeWindowId(target.windowId) }, session }
    const modifier = process.platform === "darwin" ? "cmd" : "ctrl"
    const selected = await callTool(current, "hotkey", {
      ...targetArgs,
      x: action.target.x,
      y: action.target.y,
      keys: [modifier, "a"],
      delivery_mode: "background",
    }, signal)
    if (toolResultOutcome(current.api, selected) === "didnt") return { outcome: "didnt" }
    return { outcome: toolResultOutcome(current.api, await callTool(current, "type_text", {
      ...targetArgs,
      text: action.text,
      delivery_mode: "background",
    }, signal)) }
  }

  const args: Record<string, unknown> = {
    target: { kind: "window", pid: target.pid, window_id: safeWindowId(target.windowId) },
    direction: action.scrollY > 0 ? "down" : "up",
    by: "line",
    amount: Math.max(1, Math.min(50, Math.round(Math.abs(action.scrollY)))),
    delivery_mode: "background",
    session,
  }
  if (action.target.kind === "element") args.element_token = action.target.ref
  else { args.x = action.target.x; args.y = action.target.y }
  return { outcome: toolResultOutcome(current.api, await callTool(current, "scroll", args, signal)) }
}

async function callTool(current: CuaContext, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  try {
    const result = await current.driver.callTool(name, JSON.stringify(args), abortOptions(signal))
    if (result.isError) throw new Error(result.errorCode ? `${name} failed (${result.errorCode}): ${result.text}` : `${name} failed: ${result.text}`)
    return result
  } catch (error) {
    if (current.api.DriverError.Tool.hasInner(error)) {
      const inner = current.api.DriverError.Tool.getInner(error)
      throw new Error(`${inner.tool || name} failed (${inner.errorCode}): ${inner.message}`, { cause: error })
    }
    throw error
  }
}

function abortOptions(signal?: AbortSignal): { signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined
}

function safeWindowId(value: bigint): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error("Cua Driver window ID exceeds JSON's safe integer range")
  return number
}

function actionResultOutcome(api: CuaModule, result: ActionResult): GuiActionResult["outcome"] {
  if (result.effect === api.ActionEffect.Confirmed) return "worked"
  if (result.effect === api.ActionEffect.Refused || result.effect === api.ActionEffect.SuspectedNoop) return "didnt"
  return "unknown"
}

function toolResultOutcome(api: CuaModule, result: ToolResult): GuiActionResult["outcome"] {
  return result.action ? actionResultOutcome(api, result.action) : "unknown"
}

function toObservation(state: WindowState, task: GuiTaskInput, target: WindowTarget): GuiObservation {
  const rootRef = `cua:${state.pid}:${state.windowId.toString()}`
  const image = state.images.find(candidate => candidate.mimeType === "image/png") ?? state.images[0]
  const width = state.screenshotWidth
  const height = state.screenshotHeight
  if (!image?.dataBase64 || !width || !height || state.screenshotFrameValid === false) throw new Error("Cua Driver returned an incomplete window observation")
  const stateId = state.snapshotId ?? createHash("sha256").update(image.dataBase64, "base64").digest("hex")
  const outline = outlineFromState(state, rootRef, width, height)
  const visualCapture = { stateId, width, height }
  const selected = collectCandidateSet(outline, task.scope, task.textSlots ?? [], visualCapture)
  const observed = observationContext(outline)
  const resolution = [target.appResolution, target.windowResolution].filter((value): value is TargetResolution => Boolean(value))
  const targetResolution = summarizeTargetResolution(resolution)
  const targetContext = `target: app=${target.appName}; pid=${target.pid}; window=${target.title || "(untitled)"}; resolution=${resolution.map(value => value.strategy === "exact" ? "exact" : `semantic:${value.model}:${value.confidence?.toFixed(2)}`).join("+")}`
  const context = `${targetContext}\n${observed.context}`
  const verificationContext = observed.verificationContext
  const { nodes, mediaTracks } = observed
  const title = state.windowTitle ?? ""
  const fingerprint = semanticFingerprint(title, "", selected.candidates, selected.collections)
  const candidateStats = selected.candidates.reduce((counts, candidate) => {
    counts[candidate.target.kind === "element" ? "accessibility" : "visual"]++
    return counts
  }, { accessibility: 0, visual: 0 })
  const presentSlotIds = (task.textSlots ?? []).filter(slot => nodes.some(node => !node.inWebContent && (node.canSetValue || node.isTextInput) && node.value === slot.value)).map(slot => slot.id)
  const controls = nodes.map(node => ({
    label: String(node.label || ""),
    role: String(node.role || "element"),
    value: node.inWebContent ? undefined : typeof node.value === "string" ? node.value : undefined,
    checked: typeof node.checked === "boolean" ? node.checked : undefined,
    selected: typeof node.selected === "boolean" ? node.selected : undefined,
  })).filter(control => control.label)
  return {
    stateId,
    rootRef,
    title,
    url: "",
    controls,
    candidates: selected.candidates,
    collections: selected.collections,
    candidateStats,
    capturedAt: Date.now(),
    mediaTracks,
    presentSlotIds,
    deferred: selected.deferred,
    context,
    verificationContext,
    fingerprint,
    targetReady: true,
    targetResolution,
  }
}

function summarizeTargetResolution(resolutions: TargetResolution[]): GuiTargetResolution {
  const semantic = resolutions.filter(resolution => resolution.strategy === "semantic")
  const confidences = semantic.flatMap(resolution => resolution.confidence === undefined ? [] : [resolution.confidence])
  return {
    strategy: semantic.length ? "semantic" : "exact",
    decisions: semantic.length,
    models: [...new Set(semantic.flatMap(resolution => resolution.model ? [resolution.model] : []))],
    confidence: confidences.length ? Math.min(...confidences) : undefined,
    latencyMs: semantic.reduce((sum, resolution) => sum + (resolution.latencyMs ?? 0), 0),
    inputTokens: semantic.reduce((sum, resolution) => sum + (resolution.usage?.inputTokens ?? 0), 0),
    outputTokens: semantic.reduce((sum, resolution) => sum + (resolution.usage?.outputTokens ?? 0), 0),
  }
}

function outlineFromState(state: WindowState, rootRef: string, width: number, height: number): OutlineNode {
  const root: OutlineNode = { ref: rootRef, role: "AXWindow", title: state.windowTitle, rect: { x: 0, y: 0, w: width, h: height }, children: [] }
  const elements = state.elements ?? []
  const byIndex = new Map<bigint, OutlineNode>()
  for (const element of elements) {
    const actions = new Set((element.actions ?? []).map(normalizeActionName))
    const role = element.role || "element"
    const normalizedRole = role.toLowerCase().replace(/^ax/, "")
    const editable = ["textfield", "searchfield", "textarea", "textview", "textbox", "editabletext"].includes(normalizedRole)
    const frame = element.frame && state.windowBounds
      ? {
          x: (element.frame.x - state.windowBounds.x) * (width / state.windowBounds.width),
          y: (element.frame.y - state.windowBounds.y) * (height / state.windowBounds.height),
          w: element.frame.w * (width / state.windowBounds.width),
          h: element.frame.h * (height / state.windowBounds.height),
        }
      : undefined
    const node: OutlineNode = {
      ref: element.elementToken,
      role,
      title: element.label,
      value: element.value,
      disabled: element.enabled === false,
      selected: element.selected,
      rect: frame,
      canPress: [...actions].some(action => ["press", "click", "pick", "confirm", "open", "show_menu"].includes(action)),
      canFocus: actions.has("focus"),
      canSetValue: actions.has("set_value") || actions.has("setvalue") || actions.has("type_text") || actions.has("typetext") || editable,
      canScroll: actions.has("scroll"),
      isTextInput: editable,
      pictureOnly: false,
      offscreen: frame ? !validFrame(frame, width, height) : false,
      inWebContent: element.inWebContent,
      children: [],
    }
    byIndex.set(element.elementIndex, node)
  }
  for (const element of elements) {
    const node = byIndex.get(element.elementIndex)!
    const parent = element.parentIndex === undefined ? root : byIndex.get(element.parentIndex) ?? root
    parent.children!.push(node)
  }
  return root
}

function validFrame(frame: Rect, width: number, height: number): boolean {
  return [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)
    && frame.w > 0 && frame.h > 0 && frame.x >= 0 && frame.y >= 0
    && frame.x + frame.w <= width && frame.y + frame.h <= height
}

function normalizeActionName(value: string): string {
  return value.toLowerCase().replace(/^ax/, "").replace(/[\s-]/g, "_")
}

function stateNode(node: OutlineNode): Record<string, unknown> {
  return { role: node.role, label: nodeLabel(node), value: node.value, checked: node.checked, selected: node.selected, canSetValue: node.canSetValue, isTextInput: node.isTextInput, inWebContent: node.inWebContent, rect: node.rect }
}

function observationContext(root: OutlineNode): { context: string; verificationContext: string; nodes: Record<string, unknown>[]; mediaTracks: Record<string, number> } {
  const nodes: Record<string, unknown>[] = []
  const lines: string[] = []
  const verificationLines: string[] = []
  const visit = (node: OutlineNode) => {
    const state = stateNode(node)
    nodes.push(state)
    const label = String(state.label || "")
    const value = typeof state.value === "string" && state.value ? " filled=true" : ""
    const checked = state.checked === undefined ? "" : ` checked=${String(state.checked)}`
    if (label) lines.push(`${node.role || "element"}: ${label}${value}${checked}`)
    if (label) verificationLines.push(`${node.role || "element"}: ${label}${typeof state.value === "string" && state.value ? ` value=${state.value}` : ""}${checked}`)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return {
    context: lines.join("\n").slice(0, 8_000),
    verificationContext: verificationLines.join("\n").slice(0, 12_000),
    nodes,
    mediaTracks: collectMediaTracks(root),
  }
}

export function semanticFingerprint(title: string, url: string, candidates: GuiObservation["candidates"], collections: GuiObservation["collections"] = []): string {
  const actionable = candidates.filter(candidate => candidate.role !== "visual text" && candidate.role !== "viewport").map(candidate => JSON.stringify({
    action: candidate.action,
    role: candidate.role,
    label: candidate.label,
    slotId: candidate.slotId,
    scrollY: candidate.scrollY,
    state: candidate.state,
    target: candidate.target.kind === "point" ? { kind: "point", regionId: candidate.target.regionId, x: candidate.target.x, y: candidate.target.y } : { kind: "element" },
  })).sort()
  const collectionState = collections.map(collection => ({ label: collection.label, size: collection.size, order: collection.order, items: collection.items.map(item => item.ordinal) }))
  return createHash("sha256").update(JSON.stringify({ title, url, actionable, collections: collectionState })).digest("hex")
}

function assertCurrentTarget(observation: GuiObservation, action: GuiAction): void {
  if (action.target.kind === "point" && action.target.captureId !== observation.stateId) throw new Error("Visual action belongs to a stale Cua Driver snapshot")
}

function parseMediaClock(value: string): number | undefined {
  const match = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/.exec(value.trim())
  if (!match) return undefined
  return Number(match[1] ?? 0) * 3_600 + Number(match[2]) * 60 + Number(match[3])
}

function collectMediaTracks(root: OutlineNode): Record<string, number> {
  const tracks: Record<string, number> = {}
  const visit = (node: OutlineNode): boolean => {
    const childHasTrack = (node.children ?? []).map(visit).some(Boolean)
    if (childHasTrack) return true
    const values: string[] = []
    const queue = [...(node.children ?? [])]
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]
      if (!current.offscreen) {
        const visible = typeof current.value === "string" && current.value.trim() ? current.value.trim() : nodeLabel(current)
        if (visible) values.push(visible)
      }
      queue.push(...(current.children ?? []))
    }
    for (let index = 0; index + 2 < values.length; index++) {
      const current = parseMediaClock(values[index])
      const duration = parseMediaClock(values[index + 2])
      if (current !== undefined && values[index + 1] === "/" && duration !== undefined && duration >= current) {
        const rect = node.rect
        const geometry = rect ? [rect.x, rect.y, rect.w, rect.h].map(value => Math.round(value)).join(":") : "unknown"
        tracks[`duration:${duration}:rect:${geometry}`] = current
        return true
      }
    }
    return false
  }
  visit(root)
  return tracks
}
