import { invoke } from "@tauri-apps/api/core"
import { REMOTE_PROTOCOL } from "./remote-protocol"

export type RemoteHostInfo = {
  running: true
  protocol: typeof REMOTE_PROTOCOL
  hostId: string
  bindAddress: string
  advertisedAddress: string
  port: number
  token: string
  pairingUri: string
}

export function startRemoteHost(options: { bindAddress?: string; port?: number } = {}): Promise<RemoteHostInfo> {
  return invoke<RemoteHostInfo>("remote_host_start", {
    bindAddress: options.bindAddress ?? null,
    port: options.port ?? null,
  })
}

export function getRemoteHost(): Promise<RemoteHostInfo | null> {
  return invoke<RemoteHostInfo | null>("remote_host_status")
}

export function stopRemoteHost(): Promise<void> {
  return invoke<void>("remote_host_stop")
}
