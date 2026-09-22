/** Orbit Computer Use runtime identity and paths. The host sets these when spawning Pi. */
export const ORBIT_HOST_BUNDLE_ID = "ai.pi.gui"
export const ORBIT_AGENT_BUNDLE_ID = "ai.pi.gui.agent"

export type OrbitRuntimeEnv = {
  hostBundleId: string
  agentBundleId: string
  nodePath: string
  typesafeKeyPath?: string
  nodeModulePath?: string
}

export function readOrbitRuntimeEnv(): OrbitRuntimeEnv {
  return {
    hostBundleId: process.env.ORBIT_HOST_BUNDLE_ID?.trim() || ORBIT_HOST_BUNDLE_ID,
    agentBundleId: process.env.ORBIT_AGENT_BUNDLE_ID?.trim() || ORBIT_AGENT_BUNDLE_ID,
    nodePath: process.env.ORBIT_PI_NODE_PATH?.trim() || process.execPath,
    typesafeKeyPath: process.env.ORBIT_TYPESAFE_KEY_PATH?.trim() || undefined,
    nodeModulePath: process.env.NODE_PATH?.trim() || undefined,
  }
}
