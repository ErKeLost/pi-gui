import { existsSync, cpSync, rmSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const runtimeScopes = ["@trycua", "@typesafe-ai", "@ubjs"]

mkdirSync(resolve(root, "src-tauri/resources"), { recursive: true })

for (const scope of runtimeScopes) {
  const packageSource = resolve(root, "node_modules", scope)
  const packageTarget = resolve(root, "src-tauri/resources/node_modules", scope)
  if (!existsSync(packageSource)) {
    console.error(`缺少 ${scope} 运行依赖，请先安装项目依赖`)
    process.exit(1)
  }
  rmSync(packageTarget, { recursive: true, force: true })
  mkdirSync(resolve(packageTarget, ".."), { recursive: true })
  cpSync(packageSource, packageTarget, { recursive: true, dereference: true })
}
