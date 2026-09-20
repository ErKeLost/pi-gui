import { verifyCompletion } from "./completion-verifier.ts"
import { traceAction, validateTaskInput, type GuiAction, type GuiObservation, type GuiTaskDriver, type GuiTaskEvent, type GuiTaskInput, type GuiTaskMetrics, type GuiTaskResult, type GuiTaskStatus, type GuiTaskTrace, type TextSlot, type VerificationResult } from "./gui-task-contract.ts"
import type { JevCandidate, JevDecision, JevOperation } from "./jev.ts"

export type { GuiAction, GuiActionResult, GuiObservation, GuiTaskDriver, GuiTaskEvent, GuiTaskInput, GuiTaskResult, GuiTaskStatus, GuiTaskTrace, VerificationResult } from "./gui-task-contract.ts"
type Decide = (goal: string, candidates: JevCandidate[], context: string, history: string[], signal?: AbortSignal) => Promise<JevDecision>

const DEFAULT_MAX_ACTIONS = 24
const DEFAULT_MAX_DECISIONS = 48
const DEFAULT_MAX_DURATION_MS = 60_000
const MAX_NO_PROGRESS = 3
const MAX_STALE_DECISIONS = 3
const MIN_OPERATION_CONFIDENCE = 0.65
const MIN_TARGET_CONFIDENCE = 0.7

export async function runGuiTaskEngine({ input, driver, decide, signal, emit = () => undefined }: { input: GuiTaskInput; driver: GuiTaskDriver; decide: Decide; signal?: AbortSignal; emit?: (event: GuiTaskEvent) => void }): Promise<GuiTaskResult> {
  validateTaskInput(input)
  const maxActions = input.budget?.maxActions ?? DEFAULT_MAX_ACTIONS
  const maxDecisions = input.budget?.maxDecisions ?? DEFAULT_MAX_DECISIONS
  const startedAt = Date.now()
  const deadline = startedAt + (input.budget?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS)
  const metrics: GuiTaskMetrics = { elapsedMs: 0, observationMs: 0, decisionMs: 0, actionMs: 0, waits: 0, staleDecisions: 0, inputTokens: 0, outputTokens: 0 }
  const trace: GuiTaskTrace[] = []
  const history: string[] = []
  let observation = await measure(metrics, "observationMs", () => driver.start(input))
  let actions = 0
  let decisions = 0
  let noProgress = 0
  let staleDecisions = 0
  let verification = verifyCompletion(observation, input.completion)
  const complete = (status: GuiTaskStatus, note?: string) => finish(status, actions, decisions, observation, verification, metrics, startedAt, trace, note)
  emit({ type: "observed", step: 0, status: "running", payload: { fingerprint: observation.fingerprint, candidateCount: observation.candidates.length } })
  if (verification.passed) return complete("done")

  while (actions < maxActions && decisions < maxDecisions) {
    if (signal?.aborted) return complete("aborted")
    if (Date.now() >= deadline) return complete("timeout")
    if (observation.deferred > 0 && observation.candidates.length === 0) return complete("needs_review", "The only matching controls require explicit review.")
    if (observation.candidates.length === 0) return complete("blocked", "No permitted controls are visible.")

    decisions++
    const entry: GuiTaskTrace = { step: decisions, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: observation.candidates.length }
    trace.push(entry)
    let decision: JevDecision
    try {
      decision = await measure(metrics, "decisionMs", () => decide(input.goal, observation.candidates, observation.context, history, signal))
    } catch (error) {
      entry.note = safeError(error)
      return complete("error")
    }
    entry.decision = decision
    metrics.inputTokens += decision.usage?.inputTokens ?? 0
    metrics.outputTokens += decision.usage?.outputTokens ?? 0
    emit({ type: "decided", step: decisions, status: "running", payload: { operation: decision.operation, targetId: decision.targetId, confidence: decision.confidence, targetConfidence: decision.targetConfidence, model: decision.model, latencyMs: decision.latencyMs } })

    if ((decision.confidence ?? 0) < MIN_OPERATION_CONFIDENCE || (decision.targetId && (decision.targetConfidence ?? 0) < MIN_TARGET_CONFIDENCE)) return complete("uncertain", "Jev confidence is below the execution threshold.")
    if (decision.operation === "DONE") return complete("blocked", "Jev requested completion before the local verifier passed.")
    if (decision.operation === "BLOCKED") return complete("blocked")
    if (decision.operation === "WAIT") {
      try {
        staleDecisions = 0
        metrics.waits++
        const next = await measure(metrics, "observationMs", () => driver.refresh(observation))
        const changed = next.fingerprint !== observation.fingerprint
        entry.changed = changed
        entry.note = "wait"
        history.push(`WAIT changed=${changed}`)
        observation = next
        verification = verifyCompletion(observation, input.completion)
        emit({ type: "verified", step: decisions, status: verification.passed ? "done" : "running", payload: verification })
        if (verification.passed) return complete("done")
        noProgress = changed ? 0 : noProgress + 1
        if (noProgress >= MAX_NO_PROGRESS) return complete("no_progress")
        continue
      } catch (error) {
        entry.note = safeError(error)
        return complete("error")
      }
    }

    const candidate = observation.candidates.find(item => item.id === decision.targetId)
    if (!candidate) return complete("uncertain", "Jev selected a target outside the current observation.")
    const action = toAction(decision.operation, candidate, input.textSlots ?? [])
    if (action === "needs_text") return complete("needs_text")
    if (!action) return complete("blocked", `Unsupported operation: ${decision.operation}`)
    entry.action = traceAction(action)

    let acted
    try {
      acted = await measure(metrics, "actionMs", () => driver.act(observation, action))
    } catch (error) {
      entry.note = safeError(error)
      actions++
      return complete("needs_review", "The action may have started; inspect current UI before continuing.")
    }
    const changed = acted.observation.fingerprint !== observation.fingerprint
    entry.outcome = acted.outcome
    entry.changed = changed
    emit({ type: "acted", step: decisions, status: "running", payload: { action: action.action, targetId: candidate.id, outcome: acted.outcome, changed } })
    history.push(`${decision.operation} ${candidate.id}: outcome=${acted.outcome}; changed=${changed}`)
    observation = acted.observation
    verification = verifyCompletion(observation, input.completion)
    entry.verification = verification
    emit({ type: "verified", step: decisions, status: verification.passed ? "done" : "running", payload: verification })
    if (acted.outcome === "stale") {
      staleDecisions++
      metrics.staleDecisions++
      if (verification.passed) return complete("done")
      if (staleDecisions >= MAX_STALE_DECISIONS) return complete("needs_review", "The UI changed before three consecutive actions; inspect the current state.")
      continue
    }
    staleDecisions = 0
    actions++
    if (verification.passed) return complete("done")
    if (acted.outcome === "unknown" && !changed) return complete("needs_review", "The action outcome is unknown; the mutation will not be replayed.")
    if (Date.now() >= deadline) return complete("timeout")
    noProgress = changed ? 0 : noProgress + 1
    if (noProgress >= MAX_NO_PROGRESS) return complete("no_progress")
  }
  return complete(actions >= maxActions ? "max_actions" : "max_decisions")
}

function toAction(operation: JevOperation | null, candidate: JevCandidate, slots: TextSlot[]): GuiAction | "needs_text" | null {
  if (operation === "CLICK") return { action: "press", ref: candidate.ref }
  if (operation === "SCROLL_UP") return { action: "scroll", ref: candidate.ref, scrollY: -500 }
  if (operation === "SCROLL_DOWN") return { action: "scroll", ref: candidate.ref, scrollY: 500 }
  if (operation === "TYPE_TEXT") {
    const slot = slots.find(item => item.id === candidate.slotId)
    return slot ? { action: "setText", ref: candidate.ref, text: slot.value, slotId: slot.id } : "needs_text"
  }
  return null
}

function finish(status: GuiTaskStatus, actions: number, decisions: number, observation: GuiObservation, verification: VerificationResult, metrics: GuiTaskMetrics, startedAt: number, trace: GuiTaskTrace[], note?: string): GuiTaskResult {
  if (note) trace.push({ step: decisions, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, note })
  const measured = { ...metrics, elapsedMs: Math.max(0, Date.now() - startedAt), observationMs: Math.round(metrics.observationMs), decisionMs: Math.round(metrics.decisionMs), actionMs: Math.round(metrics.actionMs) }
  return { status, actions, decisions, evidence: observation.context.slice(0, 2_000), verification, metrics: measured, trace }
}

async function measure<T>(metrics: GuiTaskMetrics, phase: "observationMs" | "decisionMs" | "actionMs", operation: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try { return await operation() }
  finally { metrics[phase] += Math.max(0, performance.now() - started) }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:sk-|ts_|tsp_)[A-Za-z0-9_-]{12,}\b/g, "[credential removed]")
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]")
    .slice(0, 240)
}
