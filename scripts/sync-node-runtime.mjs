import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dirname, "..")
const source = resolve(process.env.ORBIT_NODE_PATH || process.execPath)
const output = resolve(root, "src-tauri/resources/node-runtime")
const executableName = process.platform === "win32" ? "node.exe" : "node"
const executable = resolve(output, executableName)
const markerPath = resolve(output, "runtime.json")
const versionResult = spawnSync(source, ["--version"], { encoding: "utf8" })

if (versionResult.status !== 0) {
  console.error(`无法运行 Node runtime: ${source}`)
  process.exit(1)
}

const version = versionResult.stdout.trim().replace(/^v/, "")
const [major = 0, minor = 0] = version.split(".").map(Number)
if (major < 22 || major === 22 && minor < 19) {
  console.error(`Orbit 需要 Node >= 22.19，当前为 ${version}`)
  process.exit(1)
}

const marker = {
  version,
  platform: process.platform,
  arch: process.arch,
  bytes: statSync(source).size,
  executable: executableName,
}
let current
try { current = JSON.parse(readFileSync(markerPath, "utf8")) } catch { current = null }
if (existsSync(executable) && JSON.stringify(current) === JSON.stringify(marker)) process.exit(0)

mkdirSync(output, { recursive: true })
const temporary = resolve(output, `.${basename(executable)}.${process.pid}.tmp`)
rmSync(temporary, { force: true })
copyFileSync(source, temporary)
if (process.platform !== "win32") chmodSync(temporary, 0o755)
rmSync(executable, { force: true })
renameSync(temporary, executable)
writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
console.log(`Bundled Node ${version} (${process.platform}-${process.arch})`)
