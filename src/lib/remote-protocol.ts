/**
 * Messages shared by the desktop host and the mobile client.
 *
 * Keep this protocol deliberately small: Pi's native RPC payload is carried
 * as an opaque JSON value so new Pi events do not require a mobile release.
 */
export const REMOTE_PROTOCOL = "orbit.remote.v1" as const

export type RemoteJson = string | number | boolean | null | RemoteJson[] | { [key: string]: RemoteJson }
export type RemoteTheme = "light" | "dark"

export type RemoteHostOperation =
  | { name: "session.list"; cwd: string }
  | { name: "project.files"; cwd: string }
  | { name: "session.turnDurations"; sessionPath: string }
  | { name: "session.delete"; sessionPath: string }

export type RemoteRequest =
  | { type: "host.ping"; requestId?: string }
  | { type: "host.snapshot"; requestId?: string }
  | { type: "host.operation"; requestId?: string; operation: RemoteHostOperation }
  | { type: "connection.attach"; requestId?: string; connectionId: string }
  | { type: "pi.command"; requestId?: string; project: string; command: Record<string, RemoteJson> }

export type RemoteConnection = { id: string; cwd: string }
export type RemoteHostSnapshot = { protocol: typeof REMOTE_PROTOCOL; serverTime: number; theme?: RemoteTheme; machineName?: string; connections: RemoteConnection[] }

export type RemoteEvent =
  | { type: "host.hello"; protocol: typeof REMOTE_PROTOCOL; hostId: string; serverTime: number; theme?: RemoteTheme; machineName?: string }
  | { type: "host.theme"; theme: RemoteTheme; serverTime: number }
  | { type: "host.pong"; requestId?: string; serverTime: number }
  | { type: "pi.event"; project: string; payload: RemoteJson }
  | { type: "pi.events"; project: string; payloads: RemoteJson[] }
  | { type: "connection.closed"; project: string }
  | { type: "connection.invalidated"; project: string; command: string }
  | { type: "remote.result"; requestId?: string; ok: boolean; result?: RemoteJson; error?: string }
  | { type: "remote.error"; requestId?: string; error: string }

export type RemoteMessage = RemoteRequest | RemoteEvent

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function isRemoteTheme(value: unknown): value is RemoteTheme {
  return value === "light" || value === "dark"
}

export function isRemoteHostSnapshot(value: unknown): value is RemoteHostSnapshot {
  if (!record(value) || value.protocol !== REMOTE_PROTOCOL || typeof value.serverTime !== "number" || (value.theme !== undefined && !isRemoteTheme(value.theme)) || (value.machineName !== undefined && !stringValue(value.machineName)) || !Array.isArray(value.connections)) return false
  return value.connections.every(connection => record(connection) && stringValue(connection.id) && stringValue(connection.cwd))
}

export function isRemoteHostOperation(value: unknown): value is RemoteHostOperation {
  if (!record(value) || typeof value.name !== "string") return false
  if (value.name === "session.list" || value.name === "project.files") return stringValue(value.cwd)
  if (value.name === "session.turnDurations" || value.name === "session.delete") return stringValue(value.sessionPath)
  return false
}

/** Runtime guard used at the WebSocket boundary. */
export function isRemoteRequest(value: unknown): value is RemoteRequest {
  if (!record(value) || typeof value.type !== "string") return false
  if (value.type === "host.ping" || value.type === "host.snapshot") return value.requestId === undefined || typeof value.requestId === "string"
  if (value.type === "host.operation") return (value.requestId === undefined || typeof value.requestId === "string") && isRemoteHostOperation(value.operation)
  if (value.type === "connection.attach") return (value.requestId === undefined || typeof value.requestId === "string") && stringValue(value.connectionId)
  return value.type === "pi.command"
    && (value.requestId === undefined || typeof value.requestId === "string")
    && stringValue(value.project)
    && record(value.command)
}

export function isRemoteEvent(value: unknown): value is RemoteEvent {
  if (!record(value) || typeof value.type !== "string") return false
  const requestId = value.requestId === undefined || typeof value.requestId === "string"
  switch (value.type) {
    case "host.hello":
      return value.protocol === REMOTE_PROTOCOL && stringValue(value.hostId) && typeof value.serverTime === "number" && (value.theme === undefined || isRemoteTheme(value.theme)) && (value.machineName === undefined || stringValue(value.machineName))
    case "host.theme":
      return isRemoteTheme(value.theme) && typeof value.serverTime === "number"
    case "host.pong":
      return requestId && typeof value.serverTime === "number"
    case "pi.event":
      return stringValue(value.project) && value.payload !== undefined
    case "pi.events":
      return stringValue(value.project) && Array.isArray(value.payloads)
    case "connection.closed":
      return stringValue(value.project)
    case "connection.invalidated":
      return stringValue(value.project) && stringValue(value.command)
    case "remote.result":
      return requestId && typeof value.ok === "boolean" && (value.error === undefined || typeof value.error === "string")
    case "remote.error":
      return requestId && stringValue(value.error)
    default:
      return false
  }
}

export function encodeRemoteMessage(message: RemoteMessage): string {
  return JSON.stringify(message)
}

export function decodeRemoteMessage(raw: string): RemoteMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (isRemoteRequest(value) || isRemoteEvent(value)) return value
  } catch {
    // A malformed frame is handled by the caller as a protocol error.
  }
  return null
}

export type RemoteEndpoint = {
  host: string
  port: number
  token: string
  secure?: boolean
}

export function remoteWebSocketUrl(endpoint: RemoteEndpoint): string {
  const scheme = endpoint.secure ? "wss" : "ws"
  const token = encodeURIComponent(endpoint.token)
  const host = endpoint.host.includes(":") && !endpoint.host.startsWith("[") ? `[${endpoint.host}]` : endpoint.host
  return `${scheme}://${host}:${endpoint.port}/ws?token=${token}`
}

export function parsePairingUri(value: string): RemoteEndpoint {
  let uri: URL
  try {
    uri = new URL(value)
  } catch {
    throw new Error("无效的 Orbit 配对地址")
  }
  const host = uri.searchParams.get("host")?.trim().replace(/^\[|\]$/g, "") ?? ""
  const port = Number(uri.searchParams.get("port"))
  const token = uri.searchParams.get("token") ?? ""
  const protocol = uri.searchParams.get("protocol")
  if (uri.protocol !== "orbit:" || uri.hostname !== "pair" || (uri.pathname && uri.pathname !== "/")) throw new Error("无效的 Orbit 配对地址")
  if (protocol !== REMOTE_PROTOCOL) throw new Error("Orbit Host 协议版本不兼容")
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Orbit Host 端口无效")
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) throw new Error("Orbit 配对令牌无效")
  try {
    new URL(`ws://${host.includes(":") ? `[${host}]` : host}:${port}`)
  } catch {
    throw new Error("Orbit Host 地址无效")
  }
  return { host, port, token }
}
