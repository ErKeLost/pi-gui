// Copy the freshly built ax_control worker into the bundled resources.
// Runs via build.beforeBundleCommand: cargo has finished, so the worker
// binary exists and bundling has not started yet.
// - Cross-compilation (--target triple) puts output under target/<triple>/<profile>.
// - Mobile platforms have no desktop worker and skip cleanly.
import { copyFileSync, existsSync, statSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")

if (process.platform !== "darwin") {
  console.warn(`[sync-worker] ${process.platform} 无桌面 ax_control worker，跳过`)
  process.exit(0)
}
const mobilePlatform = ["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM ?? "")
if (mobilePlatform) {
  console.warn("[sync-worker] mobile 构建不需要桌面 worker，跳过")
  process.exit(0)
}

const triple = process.env.TAURI_ENV_TARGET || ""
const profile = process.env.TAURI_ENV_DEBUG ? "debug" : "release"
const source = resolve(root, "src-tauri/target", triple, profile, "ax_control").replace("/target//", "/target/")
const target = resolve(root, "src-tauri/resources/computer-use/ax_control")

if (!existsSync(source)) {
  console.error(`[sync-worker] 缺少 ${source}；请先完成 cargo build（tauri build 会自动执行）`)
  process.exit(1)
}
copyFileSync(source, target)
const { size } = statSync(target)
console.log(`[sync-worker] ax_control (${triple || "host"} ${profile}) ${(size / 1024 / 1024).toFixed(1)} MB → resources/computer-use/`)
