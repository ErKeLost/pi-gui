import { useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { gooeyToast } from "goey-toast"
import { useWorkspace } from "../lib/store"
import { checkMobileUpdate, type MobileUpdate } from "../lib/mobile-update"

const RETRY_DELAY_MS = 3_000

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

export async function installMobileUpdate(update: MobileUpdate) {
  const installation = invoke("mobile_update_install", {
    url: update.downloadUrl,
    version: update.version,
  })
  gooeyToast.promise(installation, {
    loading: "正在下载 Android 更新，网络不好可能较慢",
    success: "下载完成，请在系统界面确认安装",
    error: "Android 更新下载失败，网络不稳定请稍后重试",
    showTimestamp: false,
  })
  await installation
}

export function offerMobileUpdate(update: MobileUpdate) {
  gooeyToast.info(`发现 Orbit ${update.version}`, {
    description: update.body,
    duration: Infinity,
    showTimestamp: false,
    action: {
      label: "下载并安装",
      onClick: () => void installMobileUpdate(update),
    },
  })
}

export function UpdateChecker() {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget)
  useEffect(() => {
    if ((runtimeTarget !== "desktop" && runtimeTarget !== "mobile") || import.meta.env.DEV || !isTauri()) return

    let disposed = false
    let checking = false
    const checkOnce = async () => {
      if (disposed || checking || document.visibilityState === "hidden") return
      checking = true
      try {
        if (runtimeTarget === "mobile") {
          const update = await checkMobileUpdate(await getVersion())
          if (update && !disposed) offerMobileUpdate(update)
          return
        }
        const { check } = await import("@tauri-apps/plugin-updater")
        const update = await check()
        if (!update || disposed) return
        gooeyToast.info(`发现 Orbit ${update.version}`, {
          description: update.body || "新版本已经可以安装。",
          duration: Infinity,
          showTimestamp: false,
          action: {
            label: "更新并重启",
            onClick: () => void installUpdate(update),
          },
        })
      } catch (error) {
        if (!disposed) gooeyToast.warning("自动更新检查失败", {
          description: "网络恢复后会自动重试。",
          showTimestamp: false,
        })
        throw error
      } finally {
        checking = false
      }
    }
    const retry = () => { void checkOnce().catch(() => undefined) }
    const startup = window.setTimeout(retry, RETRY_DELAY_MS)
    window.addEventListener("online", retry)
    window.addEventListener("focus", retry)
    return () => {
      disposed = true
      window.clearTimeout(startup)
      window.removeEventListener("online", retry)
      window.removeEventListener("focus", retry)
    }
  }, [runtimeTarget])

  return null
}
