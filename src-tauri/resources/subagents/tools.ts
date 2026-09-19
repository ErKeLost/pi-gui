import type { AgentToolResult } from "@earendil-works/pi-agent-core"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { modelVisibleOutput, resultText, SubagentRuntime, textFromMessage, type TaskInput } from "./runtime.ts"
import type { AgentNode, AgentResult, AgentSnapshot } from "./types.ts"

type RuntimeContext = Pick<ExtensionContext, "cwd" | "model" | "thinkingLevel" | "sessionManager" | "ui">
type ToolResult = AgentToolResult<AgentSnapshot & { agent?: AgentNode; output?: string; results?: AgentResult[] }>

export const SUBAGENT_TOOL_NAMES = ["spawn_agent", "spawn_agents", "send_message", "followup_task", "wait_agent", "interrupt_agent", "list_agents"] as const
const ROOT_ORCHESTRATION_INSTRUCTIONS = `
<multi_agent_mode>
You are the supervisor for this task and remain responsible for the final answer. Delegate when a specialist or independent parallel work will improve the result; do not delegate trivial requests by habit. Use spawn_agent for one bounded delegation: it waits for that child and returns its completed result. Use spawn_agents for independent tasks: it runs them in parallel and returns all completed results together. After receiving delegation results, decide whether to synthesize, continue, or delegate a follow-up. Do not use send_message, wait_agent, or process state as a substitute for the delegation result unless you are controlling an already-running task.
</multi_agent_mode>`
const CHILD_ORCHESTRATION_INSTRUCTIONS = `
<multi_agent_mode>
You are a specialist delegated by a parent supervisor. Complete only the assigned task, use the available repository tools, and return a concise result with evidence and changed files. Delegate further only when the assigned task has a genuinely independent workstream that cannot be handled directly; otherwise return your result to the parent.
</multi_agent_mode>`

const ThinkingSchema = { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] } as const
const TaskSchema = {
  type: "object",
  properties: {
    task_name: { type: "string", description: "Stable task name shown in the agent tree" },
    message: { type: "string", description: "Complete task delegated to the child agent" },
    cwd: { type: "string", description: "子 agent 工作目录，默认当前项目" },
    model: { type: "string", description: "可选模型，格式 provider/model" },
    thinking: ThinkingSchema,
  },
  required: ["task_name", "message"],
  additionalProperties: false,
} as const
const BatchTaskSchema = {
  type: "object",
  properties: {
    tasks: { type: "array", minItems: 1, maxItems: 8, items: TaskSchema },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const

type SpawnInput = Omit<TaskInput, "name" | "task"> & { task_name: string; message: string }
type BatchInput = { tasks: SpawnInput[] }

function toolResult(text: string, snapshot: AgentSnapshot, agent?: AgentNode, output?: string): ToolResult {
  return { content: [{ type: "text", text: modelVisibleOutput(text) }], details: { ...snapshot, ...(agent ? { agent } : {}), ...(output !== undefined ? { output: modelVisibleOutput(output) } : {}) } }
}

function parentContext(ctx: RuntimeContext): string {
  return ctx.sessionManager.getEntries()
    .flatMap((entry) => {
      if (entry.type !== "message") return []
      const role = entry.message.role
      if (role !== "user" && role !== "assistant") return []
      const text = textFromMessage(entry.message).replace(/\s+/g, " ").trim()
      return text ? [`${role}: ${text}`] : []
    })
    .join("\n")
    .slice(-12_000)
}

function taskOptions(input: SpawnInput, ctx: RuntimeContext): TaskInput {
  return {
    name: input.task_name,
    task: input.message,
    cwd: input.cwd || ctx.cwd,
    model: input.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined),
    thinking: input.thinking || ctx.thinkingLevel,
    parentContext: parentContext(ctx),
  }
}

function runtimeFor(ctx: RuntimeContext, current: { runtime?: SubagentRuntime }): SubagentRuntime {
  if (current.runtime) return current.runtime
  const rootId = process.env.PI_GUI_AGENT_ID || ctx.sessionManager.getSessionId()
  current.runtime = new SubagentRuntime(
    rootId,
    (snapshot) => ctx.ui.setStatus("gui-agents", JSON.stringify(snapshot)),
    ctx.sessionManager.getSessionFile(),
  )
  return current.runtime
}

function resultDetails(result: AgentResult): ToolResult["details"] {
  return { ...result.snapshot, agent: result.agent, output: result.output, ...(result.usage ? { usage: result.usage } : {}) }
}

export function registerSubagentTools(pi: ExtensionAPI): void {
  const state: { runtime?: SubagentRuntime } = {}

  pi.registerTool({
    name: "spawn_agent",
    label: "Spawn agent",
    description: "Delegate one bounded task to a child Pi agent and return its completed result. The parent remains responsible for deciding what to do with that result.",
    promptGuidelines: ["Use spawn_agent for one specialized task. It waits for the child to finish and returns the final result; use spawn_agents when independent tasks should run in parallel."],
    executionMode: "sequential",
    parameters: TaskSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as SpawnInput
      const runtime = runtimeFor(ctx, state)
      const result = await runtime.delegate(taskOptions(input, ctx), signal, onUpdate)
      return { content: [{ type: "text", text: modelVisibleOutput(resultText(result.agent, result.output)) }], details: resultDetails(result) }
    },
  })

  pi.registerTool({
    name: "spawn_agents",
    label: "Spawn agents",
    description: "Delegate independent tasks to multiple child Pi agents in parallel and return every completed result for the supervisor to synthesize.",
    promptGuidelines: ["Use spawn_agents only for independent tasks. It waits for all children and returns one result per task; do not use it for dependent steps."],
    executionMode: "sequential",
    parameters: BatchTaskSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as BatchInput
      const runtime = runtimeFor(ctx, state)
      const result = await runtime.delegateMany(input.tasks.map((task) => taskOptions(task, ctx)), signal, onUpdate)
      const output = result.results.map((item) => resultText(item.agent, item.output)).join("\n\n---\n\n")
      return {
        content: [{ type: "text", text: modelVisibleOutput(output) }],
        details: { ...result.snapshot, results: result.results },
      }
    },
  })

  pi.registerTool({
    name: "send_message",
    label: "Message agent",
    description: "Send context to a running child without starting a new turn when possible.",
    parameters: {
      type: "object",
      properties: { target: { type: "string", description: "Agent id returned by spawn_agent" }, message: { type: "string" } },
      required: ["target", "message"],
      additionalProperties: false,
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { target: string; message: string }
      const runtime = runtimeFor(ctx, state)
      const agent = await runtime.send(input.target, input.message, "steer")
      return toolResult(`${agent.name}: 消息已发送`, runtime.snapshot(), agent)
    },
  })

  pi.registerTool({
    name: "followup_task",
    label: "Follow up agent",
    description: "Assign follow-up work to an existing child. A completed child starts another turn with its existing context.",
    parameters: {
      type: "object",
      properties: { target: { type: "string", description: "Agent id returned by spawn_agent" }, message: { type: "string" } },
      required: ["target", "message"],
      additionalProperties: false,
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { target: string; message: string }
      const runtime = runtimeFor(ctx, state)
      const agent = await runtime.send(input.target, input.message, "followUp")
      await runtime.wait(agent.id, _signal)
      const output = runtime.output(agent.id)
      return toolResult(resultText(runtime.snapshot().recent.find((item) => item.id === agent.id) || agent, output), runtime.snapshot(), agent, output)
    },
  })

  pi.registerTool({
    name: "wait_agent",
    label: "Wait agent",
    description: "等待一个子 agent 或当前所有子 agent 完成，并返回完整结果。",
    parameters: { type: "object", properties: { target: { type: "string" } }, additionalProperties: false } as const,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as { target?: string }
      const runtime = runtimeFor(ctx, state)
      const snapshot = await runtime.wait(input.target, signal)
      const output = runtime.output(input.target)
      return toolResult(output || "子 agent 状态已更新", snapshot, undefined, output)
    },
  })

  pi.registerTool({
    name: "interrupt_agent",
    label: "Interrupt agent",
    description: "取消一个正在运行的子 agent。",
    parameters: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
      additionalProperties: false,
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { target: string }
      const runtime = runtimeFor(ctx, state)
      const agent = await runtime.interrupt(input.target)
      return toolResult(`${agent.name}: ${agent.status}`, runtime.snapshot(), agent)
    },
  })

  pi.registerTool({
    name: "list_agents",
    label: "List agents",
    description: "查看当前父会话启动的全部子 agent 及状态。",
    parameters: { type: "object", properties: {}, additionalProperties: false } as const,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const runtime = runtimeFor(ctx, state)
      const snapshot = runtime.snapshot()
      return toolResult(JSON.stringify(snapshot), snapshot)
    },
  })

  pi.on("agent_start", async () => {
    if (state.runtime) await state.runtime.beginRun()
  })

  pi.on("before_agent_start", async (event) => {
    if (!SUBAGENT_TOOL_NAMES.some((name) => pi.getActiveTools().includes(name))) return
    const instructions = process.env.PI_GUI_SUBAGENT === "1" ? CHILD_ORCHESTRATION_INSTRUCTIONS : ROOT_ORCHESTRATION_INSTRUCTIONS
    return { systemPrompt: `${event.systemPrompt}\n\n${instructions}` }
  })

  // Also guard individual tool calls in case a model ignores the injected
  // instruction. Collaboration controls remain available so a parent can
  // message, inspect, interrupt, or wait for its workers while they run.
  pi.on("tool_call", async (event, ctx) => {
    if (!state.runtime?.hasActiveChildren()) return
    if ((SUBAGENT_TOOL_NAMES as readonly string[]).includes(event.toolName)) return
    try {
      await state.runtime.wait(undefined, ctx.signal)
    } catch (error) {
      if (!ctx.signal?.aborted) throw error
    }
  })

  // A child can run concurrently with the parent while it is being
  // dispatched, but the parent must not start another Pi run until every
  // dispatched child has settled. Pi awaits lifecycle handlers before it
  // polls queued continuations, so this is the supervisor barrier.
  pi.on("agent_end", async (_event, ctx) => {
    if (!state.runtime || !state.runtime.hasActiveChildren()) return
    try {
      await state.runtime.wait(undefined, ctx.signal)
    } catch (error) {
      if (!ctx.signal?.aborted) throw error
    }
  })

  pi.on("session_shutdown", async () => {
    if (state.runtime) await state.runtime.dispose()
    state.runtime = undefined
  })
}
