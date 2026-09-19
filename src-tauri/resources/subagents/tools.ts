import type { AgentToolResult } from "@earendil-works/pi-agent-core"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { modelVisibleOutput, resultText, SubagentRuntime, type TaskInput } from "./runtime.ts"
import type { AgentNode, AgentSnapshot } from "./types.ts"

type RuntimeContext = Pick<ExtensionContext, "cwd" | "model" | "thinkingLevel" | "sessionManager" | "ui">
type ToolResult = AgentToolResult<AgentSnapshot & { agent?: AgentNode; output?: string }>

export const SUBAGENT_TOOL_NAMES = ["spawn_agent", "send_message", "followup_task", "wait_agent", "interrupt_agent", "list_agents"] as const
const ROOT_ORCHESTRATION_INSTRUCTIONS = `
<multi_agent_mode>
Collaboration mode is selected for this turn. For every non-trivial request that requires repository exploration, documentation research, implementation, review, or several tool calls, you must spawn at least one bounded child task before substantive work. Choose the number and shape of child tasks from the problem itself. After dispatching children, wait for all of them to settle before doing parent exploration, edits, or synthesis. You may use send_message or followup_task while they run, but do not call ordinary repository tools or produce the final answer until wait_agent has returned their results. Only a direct factual reply or one-step action should stay entirely in the parent.
</multi_agent_mode>`
const CHILD_ORCHESTRATION_INSTRUCTIONS = `
<multi_agent_mode>
Collaboration tools are available. Delegate further only when your assigned task itself contains independent workstreams that materially benefit from parallel execution. After dispatching nested children, wait for all of them to settle before continuing your assigned work or returning a result to your parent.
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

type SpawnInput = Omit<TaskInput, "name" | "task"> & { task_name: string; message: string }

function toolResult(text: string, snapshot: AgentSnapshot, agent?: AgentNode, output?: string): ToolResult {
  return { content: [{ type: "text", text: modelVisibleOutput(text) }], details: { ...snapshot, ...(agent ? { agent } : {}), ...(output !== undefined ? { output: modelVisibleOutput(output) } : {}) } }
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

export function registerSubagentTools(pi: ExtensionAPI): void {
  const state: { runtime?: SubagentRuntime } = {}

  pi.registerTool({
    name: "spawn_agent",
    label: "Spawn agent",
    description: "Spawn one independent Pi child agent and return its agent id immediately. Dispatch all independent work first, then use wait_agent before ordinary parent work or synthesis.",
    promptGuidelines: ["Use spawn_agent for bounded work that can proceed independently. After dispatching children, wait for all of them before calling repository tools or producing a result."],
    // Serialize the dispatch batch so a sibling repository tool cannot start
    // before the newly spawned child is visible to the supervisor barrier.
    executionMode: "sequential",
    parameters: TaskSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as SpawnInput
      const runtime = runtimeFor(ctx, state)
      const inheritedModel = input.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined)
      const result = await runtime.spawn({
        name: input.task_name,
        task: input.message,
        cwd: input.cwd || ctx.cwd,
        model: inheritedModel,
        thinking: input.thinking || ctx.thinkingLevel,
      }, signal, onUpdate)
      return toolResult(resultText(result.agent, result.output), result.snapshot, result.agent, result.output)
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
      return toolResult(`${agent.name}: 后续任务已发送`, runtime.snapshot(), agent)
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
    if (!pi.getActiveTools().includes("spawn_agent")) return
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
