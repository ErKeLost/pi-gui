import {
  decodeRemoteMessage,
  encodeRemoteMessage,
  isRemoteEvent,
  isRemoteHostSnapshot,
  remoteWebSocketUrl,
  type RemoteEndpoint,
  type RemoteEvent,
  type RemoteConnection,
  type RemoteHostSnapshot,
  type RemoteHostOperation,
  type RemoteJson,
  type RemoteRequest,
} from "./remote-protocol"

export type RemoteClientState = "offline" | "connecting" | "online"

export type RemoteClientOptions = {
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  heartbeatMs?: number
  heartbeatTimeoutMs?: number
}

export type RemoteClientHandlers = {
  onState?: (state: RemoteClientState) => void
  onEvent?: (event: RemoteEvent) => void
  onPiEvent?: (project: string, payload: RemoteJson) => void
  onError?: (error: Error) => void
}

export function remoteReconnectDelay(attempt: number, baseMs = 500, maxMs = 15_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
}

type PendingRequest = {
  resolve: (result: RemoteJson | undefined) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** Browser/Tauri-mobile WebSocket adapter for an Orbit desktop Host. */
export class OrbitRemoteClient {
  private socket: WebSocket | null = null
  private state: RemoteClientState = "offline"
  private handlers: RemoteClientHandlers
  private readonly options: Required<RemoteClientOptions>
  private sequence = 0
  private pending = new Map<string, PendingRequest>()
  private endpoint: RemoteEndpoint | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectAttempt = 0
  private reconnectEnabled = false
  private manuallyClosed = true
  private heartbeatPending = false

  constructor(handlers: RemoteClientHandlers = {}, options: RemoteClientOptions = {}) {
    this.handlers = handlers
    this.options = {
      reconnectBaseMs: options.reconnectBaseMs ?? 500,
      reconnectMaxMs: options.reconnectMaxMs ?? 15_000,
      heartbeatMs: options.heartbeatMs ?? 15_000,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 5_000,
    }
  }

  get connectionState(): RemoteClientState {
    return this.state
  }

  connect(endpoint: RemoteEndpoint): Promise<void> {
    this.manuallyClosed = true
    this.clearReconnect()
    this.stopHeartbeat()
    const previous = this.socket
    this.socket = null
    if (previous) previous.close()
    this.rejectPending(new Error("Orbit Host 连接已替换"))
    this.endpoint = endpoint
    this.manuallyClosed = false
    this.reconnectEnabled = false
    this.reconnectAttempt = 0
    return this.openSocket().then(() => {
      this.reconnectEnabled = true
      // A very fast close can happen between `onopen` and this promise
      // continuation. Make sure that race still enters the reconnect loop.
      if (!this.socket && !this.manuallyClosed) this.scheduleReconnect()
    })
  }

  private openSocket(): Promise<void> {
    const endpoint = this.endpoint
    if (!endpoint) return Promise.reject(new Error("Orbit Host 地址不可用"))
    this.setState("connecting")
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(remoteWebSocketUrl(endpoint))
      this.socket = socket
      let settled = false
      const resolveOnce = () => { if (!settled) { settled = true; resolve() } }
      const rejectOnce = (error: Error) => { if (!settled) { settled = true; reject(error) } }
      socket.onopen = () => {
        if (this.socket !== socket) return
        this.reconnectAttempt = 0
        this.setState("online")
        this.startHeartbeat()
        resolveOnce()
      }
      socket.onmessage = event => {
        if (typeof event.data !== "string") return
        const message = decodeRemoteMessage(event.data)
        if (isRemoteEvent(message)) this.receive(message)
      }
      socket.onerror = () => {
        if (this.socket !== socket) return
        const error = new Error("无法连接 Orbit Host")
        this.handlers.onError?.(error)
        if (this.state === "connecting") rejectOnce(error)
        socket.close()
      }
      socket.onclose = () => {
        if (this.socket !== socket) return
        this.socket = null
        this.stopHeartbeat()
        this.rejectPending(new Error("Orbit Host 连接已关闭"))
        this.setState("offline")
        rejectOnce(new Error("Orbit Host 连接已关闭"))
        if (!this.manuallyClosed && this.reconnectEnabled) this.scheduleReconnect()
      }
    })
  }

  send(request: RemoteRequest): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Orbit Host 未连接")
    this.socket.send(encodeRemoteMessage(request))
  }

  sendPiCommand(project: string, command: Record<string, RemoteJson>, timeoutMs = 30_000): Promise<void> {
    return this.request({ type: "pi.command", project, command }, timeoutMs).then(() => undefined)
  }

  getSnapshot(timeoutMs = 10_000): Promise<RemoteHostSnapshot> {
    return this.request({ type: "host.snapshot" }, timeoutMs).then(result => {
      if (!isRemoteHostSnapshot(result)) throw new Error("Orbit Host 返回了无效的状态快照")
      return result
    })
  }

  attach(connectionId: string, timeoutMs = 10_000): Promise<RemoteConnection> {
    return this.request({ type: "connection.attach", connectionId }, timeoutMs).then(result => result as RemoteConnection)
  }

  runHostOperation<T = RemoteJson>(operation: RemoteHostOperation, timeoutMs = 30_000): Promise<T> {
    return this.request({ type: "host.operation", operation }, timeoutMs).then(result => result as T)
  }

  request(request: RemoteRequest, timeoutMs = 30_000): Promise<RemoteJson | undefined> {
    const requestId = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error("Orbit Host 请求超时"))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      try {
        this.send({ ...request, requestId })
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  close(): void {
    this.manuallyClosed = true
    this.reconnectEnabled = false
    this.endpoint = null
    this.clearReconnect()
    this.stopHeartbeat()
    const socket = this.socket
    this.socket = null
    if (socket) socket.close()
    this.rejectPending(new Error("Orbit Host 连接已关闭"))
    this.setState("offline")
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manuallyClosed || !this.endpoint) return
    const delay = remoteReconnectDelay(this.reconnectAttempt++, this.options.reconnectBaseMs, this.options.reconnectMaxMs)
    this.setState("connecting")
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket().catch(() => {
        // onclose schedules the next attempt. Some WebSocket implementations
        // only emit error for a failed handshake, so ensure another attempt.
        if (!this.socket) this.scheduleReconnect()
      })
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.options.heartbeatMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatPending || this.state !== "online") return
      this.heartbeatPending = true
      this.request({ type: "host.ping" }, this.options.heartbeatTimeoutMs).catch(() => {
        const socket = this.socket
        if (socket) socket.close()
      }).finally(() => { this.heartbeatPending = false })
    }, this.options.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.heartbeatPending = false
  }

  private receive(event: RemoteEvent): void {
    this.handlers.onEvent?.(event)
    if (event.type === "pi.event") this.handlers.onPiEvent?.(event.project, event.payload)
    if (event.type === "pi.events") {
      for (const payload of event.payloads) this.handlers.onPiEvent?.(event.project, payload)
    }
    if (!("requestId" in event) || !event.requestId) return
    const pending = this.pending.get(event.requestId)
    if (!pending) return
    if (event.type === "host.pong") {
      clearTimeout(pending.timeout)
      this.pending.delete(event.requestId)
      pending.resolve({ serverTime: event.serverTime })
      return
    }
    if (event.type !== "remote.result" && event.type !== "remote.error") return
    clearTimeout(pending.timeout)
    this.pending.delete(event.requestId)
    if (event.type === "remote.error") pending.reject(new Error(event.error))
    else if (event.ok) pending.resolve(event.result)
    else pending.reject(new Error(event.error ?? "Orbit Host 请求失败"))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private setState(state: RemoteClientState): void {
    if (this.state === state) return
    this.state = state
    this.handlers.onState?.(state)
  }
}
