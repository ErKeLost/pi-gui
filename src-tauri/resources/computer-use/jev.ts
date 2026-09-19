import { homedir } from "node:os"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const JEV_MODEL = "jev-latest"
const JEV_TIMEOUT_MS = 20_000

export type JevAction = "press" | "set_value" | "scroll"
export type JevCandidate = { ref: string; role: string; label: string; actions: JevAction[] }
type ChoiceAnswer = { choice?: string; noul?: number; probability?: number; confidence?: number; probabilities?: Record<string, number> }
type TargetCriteria = Partial<Record<JevAction, Record<string, string>>>
const RETRYABLE_STATUS = new Set([429, 503, 529])

export type JevDecision = {
  action: string | null
  ref: string | null
  label: string | null
  done: number | null
  risk: number | null
  confidence: number | null
  latencyMs: number
}

export function loadApiKey(): string {
  const env = process.env.TYPESAFE_API_KEY?.trim()
  if (env) return env
  for (const file of [join(homedir(), ".pi/agent/typesafe-api-key"), join(homedir(), ".typesafe-api-key"), join(homedir(), ".pi/typesafe-api-key")]) {
    try {
      const value = readFileSync(file, "utf8").trim()
      if (value) return value
    } catch { /* next */ }
  }
  throw new Error("未找到 TYPESAFE_API_KEY。请 export，或把 key 写到 ~/.typesafe-api-key（单独一行）")
}

export function sanitizeLabel(text: string, max = 120): string {
  return String(text ?? "").replace(/\b(?:https?|javascript|data):\S*/gi, "").replace(/\s+/g, " ").trim().slice(0, max)
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function validChoice(answer: ChoiceAnswer | undefined, criteria: Record<string, string>): string | null {
  if (!answer || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)) return null
  const probabilities = answer.probabilities
  const confidence = toNumber(answer.confidence)
  if (!probabilities || confidence == null || confidence < 0 || confidence > 1) return null
  if (Object.keys(probabilities).length !== Object.keys(criteria).length || Object.keys(criteria).some(key => !Object.hasOwn(probabilities, key))) return null
  const values = Object.values(probabilities)
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) >= 0.02) return null
  const chosen = probabilities[answer.choice]
  return chosen >= Math.max(...values) - 1e-6 ? answer.choice : null
}

export function buildQuestions(goal: string, candidates: JevCandidate[]) {
  const targets: TargetCriteria = {}
  for (const candidate of candidates) {
    const description = sanitizeLabel(`${candidate.role}: ${candidate.label || "unlabeled element"}`)
    for (const action of candidate.actions) (targets[action] ??= {})[candidate.ref] = description
  }
  const operations: Record<string, string> = {
    ...(targets.press ? { press: "Press or click a visible control" } : {}),
    ...(targets.set_value ? { set_value: "Replace the value of a visible text input" } : {}),
    ...(targets.scroll ? { scroll: "Scroll a visible scrollable region" } : {}),
    wait: "Wait because the required control is still loading",
    done: "Every part of the goal is visibly complete",
    blocked: "No offered operation can make progress",
  }
  const questions: Record<string, unknown> = {
    operation: {
      type: "choice",
      instructions: `Choose exactly one next operation for the current UI. Do not repeat completed work. Goal: ${goal}`,
      criteria: operations,
    },
    done: {
      type: "noul",
      instructions: "Is every part of the goal visibly complete in the current UI state?",
    },
    risk: {
      type: "noul",
      instructions: "Does the next action need explicit confirmation (delete, send, pay, login, upload, install, credentials)?",
    },
  }
  for (const action of ["press", "set_value", "scroll"] as const) {
    const criteria = targets[action]
    if (criteria) questions[`${action}_target`] = {
      type: "choice",
      instructions: `If ${action} is the next operation, choose the single best offered target for the whole goal.`,
      criteria,
    }
  }
  return {
    targets,
    questions,
  }
}

export function normalizeDecision(answers: Record<string, ChoiceAnswer> = {}, targets: TargetCriteria = {}): Omit<JevDecision, "latencyMs"> {
  const operationCriteria = {
    ...(targets.press ? { press: "press" } : {}),
    ...(targets.set_value ? { set_value: "set_value" } : {}),
    ...(targets.scroll ? { scroll: "scroll" } : {}),
    wait: "wait",
    done: "done",
    blocked: "blocked",
  }
  const action = validChoice(answers.operation, operationCriteria)
  const criteria = action === "press" || action === "set_value" || action === "scroll" ? targets[action] : undefined
  const target = criteria ? answers[`${action}_target`] : undefined
  const ref = criteria ? validChoice(target, criteria) : null
  return {
    action,
    ref,
    label: ref && criteria ? criteria[ref] ?? null : null,
    done: toNumber(answers.done?.noul ?? answers.done?.probability),
    risk: toNumber(answers.risk?.noul ?? answers.risk?.probability),
    confidence: toNumber(target?.confidence ?? answers.operation?.confidence),
  }
}

export async function decide(goal: string, app: string, candidates: JevCandidate[], context = "", history: string[] = [], signal?: AbortSignal): Promise<JevDecision> {
  const key = loadApiKey()
  const { targets, questions } = buildQuestions(goal, candidates)
  const started = Date.now()
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(JEV_TIMEOUT_MS)]) : AbortSignal.timeout(JEV_TIMEOUT_MS)
  const request = {
    model: JEV_MODEL,
    state: { goal, app, context: context.slice(0, 1500), candidates, recentActions: history.slice(-8) },
    questions,
  }
  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: requestSignal,
      body: JSON.stringify(request),
    })
    if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) break
    await response.arrayBuffer().catch(() => undefined)
    await delay(500 * 2 ** attempt, undefined, { signal: requestSignal })
  }
  if (!response) throw new Error("Jev 调用失败：没有收到响应")
  const body = await response.json().catch(() => null) as { answers?: Record<string, ChoiceAnswer>; detail?: { message?: string } } | null
  const latencyMs = Date.now() - started
  if (!response.ok || !body?.answers) {
    throw new Error(`Jev 调用失败 HTTP ${response.status}（${latencyMs}ms）：${body?.detail?.message ?? JSON.stringify(body)?.slice(0, 200)}`)
  }
  const decision = normalizeDecision(body.answers, targets)
  if (!decision.action || ((decision.action === "press" || decision.action === "set_value" || decision.action === "scroll") && !decision.ref)) {
    throw new Error("Jev 返回了无效或不完整的决策，未执行任何操作")
  }
  return { ...decision, latencyMs }
}
