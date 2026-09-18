import { OrbitRemoteClient, type RemoteClientHandlers } from "./remote-client"
import { parsePairingUri, type RemoteHostOperation, type RemoteHostSnapshot, type RemoteJson } from "./remote-protocol"

const PAIRING_KEY = "orbit.remote.pairing.v1"
let client: OrbitRemoteClient | null = null

export function storedPairingUri(): string {
  return localStorage.getItem(PAIRING_KEY)?.trim() ?? ""
}

export function forgetPairing(): void {
  localStorage.removeItem(PAIRING_KEY)
  client?.close()
  client = null
}

export async function openRemoteRuntime(pairingUri: string, handlers: RemoteClientHandlers): Promise<RemoteHostSnapshot> {
  const endpoint = parsePairingUri(pairingUri.trim())
  client?.close()
  const next = new OrbitRemoteClient(handlers)
  client = next
  try {
    await next.connect(endpoint)
    const snapshot = await next.getSnapshot()
    localStorage.setItem(PAIRING_KEY, pairingUri.trim())
    return snapshot
  } catch (error) {
    if (client === next) client = null
    next.close()
    throw error
  }
}

function connectedClient(): OrbitRemoteClient {
  if (!client || client.connectionState !== "online") throw new Error("Orbit Host 未连接")
  return client
}

export function attachRemoteConnection(connectionId: string) {
  return connectedClient().attach(connectionId)
}

export function sendRemotePiCommand(project: string, command: Record<string, RemoteJson>, timeoutMs?: number) {
  return connectedClient().sendPiCommand(project, command, timeoutMs)
}

export function runRemoteHostOperation<T = RemoteJson>(operation: RemoteHostOperation, timeoutMs?: number) {
  return connectedClient().runHostOperation<T>(operation, timeoutMs)
}

export function remoteHostSnapshot() {
  return connectedClient().getSnapshot()
}
