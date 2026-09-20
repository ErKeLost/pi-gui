import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { AgentToolResult } from "@earendil-works/pi-agent-core"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { collectCandidateSet, nodeLabel, type OutlineNode } from "./candidate-policy.ts"
import type { GuiActionResult, GuiObservation, GuiTaskDriver, GuiTaskInput } from "./gui-task-contract.ts"

type CuModule = typeof import("../pi-computer-use/src/bridge.ts")
const READY_ATTEMPTS = 5
const READY_DELAY_MS = 500

export function createPiComputerUseDriver(ctx: ExtensionContext, signal?: AbortSignal): GuiTaskDriver {
  let cu: CuModule | undefined
  let input: GuiTaskInput | undefined
  const bridge = async () => cu ??= await import("../pi-computer-use/src/bridge.ts")
  return {
    async start(task) {
      input = task
      const api = await bridge()
      let result = task.target.kind === "browser"
        ? await api.executeLaunchBrowser("gui_task", { url: task.target.url }, signal, undefined, ctx)
        : await observeApp(api, task.target.app || "", ctx, signal)
      let observation = toObservation(result, task)
      for (let attempt = 1; observation.candidates.length === 0 && observation.deferred === 0 && attempt <= READY_ATTEMPTS; attempt++) {
        await delay(READY_DELAY_MS, undefined, { signal })
        result = await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx)
        observation = toObservation(result, task)
      }
      return observation
    },
    async refresh(observation) {
      if (!input) throw new Error("Computer Use observation has no task owner")
      const api = await bridge()
      await delay(400, undefined, { signal })
      return toObservation(await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx), input)
    },
    async act(observation, action) {
      const api = await bridge()
      try {
        const request = action.action === "setText" ? { action: "setText", ref: action.ref, text: action.text } : action
        const result = await api.executeAct("gui_task", { stateId: observation.stateId, actions: [request] }, signal, undefined, ctx)
        return { observation: toObservation(result, requireTask(input)), outcome: actionOutcome(result) } satisfies GuiActionResult
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/stale|changed|evicted|epoch/i.test(message)) throw error
        const result = await api.executeObserve("gui_task", { root: observation.rootRef, mode: "semantic" }, signal, undefined, ctx)
        return { observation: toObservation(result, requireTask(input)), outcome: "stale" }
      }
    },
  }
}

function stateNode(node: OutlineNode): Record<string, unknown> {
  return { ref: node.ref, role: node.role, label: nodeLabel(node), value: node.value, checked: node.checked, selected: node.selected, disabled: node.disabled, actions: node.actions }
}

function observationContext(root: OutlineNode): { context: string; verificationContext: string; fingerprint: string; nodes: Record<string, unknown>[] } {
  const nodes: Record<string, unknown>[] = []
  const lines: string[] = []
  const verificationLines: string[] = []
  const visit = (node: OutlineNode) => {
    const state = stateNode(node)
    nodes.push(state)
    const label = String(state.label || "")
    const value = typeof state.value === "string" && state.value ? " filled=true" : ""
    const verificationValue = typeof state.value === "string" && state.value ? ` value=${state.value}` : ""
    const checked = state.checked === undefined ? "" : ` checked=${String(state.checked)}`
    if (label) {
      lines.push(`${node.role || "element"}: ${label}${value}${checked}`)
      verificationLines.push(`${node.role || "element"}: ${label}${verificationValue}${checked}`)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  const context = lines.join("\n").slice(0, 8_000)
  const verificationContext = verificationLines.join("\n").slice(0, 12_000)
  const fingerprint = createHash("sha256").update(JSON.stringify(nodes)).digest("hex")
  return { context, verificationContext, fingerprint, nodes }
}

function toObservation(result: AgentToolResult<unknown>, task: GuiTaskInput): GuiObservation {
  const details = result.details as Record<string, unknown> | undefined
  const capture = details?.capture as { stateId?: string } | undefined
  const root = details?.root as { ref?: string; title?: string; url?: string } | undefined
  const target = details?.target as { windowRef?: string; windowTitle?: string } | undefined
  const outline = details?.outline as { root?: OutlineNode } | undefined
  const stateId = capture?.stateId || (typeof details?.stateId === "string" ? details.stateId : undefined)
  const rootRef = root?.ref || target?.windowRef
  if (!stateId || !rootRef || !outline?.root) throw new Error("Computer Use returned an incomplete observation.")
  if (task.target.kind === "browser") assertAllowedOrigin(root?.url, task.target.allowedOrigins ?? [])
  const { context, verificationContext, fingerprint, nodes } = observationContext(outline.root)
  const selected = collectCandidateSet(outline.root, task.scope, task.textSlots ?? [], task.goal)
  const controls = nodes.map(node => ({ label: String(node.label || ""), role: String(node.role || "element"), value: typeof node.value === "string" ? node.value : undefined, checked: typeof node.checked === "boolean" ? node.checked : undefined, selected: typeof node.selected === "boolean" ? node.selected : undefined })).filter(control => control.label)
  return { stateId, rootRef, title: root?.title || target?.windowTitle || "", url: root?.url || "", controls, candidates: selected.candidates, deferred: selected.deferred, context, verificationContext, fingerprint }
}

function assertAllowedOrigin(value: string | undefined, allowedOrigins: string[]): void {
  if (!value) throw new Error("Computer Use browser observation is missing its URL")
  const current = new URL(value)
  if (!allowedOrigins.some(origin => new URL(origin).origin === current.origin)) throw new Error(`Browser left the authorized origins: ${current.origin}`)
}

function requireTask(task: GuiTaskInput | undefined): GuiTaskInput {
  if (!task) throw new Error("Computer Use observation has no task owner")
  return task
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
