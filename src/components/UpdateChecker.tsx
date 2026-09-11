import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { gooeyToast } from "goey-toast"

let started = false

async function installUpdate(update: import("@tauri-apps/plugin-updater").Update) {
  try {
    const installation = update.downloadAndInstall()
    gooeyToast.promise(installation, {
      loading: "正在下载更新",
      success: "更新已安装，正在重启",
      error: "更新安装失败",
      showTimestamp: false,
    })
    await installation
    const { relaunch } = await import("@tauri-apps/plugin-process")
    await relaunch()
  } catch {
    // gooeyToast.promise already gives the user a visible failure state.
  } finally {
    await update.close().catch(() => undefined)
  }
}

export function UpdateChecker() {
  useEffect(() => {
    if (started || import.meta.env.DEV || !isTauri()) return
    started = true

    void import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((update) => {
        if (!update) return
        gooeyToast.info(`发现 Pi GUI ${update.version}`, {
          description: update.body || "新版本已经可以安装。",
          duration: Infinity,
          showTimestamp: false,
          action: {
            label: "更新并重启",
            onClick: () => void installUpdate(update),
          },
        })
      })
      .catch(() => undefined)
  }, [])

  return null
}
