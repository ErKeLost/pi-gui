import { verifyCompletion } from "./completion-verifier.ts"
import { traceAction, validateTaskInput, type GuiAction, type GuiObservation, type GuiStepExpectation, type GuiTaskDriver, type GuiTaskEvent, type GuiTaskInput, type GuiTaskMetrics, type GuiTaskResult, type GuiTaskStatus, type GuiTaskStep, type GuiTaskTrace, type TextSlot, type VerificationResult } from "./gui-task-contract.ts"
import { operationForCandidate, type JevCandidate, type JevDecision, type JevDecisionOptions, type JevOperation } from "./jev.ts"

export type { GuiAction, GuiActionResult, GuiObservation, GuiTaskDriver, GuiTaskEvent, GuiTaskInput, GuiTaskResult, GuiTaskStatus, GuiTaskTrace, VerificationResult } from "./gui-task-contract.ts"
type Decide = (goal: string, candidates: JevCandidate[], context: string, history: string[], signal?: AbortSignal, options?: JevDecisionOptions) => Promise<JevDecision>

export async function runGuiTaskEngine({ input, driver, decide, signal, emit = () => undefined }: { input: GuiTaskInput; driver: GuiTaskDriver; decide: Decide; signal?: AbortSignal; emit?: (event: GuiTaskEvent) => void }): Promise<GuiTaskResult> {
  validateTaskInput(input)
  const { maxActions, maxDecisions, maxDurationMs } = input.budget
  const startedAt = Date.now()
  const deadline = startedAt + maxDurationMs
  const metrics: GuiTaskMetrics = { elapsedMs: 0, targetResolutionMs: 0, targetDecisions: 0, observationMs: 0, decisionMs: 0, actionMs: 0, waits: 0, inputTokens: 0, outputTokens: 0 }
  const trace: GuiTaskTrace[] = []
  const history: string[] = []
  const attemptedCandidates = new Set<string>()
  let observation = await measure(metrics, "observationMs", () => driver.start(input))
  if (observation.targetResolution) {
    metrics.targetResolutionMs = observation.targetResolution.latencyMs
    metrics.targetDecisions = observation.targetResolution.decisions
    metrics.observationMs = Math.max(0, metrics.observationMs - observation.targetResolution.latencyMs)
    metrics.inputTokens += observation.targetResolution.inputTokens
    metrics.outputTokens += observation.targetResolution.outputTokens
  }
  let actions = 0
  let decisions = 0
  let phaseIndex = 0
  const satisfiedSlots = new Set(observation.presentSlotIds)
  const deliveredSlots = new Set<string>()
  const fieldBySlot = new Map<string, string>()
  const excludedMediaTracks = new Set<string>()
  let finalStepBarrierEstablished = false
  let slotBarrierEstablished = false
  const establishSlotBarrier = () => {
    const requiredSlots = input.completion.requiredSlots ?? []
    if (slotBarrierEstablished || requiredSlots.length === 0 || !requiredSlots.every(id => satisfiedSlots.has(id))) return
    slotBarrierEstablished = true
    for (const ref of Object.keys(observation.mediaTracks)) excludedMediaTracks.add(ref)
  }
  const establishFinalStepBarrier = () => {
    if (finalStepBarrierEstablished || phaseIndex !== input.steps.length - 1) return
    finalStepBarrierEstablished = true
    for (const ref of Object.keys(observation.mediaTracks)) excludedMediaTracks.add(ref)
  }
  const setPhaseIndex = (next: number) => {
    if (next === phaseIndex) return
    phaseIndex = next
    attemptedCandidates.clear()
    establishFinalStepBarrier()
  }
  const advanceSatisfiedSteps = () => {
    while (phaseIndex < input.steps.length) {
      const step = input.steps[phaseIndex]
      const satisfied = step.kind === "fill"
        ? satisfiedSlots.has(step.slotId)
        : Boolean(step.skipIf && stepExpectationSatisfied(step.skipIf, observation, satisfiedSlots))
      if (!satisfied) break
      setPhaseIndex(phaseIndex + 1)
    }
  }
  establishFinalStepBarrier()
  establishSlotBarrier()
  advanceSatisfiedSteps()
  let verification = verifyCompletion(observation, input.completion, undefined, satisfiedSlots, excludedMediaTracks)
  const complete = (status: GuiTaskStatus, note?: string) => finish(status, actions, decisions, observation, verification, metrics, startedAt, trace, note)
  const sampleCompletion = async (step: number) => {
    if (!verification.needsMediaSample || !input.completion.mediaPlayback) return
    const previous = observation
    await abortableDelay(input.completion.mediaPlayback.sampleIntervalMs, signal)
    metrics.waits++
    observation = await measure(metrics, "observationMs", () => driver.refresh(previous))
    for (const id of observation.presentSlotIds) satisfiedSlots.add(id)
    establishSlotBarrier()
    advanceSatisfiedSteps()
    emit({ type: "observed", step, status: "running", payload: { fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, ...observation.candidateStats } })
    verification = verifyCompletion(observation, input.completion, previous, satisfiedSlots, excludedMediaTracks)
  }
  emit({ type: "observed", step: 0, status: "running", payload: { fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, targetResolution: observation.targetResolution, ...observation.candidateStats } })
  if (signal?.aborted) return complete("aborted")
  if (verification.passed) return complete("done")
  if (phaseIndex >= input.steps.length) {
    await sampleCompletion(0)
    return verification.passed ? complete("done") : complete("blocked", "The typed plan is complete, but its completion predicate is not satisfied.")
  }

  while (actions < maxActions && decisions < maxDecisions) {
    if (signal?.aborted) return complete("aborted")
    if (Date.now() >= deadline) return complete("timeout")

    advanceSatisfiedSteps()
    if (phaseIndex >= input.steps.length) {
      verification = verifyCompletion(observation, input.completion, undefined, satisfiedSlots, excludedMediaTracks)
      await sampleCompletion(decisions)
      return verification.passed ? complete("done") : complete("blocked", "The typed plan is complete, but its completion predicate is not satisfied.")
    }
    establishFinalStepBarrier()
    const phase = input.steps[phaseIndex]
    if (phase.kind !== "fill" && phase.expect && stepExpectationSatisfied(phase.expect, observation, satisfiedSlots)) return complete("blocked", `Typed plan phase has a postcondition that is already satisfied; use skipIf or a transition expectation: ${phase.id}`)
    const phaseCandidates = candidatesForPhase(phase, observation, fieldBySlot).filter(candidate => !attemptedCandidates.has(candidateSignature(candidate)))

    decisions++
    const entry: GuiTaskTrace = { step: decisions, phaseId: phase.id, phaseKind: phase.kind, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: phaseCandidates.length }
    trace.push(entry)
    let decision: JevDecision
    try {
      const privateValues = (input.textSlots ?? []).map(slot => slot.value)
      const overallGoal = redactLocalValues(input.goal, privateValues)
      const decisionContext = redactLocalValues(observation.context, privateValues)
      const decisionCandidates = phaseCandidates.map(candidate => ({ ...candidate, label: redactLocalValues(candidate.label, privateValues) }))
      const decisionGoal = phaseGoal(phase, overallGoal)
      decision = await measure(metrics, "decisionMs", () => decide(decisionGoal, decisionCandidates, decisionContext, history, signal, { allowReobserve: decisionCandidates.length === 0 }))
    } catch (error) {
      if (signal?.aborted) return complete("aborted")
      entry.note = safeError(error)
      return complete("error")
    }
    entry.decision = decision
    metrics.inputTokens += decision.usage?.inputTokens ?? 0
    metrics.outputTokens += decision.usage?.outputTokens ?? 0
    emit({ type: "decided", step: decisions, status: "running", payload: { phaseId: phase.id, phaseKind: phase.kind, operation: decision.operation, candidateId: decision.candidateId, confidence: decision.confidence, model: decision.model, latencyMs: decision.latencyMs } })

    if (decision.operation === "BLOCKED") return complete("blocked", `Typed plan phase could not advance: ${phase.id}`)
    if (decision.operation === "WAIT") {
      try {
        metrics.waits++
        const next = await measure(metrics, "observationMs", () => driver.refresh(observation))
        const changed = next.fingerprint !== observation.fingerprint
        entry.changed = changed
        entry.note = "wait"
        history.push(`WAIT changed=${changed}`)
        observation = next
        for (const id of observation.presentSlotIds) satisfiedSlots.add(id)
        establishSlotBarrier()
        advanceSatisfiedSteps()
        emit({ type: "observed", step: decisions, status: "running", payload: { fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, ...observation.candidateStats } })
        verification = verifyCompletion(observation, input.completion, undefined, satisfiedSlots, excludedMediaTracks)
        if (phaseIndex >= input.steps.length) await sampleCompletion(decisions)
        emit({ type: "verified", step: decisions, status: phaseIndex >= input.steps.length && verification.passed ? "done" : "running", payload: verification })
        if (verification.passed) return complete("done")
        continue
      } catch (error) {
        if (signal?.aborted) return complete("aborted")
        entry.note = safeError(error)
        return complete("error")
      }
    }

    const candidate = phaseCandidates.find(item => item.id === decision.candidateId)
    if (!candidate) return complete("uncertain", "Jev selected a candidate outside the current observation.")
    entry.candidate = { id: candidate.id, action: candidate.action, source: candidate.target.kind, role: candidate.role, label: candidate.label, collection: candidate.collection, selectedItemLabel: candidate.selectedItemLabel }
    if (operationForCandidate(candidate) !== decision.operation) return complete("uncertain", "Jev selected an operation that does not match the local candidate.")
    if (candidate.target.kind === "point" && candidate.target.captureId !== observation.stateId) return complete("uncertain", "Jev selected a visual candidate from a stale capture.")
    const action = toAction(decision.operation, candidate, input.textSlots ?? [])
    if (action === "needs_text") return complete("needs_text")
    if (!action) return complete("blocked", `Unsupported operation: ${decision.operation}`)
    entry.action = traceAction(action)
    attemptedCandidates.add(candidateSignature(candidate))

    let acted
    const beforeActionObservation = observation
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
    emit({ type: "acted", step: decisions, status: "running", payload: { phaseId: phase.id, phaseKind: phase.kind, action: action.action, candidateId: candidate.id, outcome: acted.outcome, changed } })
    history.push(`${decision.operation} ${candidate.id}: outcome=${acted.outcome}; changed=${changed}`)
    observation = acted.observation
    for (const id of observation.presentSlotIds) satisfiedSlots.add(id)
    if (action.action === "typeText") {
      if (candidate.fieldKey) fieldBySlot.set(action.slotId, candidate.fieldKey)
      if (acted.textDelivery === "verified") satisfiedSlots.add(action.slotId)
      else if (acted.textDelivery === "unverified") deliveredSlots.add(action.slotId)
    }
    establishSlotBarrier()
    emit({ type: "observed", step: decisions, status: "running", payload: { fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, ...observation.candidateStats } })
    verification = verifyCompletion(observation, input.completion, undefined, satisfiedSlots, excludedMediaTracks)
    try {
      if (phaseIndex === input.steps.length - 1) await sampleCompletion(decisions)
    } catch (error) {
      if (signal?.aborted) return complete("aborted")
      entry.note = safeError(error)
      return complete("needs_review", "The action completed, but media verification could not obtain a second observation.")
    }
    entry.verification = verification
    const phaseSlots = new Set(satisfiedSlots)
    if (phase.kind === "activate" && phase.afterSlotId && deliveredSlots.has(phase.afterSlotId)) phaseSlots.add(phase.afterSlotId)
    const phaseProven = phase.kind === "fill"
      ? satisfiedSlots.has(phase.slotId) || deliveredSlots.has(phase.slotId)
      : Boolean(phase.expect && stepExpectationSatisfied(phase.expect, observation, phaseSlots, beforeActionObservation))
    if (phase.kind === "activate" && phaseProven && phase.afterSlotId && deliveredSlots.has(phase.afterSlotId)) {
      deliveredSlots.delete(phase.afterSlotId)
      satisfiedSlots.add(phase.afterSlotId)
      establishSlotBarrier()
      verification = verifyCompletion(observation, input.completion, undefined, satisfiedSlots, excludedMediaTracks)
      entry.verification = verification
    }
    if (verification.passed && phaseIndex === input.steps.length - 1) setPhaseIndex(input.steps.length)
    else if (phaseProven) setPhaseIndex(phaseIndex + 1)
    const planDone = phaseIndex >= input.steps.length
    emit({ type: "verified", step: decisions, status: planDone && verification.passed ? "done" : "running", payload: verification })
    actions++
    if (verification.passed) return complete("done")
    if (planDone) return verification.passed ? complete("done") : complete("blocked", "The typed plan is complete, but its completion predicate is not satisfied.")
    if (!phaseProven && acted.outcome !== "didnt") return complete("needs_review", changed
      ? "The action changed the UI but did not satisfy the current phase proof; no alternative mutation will be attempted."
      : "The action may have executed but did not satisfy the current phase proof; the mutation will not be replayed.")
    if (Date.now() >= deadline) return complete("timeout")
  }
  return complete(actions >= maxActions ? "max_actions" : "max_decisions")
}

function candidatesForPhase(phase: GuiTaskStep, observation: GuiObservation, fieldBySlot: ReadonlyMap<string, string>): JevCandidate[] {
  if (phase.kind === "fill") return observation.candidates.filter(candidate => candidate.action === "type_text" && candidate.slotId === phase.slotId)
  if (phase.kind === "activate") {
    const fieldRef = phase.afterSlotId ? fieldBySlot.get(phase.afterSlotId) : undefined
    return observation.candidates.filter(candidate => candidate.action === "click"
      && (!phase.afterSlotId || candidate.afterSlotIds?.includes(phase.afterSlotId))
      && (!fieldRef || candidate.afterFieldKeys?.includes(fieldRef)))
  }
  if (phase.kind === "select") {
    const candidatesById = new Map(observation.candidates.map(candidate => [candidate.id, candidate]))
    return observation.collections.flatMap(collection => {
      if (collection.order !== phase.order || collection.size < phase.index) return []
      const item = collection.items.find(candidate => candidate.ordinal === phase.index)
      const candidate = item ? candidatesById.get(item.candidateId) : undefined
      if (!candidate) return []
      return [{
        ...candidate,
        id: `select:${collection.id}:${phase.index}`,
        label: collection.label,
        collection: { id: collection.id, ordinal: phase.index, size: collection.size, order: collection.order },
        selectedItemLabel: candidate.label,
      }]
    })
  }
  return observation.candidates.filter(candidate => candidate.action === phase.action)
}

function phaseGoal(phase: GuiTaskStep, overallGoal: string): string {
  if (phase.kind === "fill") return `Typed plan phase ${phase.id}: fill the observed field matching this purpose with caller-prepared slot ${phase.slotId}: ${phase.purpose}. Overall goal: ${overallGoal}`
  if (phase.kind === "activate") return `Typed plan phase ${phase.id}: activate the observed control that performs this purpose${phase.afterSlotId ? ` and is structurally related to prepared slot ${phase.afterSlotId}` : ""}: ${phase.purpose}. Overall goal: ${overallGoal}`
  if (phase.kind === "select") return `Typed plan phase ${phase.id}: select locally grounded item ${phase.index} in ${phase.order} order from the collection matching this purpose: ${phase.purpose}. Overall goal: ${overallGoal}`
  return `Typed plan phase ${phase.id}: choose one ${phase.action} action for this purpose: ${phase.purpose}. Overall goal: ${overallGoal}`
}

function stepExpectationSatisfied(expectation: GuiStepExpectation, observation: GuiObservation, satisfiedSlots: ReadonlySet<string>, previous?: GuiObservation): boolean {
  const completion: Parameters<typeof verifyCompletion>[1] = {
    requiredText: expectation.requiredText,
    requiredSlots: expectation.requiredSlots,
    forbiddenText: expectation.forbiddenText,
    urlIncludes: expectation.urlIncludes,
    titleIncludes: expectation.titleIncludes,
    controls: expectation.controls,
  }
  if (!verifyCompletion(observation, completion, undefined, satisfiedSlots).passed) return false
  if (expectation.collectionItemsAtLeast !== undefined && !observation.collections.some(collection => collection.size >= expectation.collectionItemsAtLeast!)) return false
  if (expectation.mediaTrackPresent === true && Object.keys(observation.mediaTracks).length === 0) return false
  if (expectation.mediaTrackPresent === false && Object.keys(observation.mediaTracks).length > 0) return false
  if ((expectation.fillableSlots ?? []).some(slotId => !observation.presentSlotIds.includes(slotId) && !observation.candidates.some(candidate => candidate.action === "type_text" && candidate.slotId === slotId))) return false
  if (expectation.collectionChanged === true && (!previous || collectionState(previous) === collectionState(observation))) return false
  if (expectation.titleChanged === true && (!previous || previous.title === observation.title)) return false
  if (expectation.urlChanged === true && (!previous || previous.url === observation.url)) return false
  return true
}

function collectionState(observation: GuiObservation): string {
  const candidates = new Map(observation.candidates.map(candidate => [candidate.id, candidate]))
  return JSON.stringify(observation.collections.map(collection => ({
    label: collection.label,
    order: collection.order,
    size: collection.size,
    items: collection.items.map(item => ({ ordinal: item.ordinal, label: candidates.get(item.candidateId)?.label ?? "" })),
  })))
}

export function redactLocalValues(text: string, values: string[]): string {
  let redacted = text
  for (const value of [...new Set(values.filter(Boolean))].sort((left, right) => right.length - left.length)) redacted = redacted.split(value).join("[local slot]")
  return redacted
}

function toAction(operation: JevOperation, candidate: JevCandidate, slots: TextSlot[]): GuiAction | "needs_text" | null {
  if (operation === "CLICK") return { action: "click", target: candidate.target }
  if (operation === "SCROLL") return candidate.scrollY === undefined ? null : { action: "scroll", target: candidate.target, scrollY: candidate.scrollY }
  if (operation === "TYPE_TEXT") {
    const slot = slots.find(item => item.id === candidate.slotId)
    if (!slot) return "needs_text"
    return { action: "typeText", target: candidate.target, text: slot.value, slotId: slot.id }
  }
  return null
}

function finish(status: GuiTaskStatus, actions: number, decisions: number, observation: GuiObservation, verification: VerificationResult, metrics: GuiTaskMetrics, startedAt: number, trace: GuiTaskTrace[], note?: string): GuiTaskResult {
  if (note) trace.push({ step: decisions, stateId: observation.stateId, fingerprint: observation.fingerprint, candidateCount: observation.candidates.length, note })
  const measured = { ...metrics, elapsedMs: Math.max(0, Date.now() - startedAt), observationMs: Math.round(metrics.observationMs), decisionMs: Math.round(metrics.decisionMs), actionMs: Math.round(metrics.actionMs) }
  return { status, actions, decisions, targetResolution: observation.targetResolution, evidence: observation.context.slice(0, 2_000), verification, metrics: measured, trace }
}

async function measure<T>(metrics: GuiTaskMetrics, phase: "observationMs" | "decisionMs" | "actionMs", operation: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try { return await operation() }
  finally { metrics[phase] += Math.max(0, performance.now() - started) }
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("Operation aborted")
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(new Error("Operation aborted")) }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:sk-|ts_|tsp_)[A-Za-z0-9_-]{12,}\b/g, "[credential removed]")
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]")
    .slice(0, 240)
}

function candidateSignature(candidate: JevCandidate): string {
  return JSON.stringify({ action: candidate.action, role: candidate.role, label: candidate.label, slotId: candidate.slotId, fieldKey: candidate.fieldKey, afterSlotIds: candidate.afterSlotIds, afterFieldKeys: candidate.afterFieldKeys, collection: candidate.collection, scrollY: candidate.scrollY })
}
