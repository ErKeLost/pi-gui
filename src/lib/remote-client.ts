import {
  decodeRemoteMessage,
  encodeRemoteMessage,
  isRemoteEvent,
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

export type RemoteClientHandlers = {
  onState?: (state: RemoteClientState) => void
  onEvent?: (event: RemoteEvent) => void
  onPiEvent?: (project: string, payload: RemoteJson) => void
  onError?: (error: Error) => void
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
  private sequence = 0
  private pending = new Map<string, PendingRequest>()

  constructor(handlers: RemoteClientHandlers = {}) {
    this.handlers = handlers
  }

  get connectionState(): RemoteClientState {
    return this.state
  }

  connect(endpoint: RemoteEndpoint): Promise<void> {
    this.close()
    this.setState("connecting")
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(remoteWebSocketUrl(endpoint))
      this.socket = socket
      socket.onopen = () => {
        if (this.socket !== socket) return
        this.setState("online")
        resolve()
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
        if (this.state === "connecting") reject(error)
      }
      socket.onclose = () => {
        if (this.socket !== socket) return
        this.socket = null
        this.rejectPending(new Error("Orbit Host 连接已关闭"))
        this.setState("offline")
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
    return this.request({ type: "host.snapshot" }, timeoutMs).then(result => result as RemoteHostSnapshot)
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
    const socket = this.socket
    this.socket = null
    if (socket) socket.close()
    this.rejectPending(new Error("Orbit Host 连接已关闭"))
    this.setState("offline")
  }

  private receive(event: RemoteEvent): void {
    this.handlers.onEvent?.(event)
    if (event.type === "pi.event") this.handlers.onPiEvent?.(event.project, event.payload)
    if (event.type === "pi.events") {
      for (const payload of event.payloads) this.handlers.onPiEvent?.(event.project, payload)
    }
    if ((event.type !== "remote.result" && event.type !== "remote.error") || !event.requestId) return
    const pending = this.pending.get(event.requestId)
    if (!pending) return
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
