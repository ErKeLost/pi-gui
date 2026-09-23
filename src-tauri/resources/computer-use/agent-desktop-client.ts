import { constants, existsSync } from "node:fs"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export type DesktopError = {
  code: string
  message: string
  suggestion?: string
  details?: unknown
  disposition?: { delivery?: string; retry?: string }
}

export type DesktopEnvelope<T = Record<string, unknown>> = {
  version: string
  ok: boolean
  command: string
  data?: T
  error?: DesktopError
}

export type DesktopBounds = { x: number; y: number; width: number; height: number }
export type DesktopNode = {
  role: string
  name?: string
  description?: string
  value?: string
  ref_id?: string
  native_id?: { kind: string; value: string }
  states?: string[]
  available_actions?: string[]
  bounds?: DesktopBounds
  children_count?: number
  children?: DesktopNode[]
}

export type SnapshotData = {
  app: string
  window: { id: string; title: string }
  snapshot_id?: string
  complete: boolean
  truncated?: boolean
  nodes_observed?: number
  ref_count: number
  tree: DesktopNode
}

export type LaunchData = {
  app: string
  pid: number
  process_instance?: string
  window?: { id: string; title: string }
  renderer?: string
}

export class AgentDesktopCommandError extends Error {
  constructor(
    readonly command: string,
    readonly detail: DesktopError,
  ) {
    super(`${command} failed (${detail.code}): ${detail.message}${detail.suggestion ? ` ${detail.suggestion}` : ""}`)
    this.name = "AgentDesktopCommandError"
  }

  get safeToRetry(): boolean {
    return this.detail.disposition?.retry === "safe"
  }
}

export interface AgentDesktopClient {
  run<T>(args: string[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<DesktopEnvelope<T>>
  dispose(): Promise<void>
}

export async function createAgentDesktopClient(signal?: AbortSignal): Promise<AgentDesktopClient> {
  const paths = resolveAgentDesktopPaths()
  await Promise.all([
    access(paths.binary, constants.X_OK),
    process.platform === "darwin" ? access(paths.helper, constants.X_OK) : Promise.resolve(),
  ])
  const stateRoot = await mkdtemp(resolve(tmpdir(), "orbit-agent-desktop-"))
  let disposed = false

  return {
    async run<T>(args: string[], options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<DesktopEnvelope<T>> {
      if (disposed) throw new Error("agent-desktop client is already disposed")
      const commandSignal = combineSignals(signal, options.signal)
      const envelope = await execute(paths, stateRoot, args, options.timeoutMs, commandSignal) as DesktopEnvelope<T>
      if (!envelope.ok) throw new AgentDesktopCommandError(envelope.command || args[0] || "agent-desktop", envelope.error ?? {
        code: "UNKNOWN",
        message: "agent-desktop returned an unsuccessful response without a structured error",
      })
      return envelope
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await rm(stateRoot, { recursive: true, force: true })
    },
  }
}

function resolveAgentDesktopPaths(): { binary: string; helper: string } {
  const packageRoots = [
    resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/agent-desktop"),
    resolve(process.cwd(), "node_modules/agent-desktop"),
  ]
  const packageRoot = packageRoots.find(root => existsSync(resolve(root, "package.json")))
  if (!packageRoot) throw new Error("agent-desktop runtime package is missing from Orbit resources")
  const platformKey = `${process.platform}-${process.arch}`
  const binaries: Record<string, string> = {
    "darwin-arm64": "agent-desktop-darwin-arm64",
    "darwin-x64": "agent-desktop-darwin-x64",
  }
  const binaryName = binaries[platformKey]
  if (!binaryName) throw new Error(`agent-desktop does not support ${platformKey}`)
  return {
    binary: resolve(packageRoot, "bin", binaryName),
    helper: resolve(packageRoot, "bin", "agent-desktop-macos-helper"),
  }
}

function execute(
  paths: { binary: string; helper: string },
  stateRoot: string,
  args: string[],
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<DesktopEnvelope> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(paths.binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      timeout: timeoutMs,
      env: {
        ...process.env,
        AGENT_DESKTOP_HOME: stateRoot,
        ...(process.platform === "darwin" ? { AGENT_DESKTOP_MACOS_HELPER_PATH: paths.helper } : {}),
      },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM")
        reject(new Error(`agent-desktop output exceeded ${MAX_OUTPUT_BYTES} bytes`))
        return
      }
      target.push(chunk)
    }
    child.stdout.on("data", chunk => collect(stdout, Buffer.from(chunk)))
    child.stderr.on("data", chunk => collect(stderr, Buffer.from(chunk)))
    child.on("error", reject)
    child.on("close", (_code, killedBy) => {
      const text = Buffer.concat(stdout).toString("utf8").trim()
      try {
        const parsed = JSON.parse(text) as DesktopEnvelope
        resolvePromise(parsed)
      } catch (error) {
        const detail = Buffer.concat(stderr).toString("utf8").trim()
        reject(new Error(`agent-desktop returned invalid JSON${killedBy ? ` after ${killedBy}` : ""}: ${detail || String(error)}`))
      }
    })
  })
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((item): item is AbortSignal => Boolean(item))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}
