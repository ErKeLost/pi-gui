import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { AgentToolResult } from "@earendil-works/pi-agent-core"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { JevCandidate } from "./jev.ts"
import type { GuiActionResult, GuiObservation, GuiTaskDriver, GuiTaskInput } from "./gui-task-engine.ts"

type OutlineNode = { ref?: string; role?: string; title?: string; description?: string; value?: string; text?: { string?: string }[]; actions?: string[]; canPress?: boolean; canSetValue?: boolean; canScroll?: boolean; isTextInput?: boolean; pictureOnly?: boolean; children?: OutlineNode[] }
type CuModule = typeof import("../pi-computer-use/src/bridge.ts")
const MAX_CANDIDATES = 160
const READY_ATTEMPTS = 5
const READY_DELAY_MS = 500

export function createPiComputerUseDriver(ctx: ExtensionContext, signal?: AbortSignal): GuiTaskDriver {
  let cu: CuModule | undefined
  let query = ""
  const bridge = async () => cu ??= await import("../pi-computer-use/src/bridge.ts")
  return {
    async start(input) {
      query = `${input.goal} ${input.text ?? ""}`
      const api = await bridge()
      let result = input.url ? await api.executeLaunchBrowser("gui_task", { url: input.url }, signal, undefined, ctx) : await observeApp(api, input.app || input.goal, ctx, signal)
      let observation = toObservation(result, query)
      for (let attempt = 1; observation.candidates.length === 0 && attempt <= READY_ATTEMPTS; attempt++) {
        await delay(READY_DELAY_MS, undefined, { signal })
        result = await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx)
        observation = toObservation(result, query)
      }
      return observation
    },
    async refresh(observation) {
      const api = await bridge()
      return toObservation(await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx), query)
    },
    async act(observation, action) {
      const api = await bridge()
      try {
        const result = await api.executeAct("gui_task", { stateId: observation.stateId, actions: [action] }, signal, undefined, ctx)
        return { observation: toObservation(result, query), outcome: actionOutcome(result) } satisfies GuiActionResult
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/stale|changed|unavailable|evicted|epoch/i.test(message)) throw error
        const result = await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx)
        return { observation: toObservation(result, query), outcome: "unknown" }
      }
    },
  }
}

export function collectCandidates(root: OutlineNode | undefined, max = MAX_CANDIDATES, preferredText = ""): JevCandidate[] {
  const candidates: JevCandidate[] = []
  const visit = (node?: OutlineNode) => {
    if (!node) return
    const actions: JevCandidate["actions"] = []
    if (node.canPress || node.actions?.some(action => /press|click/i.test(action))) actions.push("press")
    if (node.canSetValue || node.isTextInput || node.actions?.some(action => /setvalue|settext|typetext/i.test(action))) actions.push("set_value")
    if (node.canScroll || node.actions?.some(action => /scroll/i.test(action))) actions.push("scroll")
    if (node.ref && actions.length && !node.pictureOnly) candidates.push({ ref: node.ref, role: node.role || "element", label: nodeLabel(node), actions })
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  const tokens = preferredText.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2)
  const score = (candidate: JevCandidate) => (candidate.label ? 1 : -2) + tokens.reduce((sum, token) => sum + (candidate.label.toLocaleLowerCase().includes(token) ? 4 : 0), 0)
  const seen = new Set<string>()
  return candidates.sort((a, b) => score(b) - score(a)).filter(candidate => {
    const key = `${candidate.role}\0${candidate.label}\0${candidate.actions.join(",")}`
    if (!candidate.label || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, max)
}

function nodeLabel(node: OutlineNode): string {
  const values: string[] = []
  const collect = (current: OutlineNode, depth: number) => {
    if (depth > 3 || values.join(" ").length >= 160) return
    for (const value of [current.title, current.description, current.value, ...(current.text ?? []).map(item => item.string)]) {
      const text = value?.replace(/\s+/g, " ").trim()
      if (text && !values.includes(text)) values.push(text)
    }
    for (const child of current.children ?? []) collect(child, depth + 1)
  }
  collect(node, 0)
  return values.join(" ").slice(0, 160)
}

function toObservation(result: AgentToolResult<unknown>, query: string): GuiObservation {
  const details = result.details as Record<string, unknown> | undefined
  const capture = details?.capture as { stateId?: string } | undefined
  const root = details?.root as { ref?: string } | undefined
  const target = details?.target as { windowRef?: string } | undefined
  const outline = details?.outline as { root?: OutlineNode } | undefined
  const stateId = capture?.stateId || (typeof details?.stateId === "string" ? details.stateId : undefined)
  const rootRef = root?.ref || target?.windowRef
  if (!stateId || !rootRef || !outline?.root) throw new Error("Computer Use returned an incomplete observation.")
  const context = observationContext(outline.root)
  return { stateId, rootRef, candidates: collectCandidates(outline.root, MAX_CANDIDATES, query), context, fingerprint: createHash("sha256").update(context).digest("hex") }
}

function observationContext(root: OutlineNode): string {
  const lines: string[] = []
  const visit = (node: OutlineNode) => {
    const label = nodeLabel(node)
    if (label) lines.push(`${node.role || "element"}: ${label}`)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return lines.join("\n").slice(0, 8_000)
}

async function observeApp(cu: CuModule, app: string, ctx: ExtensionContext, signal?: AbortSignal) {
  const found = await cu.executeFind("gui_task", { app, text: app }, signal, undefined, ctx)
  const details = found.details as { windows?: { windowRef?: string }[] } | undefined
  const root = details?.windows?.find(item => item.windowRef)?.windowRef
  if (!root) throw new Error(`App not found: ${app}`)
  return cu.executeObserve("gui_task", { root, mode: "semantic" }, signal, undefined, ctx)
}

function actionOutcome(result: AgentToolResult<unknown>): GuiActionResult["outcome"] {
  const details = result.details as { execution?: { outcome?: string } } | undefined
  const outcome = details?.execution?.outcome
  return outcome === "worked" || outcome === "didnt" || outcome === "unknown" ? outcome : "unknown"
}
