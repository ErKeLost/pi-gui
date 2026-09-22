import type { JevCandidate, JevDecision } from "./jev.ts"

export type TextSlot = { id: string; value: string; description: string }
export type TaskTarget = {
  kind: "desktop"
  app: string
  windowTitle?: string
  activation: "background" | "foreground"
  launch?: { timeoutMs: number }
}
export type ControlCondition = { label: string; role?: string; present?: boolean; checked?: boolean; selected?: boolean; valueEquals?: string; valueIncludes?: string }
export type ControlSnapshot = { label: string; role: string; value?: string; checked?: boolean; selected?: boolean }
export type MediaPlaybackCondition = { sampleIntervalMs: number; minAdvanceSeconds: number }
export type CompletionSpec = { appReady?: true; requiredText?: string[]; requiredSlots?: string[]; forbiddenText?: string[]; urlIncludes?: string; titleIncludes?: string; controls?: ControlCondition[]; mediaPlayback?: MediaPlaybackCondition }
export type GuiStepExpectation = Omit<CompletionSpec, "mediaPlayback" | "appReady"> & {
  collectionItemsAtLeast?: number
  mediaTrackPresent?: boolean
  fillableSlots?: string[]
  collectionChanged?: true
  titleChanged?: true
  urlChanged?: true
}
export type ActionScope = { allow: ("click" | "type_text" | "scroll")[]; scrollDeltas?: number[] }
export type ExecutionBudget = { maxActions: number; maxDecisions: number; maxDurationMs: number }
export type GuiTaskStep =
  | { id: string; kind: "fill"; purpose: string; slotId: string }
  | { id: string; kind: "activate"; purpose: string; afterSlotId?: string; expect: GuiStepExpectation; skipIf?: GuiStepExpectation }
  | { id: string; kind: "select"; purpose: string; index: number; order: "reading"; expect?: GuiStepExpectation; skipIf?: GuiStepExpectation }
  | { id: string; kind: "choose"; purpose: string; action: "click" | "scroll"; expect: GuiStepExpectation; skipIf?: GuiStepExpectation }
export type GuiTaskInput = { goal: string; target: TaskTarget; steps: GuiTaskStep[]; completion: CompletionSpec; scope: ActionScope; textSlots?: TextSlot[]; budget: ExecutionBudget }
export type GuiCollection = { id: string; label: string; order: "reading"; size: number; items: { candidateId: string; ordinal: number }[] }

export type GuiAction =
  | { action: "click"; target: JevCandidate["target"] }
  | { action: "typeText"; target: JevCandidate["target"]; text: string; slotId: string }
  | { action: "scroll"; target: JevCandidate["target"]; scrollY: number }

export type GuiTraceAction =
  | { action: "click"; target: JevCandidate["target"] }
  | { action: "typeText"; target: JevCandidate["target"]; slotId: string }
  | { action: "scroll"; target: JevCandidate["target"]; scrollY: number }

export type GuiObservation = {
  stateId: string
  rootRef: string
  title: string
  url: string
  controls: ControlSnapshot[]
  candidates: JevCandidate[]
  collections: GuiCollection[]
  candidateStats: { accessibility: number; visual: number }
  capturedAt: number
  mediaTracks: Record<string, number>
  presentSlotIds: string[]
  deferred: number
  context: string
  verificationContext: string
  fingerprint: string
  targetReady?: boolean
  targetResolution?: GuiTargetResolution
}

export type GuiActionResult = { observation: GuiObservation; outcome: "worked" | "didnt" | "unknown"; textDelivery?: "verified" | "unverified" }
export interface GuiTaskDriver {
  start(input: GuiTaskInput): Promise<GuiObservation>
  refresh(observation: GuiObservation): Promise<GuiObservation>
  act(observation: GuiObservation, action: GuiAction): Promise<GuiActionResult>
}

export type VerificationResult = { passed: boolean; reasons: string[]; needsMediaSample?: boolean }
export type GuiTargetResolution = { strategy: "exact" | "semantic"; decisions: number; models: string[]; confidence?: number; latencyMs: number; inputTokens: number; outputTokens: number }
export type GuiTaskMetrics = { elapsedMs: number; targetResolutionMs: number; targetDecisions: number; observationMs: number; decisionMs: number; actionMs: number; waits: number; inputTokens: number; outputTokens: number }
export type GuiTaskStatus = "running" | "done" | "needs_review" | "needs_text" | "aborted" | "blocked" | "max_actions" | "max_decisions" | "timeout" | "uncertain" | "error"
export type GuiTaskTrace = { step: number; phaseId?: string; phaseKind?: GuiTaskStep["kind"]; stateId: string; fingerprint: string; candidateCount: number; decision?: JevDecision; candidate?: { id: string; action: string; source: JevCandidate["target"]["kind"]; role: string; label: string; collection?: JevCandidate["collection"]; selectedItemLabel?: string }; action?: GuiTraceAction; outcome?: GuiActionResult["outcome"]; changed?: boolean; verification?: VerificationResult; note?: string }
export type GuiTaskResult = { status: GuiTaskStatus; actions: number; decisions: number; targetResolution?: GuiTargetResolution; evidence: string; verification: VerificationResult; metrics: GuiTaskMetrics; trace: GuiTaskTrace[] }
export type GuiTaskEvent = { type: "observed" | "decided" | "acted" | "verified" | "status"; step: number; status: GuiTaskStatus; payload: Record<string, unknown> }

export function validateTaskInput(input: GuiTaskInput): void {
  if (!input.goal?.trim() || !input.target || !input.completion || !input.scope || !input.budget || !Array.isArray(input.steps)) throw new Error("Invalid GUI task contract")
  if (input.target.kind !== "desktop" || !input.target.app) throw new Error("GUI tasks require a desktop app target")
  if (!['background', 'foreground'].includes(input.target.activation)) throw new Error("Desktop targets require an explicit activation posture")
  if (input.target.launch && (!Number.isInteger(input.target.launch.timeoutMs) || input.target.launch.timeoutMs < 1)) throw new Error("Invalid desktop launch timeout")
  if (input.completion.requiredText && !Array.isArray(input.completion.requiredText)) throw new Error("Invalid required text predicates")
  if (!input.completion.appReady && !input.completion.requiredText?.length && !input.completion.requiredSlots?.length && !input.completion.urlIncludes && !input.completion.titleIncludes && !input.completion.controls?.length && !input.completion.mediaPlayback) throw new Error("Completion requires at least one observable predicate")
  if (input.completion.mediaPlayback && (!Number.isInteger(input.completion.mediaPlayback.sampleIntervalMs) || input.completion.mediaPlayback.sampleIntervalMs < 1 || !Number.isFinite(input.completion.mediaPlayback.minAdvanceSeconds) || input.completion.mediaPlayback.minAdvanceSeconds <= 0)) throw new Error("Invalid media playback predicate")
  const { maxActions, maxDecisions, maxDurationMs } = input.budget
  if (!Number.isInteger(maxActions) || maxActions < 1 || !Number.isInteger(maxDecisions) || maxDecisions < 1 || !Number.isInteger(maxDurationMs) || maxDurationMs < 1) throw new Error("Invalid GUI task budget")
  if (input.target.launch && input.target.launch.timeoutMs > maxDurationMs) throw new Error("Desktop launch timeout exceeds the task duration budget")
  const ids = new Set<string>()
  for (const slot of input.textSlots ?? []) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(slot.id) || ids.has(slot.id) || typeof slot.value !== "string" || slot.value.length > 10_000 || !slot.description) throw new Error("Invalid text slot")
    ids.add(slot.id)
  }
  if ((input.completion.requiredSlots ?? []).some(id => !ids.has(id))) throw new Error("Completion references an unknown text slot")
  if (!Array.isArray(input.scope.allow) || input.scope.allow.some(action => !["click", "type_text", "scroll"].includes(action))) throw new Error("Invalid action scope")
  if ((input.scope.scrollDeltas ?? []).some(delta => !Number.isFinite(delta) || delta === 0)) throw new Error("Invalid scroll delta")
  const stepIds = new Set<string>()
  const priorFillSlots = new Set<string>()
  for (const [stepIndex, step] of input.steps.entries()) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(step.id) || stepIds.has(step.id) || !step.purpose?.trim() || !["fill", "activate", "select", "choose"].includes(step.kind)) throw new Error("Invalid GUI task step")
    stepIds.add(step.id)
    if (step.kind === "fill" && (!ids.has(step.slotId) || !input.scope.allow.includes("type_text"))) throw new Error("Fill step is not backed by an authorized text slot action")
    if (step.kind === "fill") priorFillSlots.add(step.slotId)
    if (step.kind === "activate" && ((step.afterSlotId && !priorFillSlots.has(step.afterSlotId)) || !input.scope.allow.includes("click"))) throw new Error("Activate step is not backed by a prior fill and authorized click action")
    if (step.kind === "select" && (!Number.isInteger(step.index) || step.index < 1 || step.order !== "reading" || !input.scope.allow.includes("click"))) throw new Error("Invalid collection selection step")
    if (step.kind === "choose" && (!["click", "scroll"].includes(step.action) || !input.scope.allow.includes(step.action))) throw new Error("Invalid choose step action")
    if ((step.kind === "activate" || step.kind === "choose") && !validStepExpectation(step.expect, ids)) throw new Error(`${step.kind} step requires an observable postcondition`)
    if (step.kind === "select" && stepIndex < input.steps.length - 1 && !validStepExpectation(step.expect, ids)) throw new Error("A non-terminal select step requires an observable postcondition")
    if (step.kind === "select" && step.expect && !validStepExpectation(step.expect, ids)) throw new Error("Invalid select step postcondition")
    if (step.kind === "select" && step.expect?.mediaTrackPresent !== undefined) throw new Error("Select steps must prove playback through the final mediaPlayback completion predicate")
    if (step.kind !== "fill" && step.skipIf && (!validStepExpectation(step.skipIf, ids) || hasTransitionExpectation(step.skipIf))) throw new Error("Invalid step skip condition")
    const next = input.steps[stepIndex + 1]
    if (step.kind === "choose" && step.action === "click" && next?.kind === "fill") {
      const expected = step.expect.fillableSlots?.includes(next.slotId)
      const skippable = step.skipIf?.fillableSlots?.includes(next.slotId)
      if (!expected || !skippable) throw new Error("A click phase before fill must explicitly reveal that slot and skip itself when the slot is already fillable")
    }
  }
  const requiredSlots = new Set(input.completion.requiredSlots ?? [])
  for (const step of input.steps) if (step.kind === "fill" && !requiredSlots.has(step.slotId)) throw new Error("Every fill step must be included in completion.requiredSlots")
}

function validStepExpectation(expectation: GuiStepExpectation | undefined, slotIds: Set<string>): boolean {
  if (!expectation) return false
  if ((expectation.requiredSlots ?? []).some(id => !slotIds.has(id))) return false
  if ((expectation.fillableSlots ?? []).some(id => !slotIds.has(id))) return false
  if (expectation.collectionItemsAtLeast !== undefined && (!Number.isInteger(expectation.collectionItemsAtLeast) || expectation.collectionItemsAtLeast < 1)) return false
  return Boolean(expectation.requiredText?.length || expectation.requiredSlots?.length || expectation.urlIncludes || expectation.titleIncludes || expectation.controls?.length || expectation.collectionItemsAtLeast || expectation.mediaTrackPresent !== undefined || expectation.fillableSlots?.length || hasTransitionExpectation(expectation))
}

function hasTransitionExpectation(expectation: GuiStepExpectation): boolean {
  return expectation.collectionChanged === true || expectation.titleChanged === true || expectation.urlChanged === true
}

export function traceAction(action: GuiAction): GuiTraceAction {
  if (action.action === "typeText") return { action: "typeText", target: action.target, slotId: action.slotId }
  return action
}
