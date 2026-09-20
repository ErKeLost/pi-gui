import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { decide } from "./jev.ts"
import type { GuiTaskEvent, GuiTaskInput, GuiTaskResult } from "./gui-task-contract.ts"
import { runGuiTaskEngine } from "./gui-task-engine.ts"
import { createPiComputerUseDriver } from "./pi-computer-use-driver.ts"

const taskSchema = {
  type: "object",
  properties: {
    version: { type: "integer", const: 1 },
    goal: { type: "string", minLength: 1, maxLength: 2_000 },
    target: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["browser", "desktop"] },
        url: { type: "string", maxLength: 8_192 },
        allowedOrigins: { type: "array", items: { type: "string", maxLength: 2_000 }, minItems: 1, maxItems: 20 },
        app: { type: "string", maxLength: 256 },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    completion: {
      type: "object",
      properties: {
        requiredText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
        forbiddenText: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 20 },
        urlIncludes: { type: "string", maxLength: 2_000 },
        titleIncludes: { type: "string", maxLength: 512 },
        controls: {
          type: "array",
          items: {
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
          },
          maxItems: 20,
        },
      },
      required: ["requiredText"],
      additionalProperties: false,
    },
    scope: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["explicit", "observed_low_risk"] },
        clickLabels: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 100 },
        scrollLabels: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
        authorizedConsequentialLabels: { type: "array", items: { type: "string", maxLength: 256 }, maxItems: 20 },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    textSlots: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,128}$" }, value: { type: "string", maxLength: 10_000 }, fieldLabel: { type: "string", maxLength: 256 } },
        required: ["id", "value", "fieldLabel"],
        additionalProperties: false,
      },
      maxItems: 50,
    },
    budget: {
      type: "object",
      properties: {
        maxActions: { type: "integer", minimum: 1, maximum: 64 },
        maxDecisions: { type: "integer", minimum: 1, maximum: 128 },
        maxDurationMs: { type: "integer", minimum: 1_000, maximum: 120_000 },
      },
      additionalProperties: false,
    },
  },
  required: ["version", "goal", "target", "completion", "scope"],
  additionalProperties: false,
} as const

export function registerGuiTask(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gui_task",
    label: "GUI task",
    description: "Execute a strictly scoped desktop or browser task with Pi-owned text, Jev action selection, and independent local completion verification.",
    promptGuidelines: ["Provide one complete goal, an explicit target, a completion predicate, and an action scope. Text values must be caller-prepared slots."],
    parameters: taskSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as GuiTaskInput
      try {
        const result = await runGuiTaskEngine({
          input,
          driver: createPiComputerUseDriver(ctx, signal),
          decide: (goal, candidates, context, history, decisionSignal) => decide(goal, candidates, context, history, decisionSignal),
          signal,
          emit: event => publishProgress(onUpdate, event),
        })
        return { content: [{ type: "text", text: formatResult(input, result) }], details: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const result: GuiTaskResult = { status: "error", actions: 0, decisions: 0, evidence: "", verification: { passed: false, reasons: [message] }, metrics: { elapsedMs: 0, observationMs: 0, decisionMs: 0, actionMs: 0, waits: 0, staleDecisions: 0, inputTokens: 0, outputTokens: 0 }, trace: [] }
        publishProgress(onUpdate, { type: "status", step: 0, status: "error", payload: { message } })
        return { content: [{ type: "text", text: `[error] ${message}` }], details: result }
      }
    },
  })
}

function publishProgress(onUpdate: ((result: { content: [{ type: "text"; text: string }]; details: Record<string, unknown> }) => void) | undefined, event: GuiTaskEvent): void {
  onUpdate?.({ content: [{ type: "text", text: progressText(event) }], details: { kind: "gui_task_progress", event } })
}

function progressText(event: GuiTaskEvent): string {
  if (event.type === "observed") return `已读取界面 · ${event.payload.candidateCount ?? 0} 个可操作项`
  if (event.type === "decided") return `Jev 选择 ${operationLabel(event.payload.operation)} · ${event.payload.latencyMs ?? 0}ms`
  if (event.type === "acted") return `已执行 ${actionLabel(event.payload.action)} · ${event.payload.changed ? "界面已更新" : "等待界面响应"}`
  if (event.type === "verified") return event.payload.passed ? "已验证任务完成" : "正在核对完成条件"
  return event.status
}

function operationLabel(value: unknown): string {
  const labels: Record<string, string> = { CLICK: "点击", TYPE_TEXT: "输入", SCROLL_UP: "向上滚动", SCROLL_DOWN: "向下滚动", WAIT: "等待", DONE: "完成", BLOCKED: "停止" }
  return labels[String(value)] || "下一步"
}

function actionLabel(value: unknown): string {
  const labels: Record<string, string> = { press: "点击", setText: "输入", scroll: "滚动" }
  return labels[String(value)] || "操作"
}

function formatResult(input: GuiTaskInput, result: GuiTaskResult): string {
  const verification = result.verification.passed ? "verified" : result.verification.reasons.join("; ") || "not verified"
  return `[${result.status}] ${input.goal}\nactions=${result.actions} decisions=${result.decisions} elapsed=${result.metrics.elapsedMs}ms verification=${verification}\n${result.evidence}`
}
