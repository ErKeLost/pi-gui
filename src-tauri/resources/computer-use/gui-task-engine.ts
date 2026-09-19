import type { JevCandidate, JevDecision } from "./jev.ts"

export type GuiTaskInput = { goal: string; url?: string; app?: string; text?: string; maxSteps?: number }
export type GuiAction =
  | { action: "press"; ref: string }
  | { action: "setText"; ref: string; text: string }
  | { action: "scroll"; ref: string; scrollY: number }
export type GuiObservation = { stateId: string; rootRef: string; candidates: JevCandidate[]; context: string; fingerprint: string }
export type GuiActionResult = { observation: GuiObservation; outcome: "worked" | "didnt" | "unknown" }
export interface GuiTaskDriver {
  start(input: GuiTaskInput): Promise<GuiObservation>
  refresh(observation: GuiObservation): Promise<GuiObservation>
  act(observation: GuiObservation, action: GuiAction): Promise<GuiActionResult>
}
export type GuiTaskStatus = "done" | "confirm" | "needs_text" | "aborted" | "blocked" | "max_steps" | "no_progress" | "error"
export type GuiTaskTrace = { step: number; stateId: string; fingerprint: string; candidateCount: number; decision?: JevDecision; action?: GuiAction; outcome?: GuiActionResult["outcome"]; changed?: boolean; note?: string }
export type GuiTaskResult = { status: GuiTaskStatus; steps: number; evidence: string; trace: GuiTaskTrace[] }
type Decide = (goal: string, app: string, candidates: JevCandidate[], context: string, history: string[], signal?: AbortSignal) => Promise<JevDecision>

const DEFAULT_MAX_STEPS = 12
const MAX_NO_PROGRESS = 3

export async function runGuiTaskEngine({ input, driver, decide, signal, emit = () => undefined }: {
  input: GuiTaskInput
  driver: GuiTaskDriver
  decide: Decide
  signal?: AbortSignal
  emit?: (line: string) => void
}): Promise<GuiTaskResult> {
  const maxSteps = Math.min(16, Math.max(1, input.maxSteps ?? DEFAULT_MAX_STEPS))
  const app = input.url ? "browser" : (input.app || "desktop")
  const trace: GuiTaskTrace[] = []
  const history: string[] = []
  let observation = await driver.start(input)
  let noProgress = 0

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) return finish("aborted", step - 1, observation, trace)
    if (observation.candidates.length === 0) return finish("blocked", step - 1, observation, trace, "No actionable controls are visible.")

    const decision = await decide(input.goal, app, observation.candidates, observation.context, history, signal)
    const entry: GuiTaskTrace = { step, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, decision }
    trace.push(entry)
    emit(`step ${step}: Jev ${decision.latencyMs}ms action=${decision.action ?? "?"} ${decision.ref ?? "—"} conf=${fmt(decision.confidence)} risk=${fmt(decision.risk)} done=${fmt(decision.done)}`)

    if ((decision.risk ?? 0) >= 0.2) return finish("confirm", step - 1, observation, trace)
    if (decision.action === "done") {
      return (decision.done ?? 0) >= 0.9
        ? finish("done", step - 1, observation, trace)
        : finish("blocked", step - 1, observation, trace, "Jev completion signals disagreed.")
    }
    if (decision.action === "blocked") return finish("blocked", step - 1, observation, trace)
    if (decision.action === "wait") {
      const next = await driver.refresh(observation)
      const changed = next.fingerprint !== observation.fingerprint
      entry.changed = changed
      entry.note = "wait"
      noProgress = changed ? 0 : noProgress + 1
      history.push(`wait: page_changed=${changed}`)
      observation = next
      if (noProgress >= MAX_NO_PROGRESS) return finish("no_progress", step, observation, trace)
      continue
    }
    if (!decision.action || !decision.ref || (decision.confidence ?? 0) < 0.4) return finish("blocked", step - 1, observation, trace, "Jev did not return a safe actionable target.")

    const action = toAction(decision, input.text)
    if (action === "needs_text") return finish("needs_text", step - 1, observation, trace)
    if (!action) return finish("blocked", step - 1, observation, trace, `Unsupported Jev action: ${decision.action}`)
    entry.action = action

    const acted = await driver.act(observation, action)
    const changed = acted.observation.fingerprint !== observation.fingerprint
    entry.outcome = acted.outcome
    entry.changed = changed
    emit(`step ${step}: outcome=${acted.outcome} page_changed=${changed}`)
    history.push(`${decision.action} ${decision.label ?? decision.ref}: outcome=${acted.outcome}; page_changed=${changed}`)

    // Successor state is authoritative. Never replay an uncertain action.
    noProgress = changed ? 0 : noProgress + 1
    observation = acted.observation
    if (noProgress >= MAX_NO_PROGRESS) return finish("no_progress", step, observation, trace)
  }
  return finish("max_steps", maxSteps, observation, trace)
}

function toAction(decision: JevDecision, text?: string): GuiAction | "needs_text" | null {
  if (!decision.ref) return null
  if (decision.action === "press") return { action: "press", ref: decision.ref }
  if (decision.action === "scroll") return { action: "scroll", ref: decision.ref, scrollY: 400 }
  if (decision.action === "set_value") return text === undefined ? "needs_text" : { action: "setText", ref: decision.ref, text }
  return null
}

function finish(status: GuiTaskStatus, steps: number, observation: GuiObservation, trace: GuiTaskTrace[], note?: string): GuiTaskResult {
  if (note) trace.push({ step: steps, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, note })
  return { status, steps, evidence: observation.context.slice(0, 2_000), trace }
}

const fmt = (value: number | null) => typeof value === "number" ? value.toFixed(2) : "n/a"
