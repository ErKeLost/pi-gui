import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { modelVisibleOutput, SubagentRuntime } from "../src-tauri/resources/subagents/runtime"
import type { AgentSnapshot } from "../src-tauri/resources/subagents/types"
import { registerSubagentTools, SUBAGENT_TOOL_NAMES } from "../src-tauri/resources/subagents/tools"

const fakePi = resolve(import.meta.dir, "fixtures/fake-pi-rpc.mjs")
const testNode = Bun.which("node") || process.execPath
const roots: string[] = []
const runtimes: SubagentRuntime[] = []
const originalNode = process.env.ORBIT_PI_NODE_PATH
const originalPi = process.env.ORBIT_PI_CLI_PATH

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orbit-subagent-runtime-"))
  const cwd = join(root, "project")
  const parentSession = join(root, "sessions", "parent.jsonl")
  await mkdir(cwd, { recursive: true })
  roots.push(root)
  return { root, cwd, parentSession }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  if (originalNode === undefined) delete process.env.ORBIT_PI_NODE_PATH
  else process.env.ORBIT_PI_NODE_PATH = originalNode
  if (originalPi === undefined) delete process.env.ORBIT_PI_CLI_PATH
  else process.env.ORBIT_PI_CLI_PATH = originalPi
})

describe("sub-agent RPC lifecycle", () => {
  test("exposes the Codex-style collaboration surface and injects orchestration only when enabled", async () => {
    const tools: string[] = []
    let spawnExecutionMode: string | undefined
    const handlers = new Map<string, (event: { systemPrompt: string }) => unknown>()
    let active: string[] = []
    const pi = {
      registerTool: (tool: { name: string; executionMode?: string }) => {
        tools.push(tool.name)
        if (tool.name === "spawn_agent") spawnExecutionMode = tool.executionMode
      },
      on: (name: string, handler: (event: { systemPrompt: string }) => unknown) => handlers.set(name, handler),
      getActiveTools: () => active,
    }
    registerSubagentTools(pi as never)
    expect(tools).toEqual([...SUBAGENT_TOOL_NAMES])
    expect(spawnExecutionMode).toBe("sequential")
    const beforeStart = handlers.get("before_agent_start")!
    expect(await beforeStart({ systemPrompt: "base" })).toBeUndefined()
    active = [...SUBAGENT_TOOL_NAMES]
    expect(await beforeStart({ systemPrompt: "base" })).toMatchObject({ systemPrompt: expect.stringContaining("You are the supervisor") })
  })

  test("caps model-visible child output while preserving a transcript pointer", () => {
    const output = modelVisibleOutput("内容".repeat(30_000))
    expect(Buffer.byteLength(output, "utf8")).toBeLessThan(52 * 1024)
    expect(output).toContain("完整内容保留在子会话中")
  })

  test("delegates synchronously, streams progress, and reuses a settled child", async () => {
    const paths = await fixture()
    process.env.ORBIT_PI_NODE_PATH = testNode
    process.env.ORBIT_PI_CLI_PATH = fakePi
    const snapshots: AgentSnapshot[] = []
    const runtime = new SubagentRuntime("parent", (snapshot) => snapshots.push(structuredClone(snapshot)), paths.parentSession)
    runtimes.push(runtime)

    const delegated = await runtime.delegate({ name: "worker", task: "inspect", cwd: paths.cwd })
    expect(delegated.agent.status).toBe("completed")
    expect(delegated.agent.sessionId).toBe("fixture-session")
    expect(delegated.agent.sessionPath).toContain("/subagents/")
    expect(delegated.output).toBe("result-1")
    expect(runtime.hasActiveChildren()).toBe(false)
    expect(runtime.snapshot().recent[0]).toMatchObject({ id: delegated.agent.id, status: "completed", summary: "result-1" })
    expect(snapshots.some((snapshot) => snapshot.active.some((agent) => agent.status === "running"))).toBe(true)

    await runtime.send(delegated.agent.id, "continue")
    expect(runtime.snapshot().active[0]?.status).toBe("running")
    await runtime.wait(delegated.agent.id)
    expect(runtime.output(delegated.agent.id)).toBe("result-2")
  })

  test("runs independent delegations in parallel and returns every completed result", async () => {
    const paths = await fixture()
    process.env.ORBIT_PI_NODE_PATH = testNode
    process.env.ORBIT_PI_CLI_PATH = fakePi
    const runtime = new SubagentRuntime("parent", () => {}, paths.parentSession)
    runtimes.push(runtime)

    const batch = await runtime.delegateMany([
      { name: "one", task: "first", cwd: paths.cwd },
      { name: "two", task: "second", cwd: paths.cwd },
    ])
    expect(batch.results).toHaveLength(2)
    expect(batch.results.every((result) => result.agent.status === "completed")).toBe(true)
    expect(batch.results.map((result) => result.output)).toEqual(["result-1", "result-1"])
  })

  test("interrupts an active child and publishes an aborted terminal state", async () => {
    const paths = await fixture()
    process.env.ORBIT_PI_NODE_PATH = testNode
    process.env.ORBIT_PI_CLI_PATH = fakePi
    const runtime = new SubagentRuntime("parent", () => {}, paths.parentSession)
    runtimes.push(runtime)

    const spawned = await runtime.spawn({ task: "long task", cwd: paths.cwd })
    const interrupted = await runtime.interrupt(spawned.agent.id)
    expect(interrupted.status).toBe("aborted")
    expect(runtime.snapshot().active).toHaveLength(0)
    expect(runtime.snapshot().recent[0]?.endedAt).toEqual(expect.any(Number))
  })
})
