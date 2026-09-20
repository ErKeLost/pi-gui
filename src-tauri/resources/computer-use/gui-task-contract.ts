import type { JevCandidate, JevDecision } from "./jev.ts"

export type TextSlot = { id: string; value: string; fieldLabel: string }
export type TaskTarget = { kind: "browser" | "desktop"; url?: string; allowedOrigins?: string[]; app?: string }
export type ControlCondition = { label: string; role?: string; present?: boolean; checked?: boolean; selected?: boolean; valueEquals?: string; valueIncludes?: string }
export type ControlSnapshot = { label: string; role: string; value?: string; checked?: boolean; selected?: boolean }
export type CompletionSpec = { requiredText: string[]; forbiddenText?: string[]; urlIncludes?: string; titleIncludes?: string; controls?: ControlCondition[] }
export type ActionScope = { mode: "explicit" | "observed_low_risk"; clickLabels?: string[]; scrollLabels?: string[]; authorizedConsequentialLabels?: string[] }
export type ExecutionBudget = { maxActions?: number; maxDecisions?: number; maxDurationMs?: number }
export type GuiTaskInput = { version: 1; goal: string; target: TaskTarget; completion: CompletionSpec; scope: ActionScope; textSlots?: TextSlot[]; budget?: ExecutionBudget }

export type GuiAction =
  | { action: "press"; ref: string }
  | { action: "setText"; ref: string; text: string; slotId: string }
  | { action: "scroll"; ref: string; scrollY: number }

export type GuiTraceAction =
  | { action: "press"; ref: string }
  | { action: "setText"; ref: string; slotId: string }
  | { action: "scroll"; ref: string; scrollY: number }

export type GuiObservation = {
  stateId: string
  rootRef: string
  title: string
  url: string
  controls: ControlSnapshot[]
  candidates: JevCandidate[]
  deferred: number
  context: string
  verificationContext: string
  fingerprint: string
}

export type GuiActionResult = { observation: GuiObservation; outcome: "worked" | "didnt" | "unknown" | "stale" }
export interface GuiTaskDriver {
  start(input: GuiTaskInput): Promise<GuiObservation>
  refresh(observation: GuiObservation): Promise<GuiObservation>
  act(observation: GuiObservation, action: GuiAction): Promise<GuiActionResult>
}

export type VerificationResult = { passed: boolean; reasons: string[] }
export type GuiTaskMetrics = { elapsedMs: number; observationMs: number; decisionMs: number; actionMs: number; waits: number; staleDecisions: number; inputTokens: number; outputTokens: number }
export type GuiTaskStatus = "running" | "done" | "needs_review" | "needs_text" | "aborted" | "blocked" | "max_actions" | "max_decisions" | "timeout" | "no_progress" | "uncertain" | "error"
export type GuiTaskTrace = { step: number; stateId: string; fingerprint: string; candidateCount: number; decision?: JevDecision; action?: GuiTraceAction; outcome?: GuiActionResult["outcome"]; changed?: boolean; verification?: VerificationResult; note?: string }
export type GuiTaskResult = { status: GuiTaskStatus; actions: number; decisions: number; evidence: string; verification: VerificationResult; metrics: GuiTaskMetrics; trace: GuiTaskTrace[] }
export type GuiTaskEvent = { type: "observed" | "decided" | "acted" | "verified" | "status"; step: number; status: GuiTaskStatus; payload: Record<string, unknown> }

const SENSITIVE_FIELD = /密码|密钥|令牌|验证码|password|passwd|api[_ -]?key|secret|bearer|secure.?text|one.?time.?code/i
const FORBIDDEN_TARGET = /(?:^|\b)(?:orbit|codex|terminal|iterm|keychain|bitwarden|1password|password manager)(?:\b|$)/i

export function validateTaskInput(input: GuiTaskInput): void {
  if (input.version !== 1 || !input.goal?.trim() || !input.target || !input.completion || !input.scope || !Array.isArray(input.completion.requiredText)) throw new Error("Invalid GUI task contract")
  if (!['browser', 'desktop'].includes(input.target.kind)) throw new Error("Invalid GUI task target")
  if (!['explicit', 'observed_low_risk'].includes(input.scope.mode)) throw new Error("Invalid GUI action scope")
  if (input.target.kind === "browser") {
    if (!input.target.url || !input.target.allowedOrigins?.length) throw new Error("Browser tasks require target.url and target.allowedOrigins")
    const start = httpUrl(input.target.url)
    const origins = input.target.allowedOrigins.map(origin => httpUrl(origin).origin)
    if (!origins.includes(start.origin)) throw new Error("Browser start URL is outside target.allowedOrigins")
  }
  if (input.target.kind === "desktop" && (!input.target.app || FORBIDDEN_TARGET.test(input.target.app))) throw new Error("Desktop target is unavailable to Computer Use")
  if (!input.completion.requiredText.length && !input.completion.urlIncludes && !input.completion.titleIncludes && !input.completion.controls?.length) throw new Error("Completion requires at least one observable predicate")
  const { maxActions = 24, maxDecisions = 48, maxDurationMs = 60_000 } = input.budget ?? {}
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 64 || !Number.isInteger(maxDecisions) || maxDecisions < maxActions || maxDecisions > 128 || !Number.isInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 120_000) throw new Error("Invalid GUI task budget")
  const ids = new Set<string>()
  for (const slot of input.textSlots ?? []) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(slot.id) || ids.has(slot.id) || typeof slot.value !== "string" || slot.value.length > 10_000 || !slot.fieldLabel || SENSITIVE_FIELD.test(slot.fieldLabel)) throw new Error("Invalid text slot")
    ids.add(slot.id)
  }
}

function httpUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser tasks support only HTTP(S) URLs")
  return url
}

export function traceAction(action: GuiAction): GuiTraceAction {
  if (action.action === "setText") return { action: "setText", ref: action.ref, slotId: action.slotId }
  return action
}
