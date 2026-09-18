import { afterAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, delimiter, join, resolve } from "node:path"

type RpcRecord = Record<string, unknown>
type RpcResponse = RpcRecord & { type: "response"; id?: string; success?: boolean; data?: unknown; error?: string }

const cli = resolve(import.meta.dir, "../node_modules/@earendil-works/pi-coding-agent/dist/cli.js")
const runtime = process.env.PI_TEST_NODE ?? (process.env.PATH ?? "")
  .split(delimiter)
  .map(directory => join(directory, process.platform === "win32" ? "node.exe" : "node"))
  .find(existsSync)
const nodeRuntime = runtime && existsSync(runtime) ? realpathSync(runtime) : runtime ?? "node"

/**
 * Minimal strict-LF client used only by the integration fixture. Pi's protocol
 * deliberately allows U+2028/U+2029 in JSON strings, so splitting on a generic
 * line reader would corrupt valid payloads.
 */
class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams
  private buffer = ""
  private sequence = 0
  private readonly pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>()

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(chunk))
    // The bridge deliberately drains stderr as well. Keep the fixture faithful
    // so a verbose extension can never fill the pipe and stall an RPC process.
    child.stderr.resume()
    child.on("exit", (code, signal) => {
      const error = new Error(`Pi exited (${code ?? signal ?? "unknown"})`)
      for (const waiter of this.pending.values()) waiter.reject(error)
      this.pending.clear()
    })
  }

  static async start(cwd: string, sessionDir: string): Promise<RpcProcess> {
    const child = spawn(
      nodeRuntime,
      [cli, "--mode", "rpc", "--offline", "--session-dir", sessionDir],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    )
    const process = new RpcProcess(child)
    await process.request({ type: "get_state" })
    return process
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let delimiter = this.buffer.indexOf("\n")
    while (delimiter >= 0) {
      // Only LF is a record delimiter. A CR immediately before LF is accepted
      // for clients that use CRLF, while U+2028 remains part of the JSON value.
      let line = this.buffer.slice(0, delimiter)
      this.buffer = this.buffer.slice(delimiter + 1)
      if (line.endsWith("\r")) line = line.slice(0, -1)
      if (line.trim()) {
        let record: RpcRecord
        try {
          record = JSON.parse(line) as RpcRecord
        } catch (error) {
          for (const waiter of this.pending.values()) waiter.reject(new Error(`Invalid Pi JSONL: ${String(error)}`))
          this.pending.clear()
          return
        }
        const id = typeof record.id === "string" ? record.id : undefined
        if (record.type === "response" && id) {
          const waiter = this.pending.get(id)
          if (waiter) {
            this.pending.delete(id)
            waiter.resolve(record as RpcResponse)
          }
        }
      }
      delimiter = this.buffer.indexOf("\n")
    }
  }

  request(command: RpcRecord): Promise<RpcResponse> {
    const id = `contract-${++this.sequence}`
    const payload = JSON.stringify({ ...command, id })
      // Ensure the framing test sends a literal U+2028 even on runtimes that
      // choose to escape it from JSON.stringify.
      .replaceAll("\\u2028", "\u2028")
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${payload}\n`)
    })
  }

  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.stdin.end()
    this.child.kill()
    await new Promise<void>((resolve) => this.child.once("exit", () => resolve()))
  }
}

const fixtures: string[] = []
const processes: RpcProcess[] = []

async function fixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `orbit-${name}-`))
  fixtures.push(root)
  return { cwd: join(root, "project"), sessions: join(root, "sessions") }
}

afterAll(async () => {
  await Promise.all(processes.splice(0).map((process) => process.stop()))
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Pi RPC 0.85.1 process contract", () => {
  test("uses the project-local CLI and correlates concurrent requests", async () => {
    const paths = await fixture("concurrent")
    await mkdir(paths.cwd, { recursive: true })
    const process = await RpcProcess.start(paths.cwd, paths.sessions)
    processes.push(process)

    const [state, commands] = await Promise.all([
      process.request({ type: "get_state" }),
      process.request({ type: "get_commands" }),
    ])
    expect(state.success).toBe(true)
    expect(state.command).toBe("get_state")
    expect((state.data as { sessionId?: unknown }).sessionId).toEqual(expect.any(String))
    expect(commands.success).toBe(true)
    expect(commands.command).toBe("get_commands")
    expect((commands.data as { commands?: unknown[] }).commands).toEqual(expect.any(Array))
    expect(basename(cli)).toBe("cli.js")
  })

  test("preserves U+2028 inside a JSON value and records parent session lineage", async () => {
    const paths = await fixture("lineage")
    await mkdir(paths.cwd, { recursive: true })
    const process = await RpcProcess.start(paths.cwd, paths.sessions)
    processes.push(process)

    const initial = await process.request({ type: "get_state" })
    const parentFile = (initial.data as { sessionFile?: string }).sessionFile
    expect(parentFile).toEqual(expect.any(String))

    const name = "父会话\u2028边界"
    const renamed = await process.request({ type: "set_session_name", name })
    expect(renamed.success).toBe(true)
    const state = await process.request({ type: "get_state" })
    expect((state.data as { sessionName?: string }).sessionName).toBe(name)

    const next = await process.request({ type: "new_session", parentSession: parentFile })
    expect(next.success).toBe(true)
    const after = await process.request({ type: "get_state" })
    const childFile = (after.data as { sessionFile?: string }).sessionFile
    expect(childFile).toEqual(expect.any(String))
    expect(childFile).not.toBe(parentFile)

    // Session files are persisted lazily until the first user/assistant entry.
    // The RPC response still gives us a fresh child identity, which is the
    // stable contract a connection manager needs before dispatching work.
    expect((await process.request({ type: "set_session_name", name: "子会话" })).success).toBe(true)
    expect((await process.request({ type: "get_state" })).data).toMatchObject({ sessionFile: childFile })
  })

  test("keeps two project-local Pi processes isolated", async () => {
    const paths = await fixture("parallel")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(paths.cwd, { recursive: true })
    const aPaths = { sessions: join(paths.sessions, "a") }
    const bPaths = { sessions: join(paths.sessions, "b") }
    const [a, b] = await Promise.all([
      RpcProcess.start(paths.cwd, aPaths.sessions),
      RpcProcess.start(paths.cwd, bPaths.sessions),
    ])
    processes.push(a, b)

    const [aState, bState] = await Promise.all([
      a.request({ type: "get_state" }),
      b.request({ type: "get_state" }),
    ])
    const aData = aState.data as { sessionFile?: string; sessionId?: string }
    const bData = bState.data as { sessionFile?: string; sessionId?: string }
    expect(aData.sessionId).toEqual(expect.any(String))
    expect(bData.sessionId).toEqual(expect.any(String))
    expect(aData.sessionId).not.toBe(bData.sessionId)
    expect(aData.sessionFile).toContain(aPaths.sessions)
    expect(bData.sessionFile).toContain(bPaths.sessions)

    const [aName, bName] = await Promise.all([
      a.request({ type: "set_session_name", name: "agent-a" }),
      b.request({ type: "set_session_name", name: "agent-b" }),
    ])
    expect(aName.success).toBe(true)
    expect(bName.success).toBe(true)
    const [aAfter, bAfter] = await Promise.all([a.request({ type: "get_state" }), b.request({ type: "get_state" })])
    expect((aAfter.data as { sessionName?: string }).sessionName).toBe("agent-a")
    expect((bAfter.data as { sessionName?: string }).sessionName).toBe("agent-b")
  })
})
