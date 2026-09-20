import { invoke } from "@tauri-apps/api/core"
import { REMOTE_PROTOCOL, type RemoteTheme } from "./remote-protocol"

export type RemoteHostAddresses = {
  lan: string
  tailscale?: string | null
}

export type RemoteHostInfo = {
  running: true
  protocol: typeof REMOTE_PROTOCOL
  hostId: string
  bindAddress: string
  advertisedAddress: string
  port: number
  token: string
  pairingUri: string
  lanPairingUri: string
  machineName: string
  connectedClients: number
}

export function getRemoteHostAddresses(): Promise<RemoteHostAddresses> {
  return invoke<RemoteHostAddresses>("remote_host_addresses")
}

export function startRemoteHost(options: { bindAddress?: string; addressMode?: "lan" | "tailscale"; port?: number } = {}): Promise<RemoteHostInfo> {
  return invoke<RemoteHostInfo>("remote_host_start", {
    bindAddress: options.bindAddress ?? null,
    addressMode: options.addressMode ?? null,
    port: options.port ?? null,
    relayUrl: null,
  })
}

export function getRemoteHost(): Promise<RemoteHostInfo | null> {
  return invoke<RemoteHostInfo | null>("remote_host_status")
}

export function stopRemoteHost(): Promise<void> {
  return invoke<void>("remote_host_stop")
}

/** Desktop-only source of truth for the theme mirrored to mobile clients. */
export function setRemoteHostTheme(theme: RemoteTheme): Promise<void> {
  return invoke<void>("remote_host_set_theme", { theme })
}
