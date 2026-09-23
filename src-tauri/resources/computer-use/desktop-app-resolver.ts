import { spawn } from "node:child_process"
import { basename } from "node:path"
import { resolveDesktopAppChoice } from "./jev.ts"

export type InstalledDesktopApp = {
  displayName: string
  bundleId?: string
  path: string
  launchId: string
}

let inventoryPromise: Promise<InstalledDesktopApp[]> | undefined

export async function resolveDesktopApp(intent: string, signal?: AbortSignal): Promise<InstalledDesktopApp> {
  if (process.platform !== "darwin") throw new Error("Desktop app resolution is currently available only on macOS")
  const query = intent.normalize("NFKC").trim()
  if (!query) throw new Error("Desktop app intent is empty")
  const exactPaths = await spotlightPaths(exactQuery(query), signal)
  const exactApps = await readApps(exactPaths, signal)
  return selectInstalledDesktopApp(query, exactApps, () => installedApps(signal), choices => resolveDesktopAppChoice(query, choices, signal))
}

export async function selectInstalledDesktopApp(
  intent: string,
  exactApps: InstalledDesktopApp[],
  loadInventory: () => Promise<InstalledDesktopApp[]>,
  choose: (candidates: { id: string; description: string }[]) => Promise<string | null>,
): Promise<InstalledDesktopApp> {
  const exact = exactApps.filter(app => appIdentities(app).some(identity => normalize(identity) === normalize(intent)))
  if (exact.length === 1) return exact[0]
  const candidates = exact.length > 1 ? exact : await loadInventory()
  if (candidates.length === 0) throw new Error(`No installed desktop application matches: ${intent}`)
  const selected = await choose(candidates.map((app, index) => ({
    id: `app-${index}`,
    description: `installed application; display name=${app.displayName}; bundle name=${basename(app.path, ".app")}; bundle id=${app.bundleId ?? "unknown"}`,
  })))
  if (!selected) throw new Error(`No installed desktop application unambiguously matches: ${intent}`)
  const index = parseIndex(selected, candidates.length)
  return candidates[index]
}

export function clearDesktopAppInventoryCache(): void {
  inventoryPromise = undefined
}

async function installedApps(signal?: AbortSignal): Promise<InstalledDesktopApp[]> {
  inventoryPromise ??= spotlightPaths('kMDItemContentType == "com.apple.application-bundle"', signal).then(paths => readApps(paths, signal))
  try { return await inventoryPromise }
  catch (error) {
    inventoryPromise = undefined
    throw error
  }
}

async function readApps(paths: string[], signal?: AbortSignal): Promise<InstalledDesktopApp[]> {
  const unique = [...new Set(paths.filter(validTopLevelBundle))]
  const results: InstalledDesktopApp[] = []
  for (let offset = 0; offset < unique.length; offset += 200) {
    const paths = unique.slice(offset, offset + 200)
    const raw = await capture("/usr/bin/mdls", ["-raw", "-name", "kMDItemCFBundleIdentifier", "-name", "kMDItemDisplayName", ...paths], signal)
    const values = raw.split("\0")
    for (const [index, path] of paths.entries()) {
      const fallback = basename(path, ".app")
      const bundleId = metadataValue(values[index * 2] ?? "")
      const displayName = metadataValue(values[index * 2 + 1] ?? "") ?? fallback
      if (displayName) results.push({ displayName, bundleId, path, launchId: bundleId ?? fallback })
    }
  }
  return results.sort((left, right) => left.displayName.localeCompare(right.displayName))
}

async function spotlightPaths(query: string, signal?: AbortSignal): Promise<string[]> {
  const output = await capture("/usr/bin/mdfind", [query], signal)
  return output.split("\n").map(line => line.trim()).filter(Boolean)
}

function exactQuery(intent: string): string {
  const value = spotlightLiteral(intent)
  const file = spotlightLiteral(`${intent}.app`)
  return `kMDItemContentType == "com.apple.application-bundle" && (kMDItemDisplayName == "${value}"cd || kMDItemFSName == "${file}"cd || kMDItemCFBundleIdentifier == "${value}"cd)`
}

function spotlightLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function validTopLevelBundle(path: string): boolean {
  return path.endsWith(".app") && path.split(".app/").length === 1
}

function appIdentities(app: InstalledDesktopApp): string[] {
  return [app.displayName, app.bundleId ?? "", basename(app.path, ".app")].filter(Boolean)
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function metadataValue(value: string): string | undefined {
  const normalized = value.replace(/\0/g, "").trim()
  return !normalized || normalized === "(null)" ? undefined : normalized
}

function parseIndex(id: string, length: number): number {
  const match = /^app-(\d+)$/.exec(id)
  const index = match ? Number(match[1]) : -1
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error("Jev selected an application outside the installed inventory")
  return index
}

function capture(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal, timeout: 10_000 })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)))
    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"))
      else reject(new Error(`${basename(command)} failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`))
    })
  })
}
