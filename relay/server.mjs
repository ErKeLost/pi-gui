import { timingSafeEqual } from "node:crypto"

const port = Number(process.env.PORT || 8787)
const hostname = process.env.HOSTNAME_BIND || "127.0.0.1"
const tlsCertPath = process.env.ORBIT_RELAY_TLS_CERT || ""
const tlsKeyPath = process.env.ORBIT_RELAY_TLS_KEY || ""
const configuredHostKey = process.env.ORBIT_RELAY_HOST_KEY || ""
const maxClientsPerHost = Number(process.env.MAX_CLIENTS_PER_HOST || 8)
const maxHostsPerIp = Number(process.env.MAX_HOSTS_PER_IP || 4)
const maxAuthFailuresPerMinute = Number(process.env.MAX_AUTH_FAILURES_PER_MINUTE || 20)
const hosts = new Map()
const hostCountsByIp = new Map()
const authFailures = new Map()

if (!/^[A-Za-z0-9_-]{32,256}$/.test(configuredHostKey)) {
  throw new Error("ORBIT_RELAY_HOST_KEY must be a 32-256 character URL-safe secret")
}

function safeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function clientIp(request, server) {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || server.requestIP(request)?.address || "unknown"
}

function route(request, server) {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/relay\/(host|client)\/([A-Za-z0-9-]{8,80})$/)
  if (!match) return null
  return { role: match[1], hostId: match[2], token: url.searchParams.get("token") || "", ip: clientIp(request, server) }
}

function rateLimited(ip) {
  const now = Date.now()
  const recent = (authFailures.get(ip) || []).filter(timestamp => now - timestamp < 60_000)
  authFailures.set(ip, recent)
  return recent.length >= maxAuthFailuresPerMinute
}

function recordFailure(ip) {
  const recent = authFailures.get(ip) || []
  recent.push(Date.now())
  authFailures.set(ip, recent)
}

function closeHost(hostId, host) {
  if (hosts.get(hostId) !== host) return
  hosts.delete(hostId)
  hostCountsByIp.set(host.ip, Math.max(0, (hostCountsByIp.get(host.ip) || 1) - 1))
  for (const client of host.clients.values()) client.close(1012, "Orbit Host disconnected")
  host.clients.clear()
}

const tls = tlsCertPath && tlsKeyPath ? { cert: Bun.file(tlsCertPath), key: Bun.file(tlsKeyPath) } : undefined

const server = Bun.serve({
  hostname,
  port,
  tls,
  maxRequestBodySize: 1_048_576,
  fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === "/health") return Response.json({ service: "orbit-relay", hosts: hosts.size, uptime: Math.floor(process.uptime()) })
    const data = route(request, server)
    if (!data) return new Response("Not found", { status: 404 })
    if (rateLimited(data.ip)) return new Response("Too many attempts", { status: 429 })
    if (data.role === "client") {
      const host = hosts.get(data.hostId)
      if (!host || !safeEqual(host.clientToken, data.token)) {
        recordFailure(data.ip)
        return new Response("Orbit Host unavailable", { status: 404 })
      }
      if (host.clients.size >= maxClientsPerHost) return new Response("Too many clients", { status: 429 })
    } else if ((hostCountsByIp.get(data.ip) || 0) >= maxHostsPerIp && !hosts.has(data.hostId)) {
      return new Response("Too many hosts", { status: 429 })
    }
    return server.upgrade(request, { data: { ...data, authenticated: data.role === "client" } }) ? undefined : new Response("Upgrade required", { status: 426 })
  },
  websocket: {
    maxPayloadLength: 1_048_576,
    idleTimeout: 45,
    open(socket) {
      if (socket.data.role !== "client") return
      const host = hosts.get(socket.data.hostId)
      if (!host || !safeEqual(host.clientToken, socket.data.token)) return socket.close(1008, "Orbit Host unavailable")
      const clientId = crypto.randomUUID()
      socket.data.clientId = clientId
      host.clients.set(clientId, socket)
      host.socket.send(JSON.stringify({ relay: "connect", clientId }))
    },
    message(socket, message) {
      const { role, hostId, clientId, ip } = socket.data
      if (role === "host" && !socket.data.authenticated) {
        let frame
        try { frame = JSON.parse(String(message)) } catch { frame = null }
        if (frame?.relay !== "register" || !safeEqual(String(frame.hostKey || ""), configuredHostKey) || !/^[A-Za-z0-9_-]{32,256}$/.test(String(frame.clientToken || ""))) {
          recordFailure(ip)
          return socket.close(1008, "Invalid host credentials")
        }
        const previous = hosts.get(hostId)
        if (previous) previous.socket.close(1012, "Orbit Host replaced")
        socket.data.authenticated = true
        const host = { socket, ip, clientToken: frame.clientToken, clients: new Map() }
        hosts.set(hostId, host)
        hostCountsByIp.set(ip, (hostCountsByIp.get(ip) || 0) + 1)
        socket.send(JSON.stringify({ relay: "registered" }))
        return
      }
      const host = hosts.get(hostId)
      if (!host || host.socket !== (role === "host" ? socket : host.socket)) return socket.close(1012, "Orbit Host unavailable")
      if (role === "client") {
        if (host.clients.get(clientId) !== socket) return socket.close(1008, "Invalid relay session")
        host.socket.send(JSON.stringify({ relay: "frame", clientId, data: String(message) }))
        return
      }
      let frame
      try { frame = JSON.parse(String(message)) } catch { return }
      if (frame?.relay !== "frame" || typeof frame.clientId !== "string" || typeof frame.data !== "string") return
      host.clients.get(frame.clientId)?.send(frame.data)
    },
    close(socket) {
      const { role, hostId, clientId } = socket.data
      const host = hosts.get(hostId)
      if (!host) return
      if (role === "host") return closeHost(hostId, host)
      if (host.clients.get(clientId) !== socket) return
      host.clients.delete(clientId)
      host.socket.send(JSON.stringify({ relay: "disconnect", clientId }))
    },
  },
})

console.log(`Orbit Relay listening on ${hostname}:${server.port}${tls ? " (TLS)" : ""}`)
