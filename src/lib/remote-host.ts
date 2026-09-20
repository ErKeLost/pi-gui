import { invoke } from "@tauri-apps/api/core"
import { REMOTE_PROTOCOL, type RemoteTheme } from "./remote-protocol"

export type RelaySettingsStatus = {
  relayUrl: string
  hasHostKey: boolean
}

export type RemoteHostInfo = {
  running: true
  mode: "lan" | "relay"
  protocol: typeof REMOTE_PROTOCOL
  hostId: string
  advertisedAddress: string
  port: number
  token: string
  pairingUri: string
  machineName: string
  connectedClients: number
  relayUrl?: string | null
  relayConnected: boolean
}

export function relaySettingsStatus(): Promise<RelaySettingsStatus> {
  return invoke<RelaySettingsStatus>("relay_settings_status")
}

export function saveRelaySettings(settings: { relayUrl: string; hostKey: string }): Promise<RelaySettingsStatus> {
  return invoke<RelaySettingsStatus>("save_relay_settings", { settings })
}

export function startRemoteHost(options: { mode?: "lan" | "relay"; port?: number } = {}): Promise<RemoteHostInfo> {
  return invoke<RemoteHostInfo>("remote_host_start", {
    bindAddress: null,
    mode: options.mode ?? null,
    port: options.port ?? null,
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
