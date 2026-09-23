import { existsSync, cpSync, rmSync, mkdirSync, accessSync, constants } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const runtimePackages = ["@typesafe-ai", "agent-desktop"]

mkdirSync(resolve(root, "src-tauri/resources"), { recursive: true })

for (const name of runtimePackages) {
  const packageSource = resolve(root, "node_modules", name)
  const packageTarget = resolve(root, "src-tauri/resources/node_modules", name)
  if (!existsSync(packageSource)) {
    console.error(`缺少 ${name} 运行依赖，请先安装项目依赖`)
    process.exit(1)
  }
  rmSync(packageTarget, { recursive: true, force: true })
  mkdirSync(resolve(packageTarget, ".."), { recursive: true })
  cpSync(packageSource, packageTarget, { recursive: true, dereference: true })
}

const platform = `${process.platform}-${process.arch}`
const binaryNames = {
  "darwin-arm64": "agent-desktop-darwin-arm64",
  "darwin-x64": "agent-desktop-darwin-x64",
}
const binaryName = binaryNames[platform]
if (!binaryName) {
  console.error(`agent-desktop 不支持当前平台 ${platform}`)
  process.exit(1)
}
const copiedBin = resolve(root, "src-tauri/resources/node_modules/agent-desktop/bin")
for (const name of [binaryName, ...(process.platform === "darwin" ? ["agent-desktop-macos-helper"] : [])]) {
  const file = resolve(copiedBin, name)
  try { accessSync(file, constants.X_OK) }
  catch {
    console.error(`agent-desktop 运行文件不可用或不可执行: ${file}`)
    process.exit(1)
  }
}
