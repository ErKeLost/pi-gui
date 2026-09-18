import { useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { gooeyToast } from "goey-toast"
import { useWorkspace } from "../lib/store"
import { checkMobileUpdate, type MobileUpdate } from "../lib/mobile-update"

const started = new Set<string>()

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

async function installMobileUpdate(update: MobileUpdate) {
  const installation = invoke("mobile_update_install", {
    url: update.downloadUrl,
    version: update.version,
  })
  gooeyToast.promise(installation, {
    loading: "正在下载 Android 更新",
    success: "下载完成，请在系统界面确认安装",
    error: "Android 更新安装失败",
    showTimestamp: false,
  })
  await installation
}

export function UpdateChecker() {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget)
  useEffect(() => {
    if ((runtimeTarget !== "desktop" && runtimeTarget !== "mobile") || started.has(runtimeTarget) || import.meta.env.DEV || !isTauri()) return
    started.add(runtimeTarget)

    if (runtimeTarget === "mobile") {
      void getVersion()
        .then(checkMobileUpdate)
        .then(update => {
          if (!update) return
          gooeyToast.info(`发现 Orbit ${update.version}`, {
            description: update.body,
            duration: Infinity,
            showTimestamp: false,
            action: {
              label: "下载并安装",
              onClick: () => void installMobileUpdate(update),
            },
          })
        })
        .catch(() => undefined)
      return
    }

    void import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((update) => {
        if (!update) return
        gooeyToast.info(`发现 Orbit ${update.version}`, {
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
  }, [runtimeTarget])

  return null
}
