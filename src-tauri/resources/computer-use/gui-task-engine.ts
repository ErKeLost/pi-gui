import { setTimeout as delay } from "node:timers/promises"
import { AgentDesktopCommandError, type AgentDesktopClient, type LaunchData } from "./agent-desktop-client.ts"
import { resolveDesktopApp } from "./desktop-app-resolver.ts"
import { observeDesktop } from "./desktop-observation.ts"
import { assessDesktopRisk, decideDesktop, redactLocalValues } from "./jev.ts"
import { validateTaskInput, type DesktopCandidate, type DesktopObservation, type GuiTaskEvent, type GuiTaskInput, type GuiTaskMetrics, type GuiTaskResult, type GuiTaskStatus, type GuiTaskTrace } from "./gui-task-contract.ts"

const CHROMIUM_RENDERER_SETTLE_MS = 2_000

export async function runGuiTaskEngine({
  input,
  client,
  signal,
  decide = decideDesktop,
  observe = observeDesktop,
  resolveApp = resolveDesktopApp,
  assessRisk = assessDesktopRisk,
  emit = () => undefined,
}: {
  input: GuiTaskInput
  client: AgentDesktopClient
  signal?: AbortSignal
  decide?: typeof decideDesktop
  observe?: typeof observeDesktop
  resolveApp?: typeof resolveDesktopApp
  assessRisk?: typeof assessDesktopRisk
  emit?: (event: GuiTaskEvent) => void
}): Promise<GuiTaskResult> {
  validateTaskInput(input)
  const startedAt = Date.now()
  const deadline = startedAt + input.budget.maxDurationMs
  const metrics: GuiTaskMetrics = { elapsedMs: 0, launchMs: 0, observationMs: 0, decisionMs: 0, actionMs: 0, inputTokens: 0, outputTokens: 0 }
  const trace: GuiTaskTrace[] = []
  const history: string[] = []
  const usedSlotIds = new Set<string>()
  let root: string | undefined
  let allowPressEnter = false
  let consecutiveWaits = 0
  let unchangedMutations = 0
  let pendingMutation: { before: string; entry: GuiTaskTrace; historyIndex: number } | undefined
  let actions = 0
  let decisions = 0

  const remaining = () => Math.max(1, deadline - Date.now())
  const finish = (status: GuiTaskStatus, observation?: DesktopObservation, note?: string): GuiTaskResult => {
    metrics.elapsedMs = Math.max(0, Date.now() - startedAt)
    if (note) trace.push({ step: decisions, stateId: observation?.fingerprint ?? "unobserved", note })
    return { status, actions, decisions, evidence: observation?.context.slice(0, 2_000) ?? "", metrics, trace }
  }
  if (signal?.aborted) return finish("aborted")
  emit({ type: "launching", step: 0, status: "running", payload: { app: input.target.app } })
  const launchStarted = performance.now()
  let launched: LaunchData
  try {
    const resolved = await resolveApp(input.target.app, signal)
    try {
      launched = (await client.run<LaunchData>(["launch", resolved.launchId, "--activate", "--timeout", String(remaining())], { timeoutMs: remaining(), signal })).data!
    } catch (error) {
      const expectedPid = error instanceof AgentDesktopCommandError && error.detail.code === "APP_UNRESPONSIVE"
        && error.detail.disposition?.delivery === "delivered_unverified"
        && error.detail.details && typeof error.detail.details === "object"
        ? (error.detail.details as { expected_pid?: unknown }).expected_pid
        : undefined
      if (typeof expectedPid !== "number") throw error
      // Electron-style apps can return a helper PID from NSWorkspace even
      // though the requested main app is already running and AX-addressable.
      launched = { app: resolved.displayName, pid: expectedPid }
    }
    if (launched.renderer === "chromium") await delay(Math.min(CHROMIUM_RENDERER_SETTLE_MS, remaining()), undefined, { signal })
  } catch (error) {
    return finish(signal?.aborted ? "aborted" : "error", undefined, safeError(error))
  } finally {
    metrics.launchMs += performance.now() - launchStarted
  }

  let observation: DesktopObservation | undefined
  let staleRetries = 0
  while (true) {
    if (signal?.aborted) return finish("aborted", observation)
    if (Date.now() >= deadline) return finish("timeout", observation)

    const observationStarted = performance.now()
    try {
      observation = await observe(client, {
        app: launched.app || input.target.app,
        windowId: launched.window?.id,
        root,
        textSlots: input.textSlots ?? [],
        usedSlotIds,
        allowPressEnter,
      }, { timeoutMs: remaining(), signal })
    } catch (error) {
      return finish(signal?.aborted ? "aborted" : "error", observation, safeError(error))
    } finally {
      metrics.observationMs += performance.now() - observationStarted
    }
    emit({ type: "observed", step: decisions, status: "running", payload: { app: observation.app, window: observation.title, surface: observation.surface, candidateCount: observation.candidates.length, complete: observation.complete } })

    if (pendingMutation) {
      const changed = pendingMutation.before !== observation.fingerprint
      pendingMutation.entry.changed = changed
      history[pendingMutation.historyIndex] += `; changed=${changed}`
      unchangedMutations = changed ? 0 : unchangedMutations + 1
      pendingMutation = undefined
      if (unchangedMutations >= 3) return finish("blocked", observation, "Three delivered actions produced no observable accessibility change")
    }
    if (actions >= input.budget.maxActions) return finish("max_actions", observation)
    if (decisions >= input.budget.maxDecisions) return finish("max_decisions", observation)

    const privateValues = (input.textSlots ?? []).map(slot => slot.value)
    const decisionStarted = performance.now()
    let decision
    try {
      decision = await decide(
        redactLocalValues(input.goal, privateValues),
        observation.candidates.map(candidate => ({ ...candidate, description: redactLocalValues(candidate.description, privateValues) })),
        redactLocalValues(observation.context, privateValues),
        history.map(item => redactLocalValues(item, privateValues)),
        signal,
      )
    } catch (error) {
      return finish(signal?.aborted ? "aborted" : "error", observation, safeError(error))
    } finally {
      metrics.decisionMs += performance.now() - decisionStarted
    }
    decisions++
    metrics.inputTokens += decision.usage.inputTokens
    metrics.outputTokens += decision.usage.outputTokens
    const candidate = observation.candidates.find(item => item.id === decision.candidateId)
    if (!candidate || candidate.operation !== decision.operation) return finish("error", observation, "Jev selected a candidate outside the current observation")
    const entry: GuiTaskTrace = { step: decisions, stateId: observation.fingerprint, operation: decision.operation, candidateId: candidate.id, candidate: candidate.description, confidence: decision.confidence }
    trace.push(entry)
    emit({ type: "decided", step: decisions, status: "running", payload: { operation: decision.operation, candidate: candidate.description, confidence: decision.confidence, model: decision.model, latencyMs: decision.latencyMs } })

    if (decision.operation === "DONE") {
      if (decision.confidence < 0.7) return finish("needs_review", observation, `Jev completion confidence ${decision.confidence.toFixed(2)} is too low to prove the whole goal`)
      return finish("done", observation)
    }
    if (decision.operation === "BLOCKED") return finish("blocked", observation, "Jev found no safe supplied action that can advance the goal")
    if (["SET_VALUE", "TYPE_TEXT"].includes(decision.operation) && !findSlot(input, candidate.slotId)) return finish("needs_text", observation, `No local text is available for ${candidate.slotId ?? "the selected field"}`)
    if (isMutation(candidate.operation) && decision.confidence < 0.55) return finish("blocked", observation, `Jev confidence ${decision.confidence.toFixed(2)} is too low to identify one safe desktop action`)
    if (isMutation(candidate.operation) && decision.confidence < 0.7) return finish("needs_review", observation, `Jev confidence ${decision.confidence.toFixed(2)} requires user confirmation before acting`)
    if (isMutation(candidate.operation) && decision.confidence < 0.9) {
      const riskStarted = performance.now()
      try {
        const risk = await assessRisk(redactLocalValues(input.goal, privateValues), decision.operation, redactLocalValues(candidate.description, privateValues), signal)
        metrics.inputTokens += risk.usage.inputTokens
        metrics.outputTokens += risk.usage.outputTokens
        if (risk.probability >= 0.5) return finish("needs_review", observation, `The selected action may be hard to undo (risk=${risk.probability.toFixed(2)}) and requires user confirmation`)
      } catch (error) {
        return finish(signal?.aborted ? "aborted" : "error", observation, safeError(error))
      } finally {
        metrics.decisionMs += performance.now() - riskStarted
      }
    }

    if (decision.operation === "DRILL") {
      root = candidate.ref
      allowPressEnter = false
      consecutiveWaits = 0
      unchangedMutations = 0
      entry.outcome = "observed_deeper"
      history.push(`DRILL ${candidate.description}`)
      continue
    }
    if (decision.operation === "WIDEN") {
      root = undefined
      allowPressEnter = false
      consecutiveWaits = 0
      unchangedMutations = 0
      entry.outcome = "observed_window"
      history.push("WIDEN")
      continue
    }
    if (decision.operation === "WAIT") {
      consecutiveWaits++
      unchangedMutations = 0
      if (consecutiveWaits >= 3) return finish("blocked", observation, "Jev waited three consecutive turns without selecting a progress operation")
      await delay(Math.min(250, remaining()), undefined, { signal })
      entry.outcome = "waited"
      history.push("WAIT")
      continue
    }

    const actionStarted = performance.now()
    try {
      const outcome = await executeCandidate(client, launched.app || input.target.app, candidate, input, remaining(), signal)
      actions++
      consecutiveWaits = 0
      entry.outcome = outcome
      if (candidate.slotId) usedSlotIds.add(candidate.slotId)
      allowPressEnter = ["SET_VALUE", "TYPE_TEXT"].includes(decision.operation)
      const historyIndex = history.push(`${decision.operation} ${candidate.description}: ${outcome}`) - 1
      pendingMutation = { before: observation.fingerprint, entry, historyIndex }
      emit({ type: "acted", step: decisions, status: "running", payload: { operation: decision.operation, candidate: candidate.description, outcome } })
      root = undefined
      staleRetries = 0
    } catch (error) {
      entry.note = safeError(error)
      if (error instanceof AgentDesktopCommandError && error.safeToRetry && error.detail.code === "STALE_REF" && staleRetries < 1) {
        staleRetries++
        root = undefined
        history.push(`${decision.operation} stale before delivery; refreshed without replaying the old ref`)
        continue
      }
      actions++
      return finish(error instanceof AgentDesktopCommandError && error.safeToRetry ? "blocked" : "needs_review", observation, safeError(error))
    } finally {
      metrics.actionMs += performance.now() - actionStarted
    }
  }
}

async function executeCandidate(
  client: AgentDesktopClient,
  app: string,
  candidate: DesktopCandidate,
  input: GuiTaskInput,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const common = { timeoutMs, signal }
  if (candidate.operation === "PRESS_ENTER") {
    const result = await client.run<Record<string, unknown>>(["press", "return", "--app", app], common)
    return delivery(result)
  }
  if (!candidate.ref) throw new Error(`${candidate.operation} requires an observed element ref`)
  if (candidate.operation === "CLICK") {
    const args = ["click", candidate.ref, "--timeout-ms", String(timeoutMs)]
    if (candidate.headed) args.unshift("--headed")
    return delivery(await client.run(args, common))
  }
  if (candidate.operation === "DOUBLE_CLICK") return delivery(await client.run(["--headed", "double-click", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "SCROLL_TO") return delivery(await client.run(["scroll-to", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "CHECK") return delivery(await client.run(["check", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "UNCHECK") return delivery(await client.run(["uncheck", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "EXPAND") return delivery(await client.run(["expand", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "COLLAPSE") return delivery(await client.run(["collapse", candidate.ref, "--timeout-ms", String(timeoutMs)], common))
  if (candidate.operation === "SCROLL_DOWN" || candidate.operation === "SCROLL_UP") return delivery(await client.run(["scroll", candidate.ref, "--direction", candidate.operation === "SCROLL_DOWN" ? "down" : "up", "--amount", "3", "--timeout-ms", String(timeoutMs)], common))
  if (["SET_VALUE", "TYPE_TEXT"].includes(candidate.operation)) {
    const slot = findSlot(input, candidate.slotId)
    if (!slot) throw new Error("Selected text candidate has no prepared local value")
    const command = candidate.operation === "SET_VALUE" ? "set-value" : "type"
    const args = [command, candidate.ref, slot.value, "--timeout-ms", String(timeoutMs)]
    if (candidate.headed) args.unshift("--headed")
    return delivery(await client.run(args, common))
  }
  throw new Error(`Unsupported desktop operation: ${candidate.operation}`)
}

function delivery(envelope: { data?: Record<string, unknown> }): string {
  const disposition = envelope.data?.disposition
  if (disposition && typeof disposition === "object" && "delivery" in disposition) return String((disposition as { delivery?: unknown }).delivery ?? "delivered")
  return "delivered"
}

function findSlot(input: GuiTaskInput, id: string | undefined) {
  return input.textSlots?.find(slot => slot.id === id)
}

function isMutation(operation: DesktopCandidate["operation"]): boolean {
  return !["DRILL", "WIDEN", "WAIT", "DONE", "BLOCKED", "PRESS_ENTER", "SCROLL_TO"].includes(operation)
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
