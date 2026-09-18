import { afterEach, describe, expect, test } from "bun:test"
import { OrbitRemoteClient, remoteReconnectDelay } from "../src/lib/remote-client"

type SocketHandler = ((event: { data?: string }) => void) | null

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: SocketHandler = null
  onmessage: SocketHandler = null
  onerror: SocketHandler = null
  onclose: SocketHandler = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.open())
  }

  private open() {
    if (this.readyState !== FakeWebSocket.CONNECTING) return
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }

  send(raw: string) {
    const request = JSON.parse(raw) as { type?: string; requestId?: string }
    if (!request.requestId) return
    const response = request.type === "host.ping"
      ? { type: "host.pong", requestId: request.requestId, serverTime: Date.now() }
      : request.type === "host.snapshot"
        ? { type: "remote.result", requestId: request.requestId, ok: true, result: { protocol: "orbit.remote.v1", serverTime: Date.now(), theme: "dark", connections: [] } }
      : { type: "remote.result", requestId: request.requestId, ok: true, result: null }
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(response) }))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    queueMicrotask(() => this.onclose?.({}))
  }

  serverClose() {
    this.close()
  }

  serverSend(message: unknown) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }))
  }
}

const originalWebSocket = globalThis.WebSocket
const clients: OrbitRemoteClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  FakeWebSocket.instances = []
  globalThis.WebSocket = originalWebSocket
})

describe("remote client reconnect", () => {
  test("uses bounded exponential backoff", () => {
    expect([0, 1, 2, 8].map(attempt => remoteReconnectDelay(attempt, 100, 500))).toEqual([100, 200, 400, 500])
  })

  test("reconnects after an unexpected close and stops after an explicit close", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const states: string[] = []
    const client = new OrbitRemoteClient({ onState: state => states.push(state) }, { reconnectBaseMs: 5, reconnectMaxMs: 10, heartbeatMs: 0 })
    clients.push(client)

    await client.connect({ host: "127.0.0.1", port: 17777, token: "1234567890abcdef" })
    expect(client.connectionState).toBe("online")
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.instances[0].serverClose()
    await Bun.sleep(20)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(client.connectionState).toBe("online")
    expect(states).toContain("connecting")
    expect(states).toContain("offline")

    client.close()
    await Bun.sleep(20)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(client.connectionState).toBe("offline")
  })

  test("accepts host.pong as the heartbeat response", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const client = new OrbitRemoteClient({}, { reconnectBaseMs: 5, reconnectMaxMs: 10, heartbeatMs: 5, heartbeatTimeoutMs: 10 })
    clients.push(client)
    await client.connect({ host: "127.0.0.1", port: 17777, token: "1234567890abcdef" })

    await Bun.sleep(30)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(client.connectionState).toBe("online")
  })

  test("receives desktop theme events and validates themed snapshots", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const events: string[] = []
    const client = new OrbitRemoteClient({ onEvent: event => { if (event.type === "host.theme") events.push(event.theme) } }, { heartbeatMs: 0 })
    clients.push(client)
    await client.connect({ host: "127.0.0.1", port: 17777, token: "1234567890abcdef" })

    expect((await client.getSnapshot()).theme).toBe("dark")
    FakeWebSocket.instances[0].serverSend({ type: "host.theme", theme: "light", serverTime: Date.now() })
    FakeWebSocket.instances[0].serverSend({ type: "host.theme", theme: "system", serverTime: Date.now() })
    await Bun.sleep(0)
    expect(events).toEqual(["light"])
  })
})
