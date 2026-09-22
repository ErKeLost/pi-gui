import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { decide } from "./jev.ts"
import type { GuiTaskEvent, GuiTaskInput, GuiTaskResult } from "./gui-task-contract.ts"
import { runGuiTaskEngine } from "./gui-task-engine.ts"
import { createCuaDriver, shutdownCuaDriver } from "./cua-driver.ts"

const controlConditionSchema = {
  type: "object",
  properties: {
    label: { type: "string", maxLength: 256 },
    role: { type: "string", maxLength: 128 },
    present: { type: "boolean" },
    checked: { type: "boolean" },
    selected: { type: "boolean" },
    valueEquals: { type: "string", maxLength: 10_000 },
    valueIncludes: { type: "string", maxLength: 512 },
  },
  required: ["label"],
  additionalProperties: false,
} as const

const stepExpectationSchema = {
  type: "object",
  properties: {
    requiredText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
    requiredSlots: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" }, uniqueItems: true, maxItems: 50 },
    forbiddenText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
    urlIncludes: { type: "string", maxLength: 2_000 },
    titleIncludes: { type: "string", maxLength: 512 },
    controls: { type: "array", items: controlConditionSchema, maxItems: 20 },
    collectionItemsAtLeast: { type: "integer", minimum: 1 },
    mediaTrackPresent: { type: "boolean" },
    fillableSlots: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" }, uniqueItems: true, maxItems: 50 },
    collectionChanged: { type: "boolean", const: true },
    titleChanged: { type: "boolean", const: true },
    urlChanged: { type: "boolean", const: true },
  },
  additionalProperties: false,
} as const

const taskSchema = {
  type: "object",
  properties: {
    goal: { type: "string", minLength: 1, maxLength: 2_000 },
    target: {
      type: "object",
      properties: {
        kind: { type: "string", const: "desktop" },
        app: { type: "string", maxLength: 256 },
        windowTitle: { type: "string", maxLength: 512 },
        activation: { type: "string", enum: ["background", "foreground"] },
        launch: { type: "object", properties: { timeoutMs: { type: "integer", minimum: 1 } }, required: ["timeoutMs"], additionalProperties: false },
      },
      required: ["kind", "app", "activation"],
      additionalProperties: false,
    },
    steps: {
      type: "array",
      minItems: 0,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" },
          kind: { type: "string", enum: ["fill", "activate", "select", "choose"] },
          purpose: { type: "string", minLength: 1, maxLength: 512 },
          slotId: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" },
          afterSlotId: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" },
          index: { type: "integer", minimum: 1 },
          order: { type: "string", enum: ["reading"] },
          action: { type: "string", enum: ["click", "scroll"] },
          expect: stepExpectationSchema,
          skipIf: stepExpectationSchema,
        },
        required: ["id", "kind", "purpose"],
        allOf: [
          { if: { properties: { kind: { const: "fill" } } }, then: { required: ["slotId"] } },
          { if: { properties: { kind: { const: "activate" } } }, then: { required: ["expect"] } },
          { if: { properties: { kind: { const: "select" } } }, then: { required: ["index", "order"] } },
          { if: { properties: { kind: { const: "choose" } } }, then: { required: ["action", "expect"] } },
        ],
        additionalProperties: false,
      },
    },
    completion: {
      type: "object",
      properties: {
        appReady: { type: "boolean", const: true },
        requiredText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
        requiredSlots: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" }, uniqueItems: true, maxItems: 50 },
        forbiddenText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
        urlIncludes: { type: "string", maxLength: 2_000 },
        titleIncludes: { type: "string", maxLength: 512 },
        controls: {
          type: "array",
          items: controlConditionSchema,
          maxItems: 20,
        },
        mediaPlayback: {
          type: "object",
          properties: {
            sampleIntervalMs: { type: "integer", minimum: 1 },
            minAdvanceSeconds: { type: "number", exclusiveMinimum: 0 },
          },
          required: ["sampleIntervalMs", "minAdvanceSeconds"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    scope: {
      type: "object",
      properties: {
        allow: { type: "array", items: { type: "string", enum: ["click", "type_text", "scroll"] }, uniqueItems: true },
        scrollDeltas: { type: "array", items: { type: "number" } },
      },
      required: ["allow"],
      additionalProperties: false,
    },
    textSlots: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" }, value: { type: "string", maxLength: 10_000 }, description: { type: "string", maxLength: 512 } },
        required: ["id", "value", "description"],
        additionalProperties: false,
      },
      maxItems: 50,
    },
    budget: {
      type: "object",
      properties: {
        maxActions: { type: "integer", minimum: 1 },
        maxDecisions: { type: "integer", minimum: 1 },
        maxDurationMs: { type: "integer", minimum: 1 },
      },
      required: ["maxActions", "maxDecisions", "maxDurationMs"],
      additionalProperties: false,
    },
  },
  required: ["goal", "target", "steps", "completion", "scope", "budget"],
  additionalProperties: false,
} as const

export function registerGuiTask(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gui_task",
    label: "GUI task",
    description: "Resolve, connect or launch a desktop target, then execute an optional typed phase plan with bounded Jev choices, Cua Driver actions, and independent completion verification.",
    promptGuidelines: ["Provide one complete desktop goal. target.app is the user's natural-language application intent, not a guessed bundle ID or process name; the local target resolver maps it to an installed application. Always set target.activation explicitly: foreground when the user asks to open/show an app, background when visible activation is unnecessary. If the app may not be running, set target.launch.timeoutMs to the maximum time allowed for a real window to become ready. A request that only opens an app uses steps=[] and completion.appReady=true; never invent a UI mutation for a launch-only request. For UI work, provide an ordered typed steps plan. Use fill for a caller-prepared text slot, activate for a control related to a filled slot, select for an exact one-based item index in locally grounded reading order, and choose only for a single semantic click or scroll purpose. Fill already focuses, selects, and writes its field; never add a focus click before a fill when that slot is already observable. If a click is genuinely needed to reveal a hidden field, its expect and skipIf must both reference fillableSlots for the following fill slot. A workflow that fills a field, submits it, then chooses an ordinal result must be represented as fill -> activate(afterSlotId) -> select(index, order=reading); do not leave those relations only in goal prose. For submission into a result collection, use an expect conjunction containing the filled requiredSlots and collectionChanged=true; a collection that merely already exists cannot prove submission. Let select choose the collection matching its purpose; do not add a broad category or tab choose step merely to help locate the collection unless the user explicitly requires that category state and its selected state has an observable expect predicate. Every activate and choose step requires an observable expect postcondition; expect proves the mutation afterward and never skips it. Use skipIf separately only when an already-satisfied state should omit the phase. A non-terminal select also requires expect. Make expect a specific conjunction that identifies the successor state, not merely the app title or a generic collection size. A pure-state expect that is already true before the action is rejected as non-causal. The runtime never treats arbitrary visual change as success. When terminal success is media playback, make select the final step and prove it with completion.mediaPlayback; do not add a generic start-playback choose step or mediaTrackPresent select expectation. Every fill slot must also appear in completion.requiredSlots so final verification is causally tied to prepared input. Text values must remain in textSlots; steps refer to slot IDs and purposes, never copy values."],
    parameters: taskSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as GuiTaskInput
      try {
        const result = await runGuiTaskEngine({
          input,
          driver: createCuaDriver(ctx, signal),
          decide: (goal, candidates, context, history, decisionSignal, options) => decide(goal, candidates, context, history, decisionSignal, options),
          signal,
          emit: event => publishProgress(onUpdate, event),
        })
        return { content: [{ type: "text", text: formatResult(input, result) }], details: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = signal?.aborted ? "aborted" : "error"
        const result: GuiTaskResult = { status, actions: 0, decisions: 0, evidence: "", verification: { passed: false, reasons: status === "aborted" ? [] : [message] }, metrics: { elapsedMs: 0, targetResolutionMs: 0, targetDecisions: 0, observationMs: 0, decisionMs: 0, actionMs: 0, waits: 0, inputTokens: 0, outputTokens: 0 }, trace: [] }
        publishProgress(onUpdate, { type: "status", step: 0, status, payload: status === "aborted" ? {} : { message } })
        return { content: [{ type: "text", text: status === "aborted" ? "[aborted]" : `[error] ${message}` }], details: result }
      }
    },
  })
  pi.on("session_shutdown", async () => {
    await shutdownCuaDriver()
  })
}

function publishProgress(onUpdate: ((result: { content: [{ type: "text"; text: string }]; details: Record<string, unknown> }) => void) | undefined, event: GuiTaskEvent): void {
  onUpdate?.({ content: [{ type: "text", text: progressText(event) }], details: { kind: "gui_task_progress", event } })
}

function progressText(event: GuiTaskEvent): string {
  if (event.type === "observed") return `已读取界面 · AX ${event.payload.accessibility ?? 0} · 视觉 ${event.payload.visual ?? 0}`
  if (event.type === "decided") return `${event.payload.phaseId ? `${event.payload.phaseId} · ` : ""}Jev 选择 ${operationLabel(event.payload.operation)} · ${event.payload.latencyMs ?? 0}ms`
  if (event.type === "acted") return `${event.payload.phaseId ? `${event.payload.phaseId} · ` : ""}已执行 ${actionLabel(event.payload.action)} · ${event.payload.changed ? "界面已更新" : "等待界面响应"}`
  if (event.type === "verified") return event.payload.passed ? "已验证任务完成" : "正在核对完成条件"
  return event.status
}

function operationLabel(value: unknown): string {
  const labels: Record<string, string> = { CLICK: "点击", TYPE_TEXT: "输入", SCROLL: "滚动", WAIT: "重新观察", BLOCKED: "停止" }
  return labels[String(value)] || "下一步"
}

function actionLabel(value: unknown): string {
  const labels: Record<string, string> = { click: "点击", typeText: "输入", scroll: "滚动" }
  return labels[String(value)] || "操作"
}

export function formatResult(input: GuiTaskInput, result: GuiTaskResult): string {
  const verification = result.verification.passed ? "verified" : result.verification.reasons.join("; ") || "not verified"
  const decisions = result.trace.flatMap(entry => entry.decision ? [entry.decision] : [])
  const last = decisions.at(-1)
  const top = last ? Object.entries(last.probabilities).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([id, probability]) => `${id}=${probability.toFixed(2)}`).join(",") : "-"
  const jev = last ? `jev_action=${last.model} last=${last.operation}:${last.candidateId ?? "-"} confidence=${last.confidence.toFixed(2)} top=${top}` : "jev_action=not_called"
  const target = result.targetResolution ? `target=${result.targetResolution.strategy} decisions=${result.targetResolution.decisions}${result.targetResolution.models.length ? ` model=${result.targetResolution.models.join(",")}` : ""}${result.targetResolution.confidence === undefined ? "" : ` confidence=${result.targetResolution.confidence.toFixed(2)}`}` : "target=unresolved"
  const timing = `elapsed=${result.metrics.elapsedMs}ms target=${result.metrics.targetResolutionMs}ms observation=${result.metrics.observationMs}ms decision=${result.metrics.decisionMs}ms action=${result.metrics.actionMs}ms`
  const lastPhase = [...result.trace].reverse().find(entry => entry.phaseId)
  const terminalNote = [...result.trace].reverse().find(entry => entry.note)?.note
  const plan = `plan=${input.steps.length} phases last=${lastPhase?.phaseId ?? "none"}:${lastPhase?.phaseKind ?? "-"}`
  const selection = [...result.trace].reverse().find(entry => entry.candidate?.collection)?.candidate
  const reason = terminalNote ? `\nreason=${terminalNote}` : ""
  const selected = selection?.collection ? `\nselection=${selection.collection.id} item=${selection.collection.ordinal}/${selection.collection.size}${selection.selectedItemLabel ? ` label=${selection.selectedItemLabel.slice(0, 240)}` : ""}` : ""
  return `[${result.status}] ${input.goal}\nactions=${result.actions} decisions=${result.decisions} ${timing} ${plan} verification=${verification}\n${target}\n${jev}${selected}${reason}\n${result.evidence}`
}
