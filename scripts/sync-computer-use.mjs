import { existsSync, cpSync, rmSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const source = resolve(root, "node_modules/@injaneity/pi-computer-use")
const target = resolve(root, "src-tauri/resources/pi-computer-use")
const entry = resolve(source, "extensions/computer-use.ts")

if (!existsSync(entry)) {
  console.error("缺少 @injaneity/pi-computer-use，请先 bun add @injaneity/pi-computer-use")
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(resolve(root, "src-tauri/resources"), { recursive: true })
cpSync(source, target, { recursive: true, dereference: true })
