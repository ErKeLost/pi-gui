import { createInterface } from "node:readline"
import { join } from "node:path"

const args = process.argv.slice(2)
const sessionIndex = args.indexOf("--session-dir")
const sessionDir = sessionIndex >= 0 ? args[sessionIndex + 1] : process.cwd()
const sessionFile = join(sessionDir, "fake-child.jsonl")
let run = 0
let timers = []

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function later(delay, value) {
  const timer = setTimeout(() => send(value), delay)
  timers.push(timer)
}

function runAgent() {
  run += 1
  const answer = `result-${run}`
  later(10, { type: "agent_start" })
  later(15, { type: "message_start", message: { role: "assistant", content: [] } })
  later(20, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } })
  later(30, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "working " } })
  later(45, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: answer } })
  later(55, { type: "tool_execution_start", toolCallId: `tool-${run}`, toolName: "read", args: { path: "src/index.ts" } })
  later(70, { type: "tool_execution_end", toolCallId: `tool-${run}`, toolName: "read", result: "ok", isError: false })
  later(80, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop" } })
  later(90, { type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: answer }] }] })
  later(100, { type: "agent_settled" })
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  if (!line.trim()) return
  const command = JSON.parse(line)
  if (command.type === "get_state") {
    send({ id: command.id, type: "response", command: "get_state", success: true, data: {
      model: { provider: "fixture", id: "test-model" },
      sessionId: "fixture-session",
      sessionFile,
    } })
    return
  }
  if (command.type === "new_session") {
    send({ id: command.id, type: "response", command: "new_session", success: true, data: { cancelled: false } })
    return
  }
  if (command.type === "prompt") {
    send({ id: command.id, type: "response", command: "prompt", success: true })
    runAgent()
    return
  }
  if (command.type === "clear_queue") {
    send({ id: command.id, type: "response", command: "clear_queue", success: true, data: { steering: [], followUp: [] } })
    return
  }
  if (command.type === "abort") {
    for (const timer of timers) clearTimeout(timer)
    timers = []
    send({ id: command.id, type: "response", command: "abort", success: true })
    send({ type: "agent_settled" })
  }
})
