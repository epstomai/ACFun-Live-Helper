function wailsApp() {
  return window.go && window.go.main && window.go.main.App
    ? window.go.main.App
    : null
}

export async function openCoverFile() {
  const app = wailsApp()
  return app && app.OpenCoverFile ? app.OpenCoverFile() : ""
}

export async function readCoverFile(filePath) {
  const app = wailsApp()
  return app && app.ReadCoverFile ? app.ReadCoverFile(filePath) : ""
}

export async function saveCoverImage(dataUrl) {
  const app = wailsApp()
  return app && app.SaveCoverImage ? app.SaveCoverImage(dataUrl) : dataUrl
}

export async function copyText(text) {
  const app = wailsApp()
  if (app && app.CopyText) {
    return app.CopyText(text)
  }

  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
  return undefined
}

export async function openExternalURL(url) {
  const app = wailsApp()
  if (app && app.OpenExternalURL) {
    return app.OpenExternalURL(url)
  }
  window.open(url, "_blank", "noopener,noreferrer")
  return undefined
}

export async function getSystemFonts() {
  const app = wailsApp()
  if (app && app.GetSystemFonts) {
    return app.GetSystemFonts()
  }
  return []
}

export async function getOverlayBaseUrl() {
  const app = wailsApp()
  return app && app.GetOverlayBaseUrl ? app.GetOverlayBaseUrl() : ""
}

export async function getBackendPort() {
  const app = wailsApp()
  return app && app.GetBackendPort ? app.GetBackendPort() : 0
}

export async function getLogPath() {
  const app = wailsApp()
  return app && app.GetLogPath ? app.GetLogPath() : ""
}

export async function appendLog(message) {
  const app = wailsApp()
  if (app && app.AppendLog) {
    return app.AppendLog(String(message || ""))
  }
  return undefined
}

export async function openLogFolder() {
  const app = wailsApp()
  if (app && app.OpenLogFolder) {
    return app.OpenLogFolder()
  }
  return undefined
}

export async function checkForUpdate() {
  const app = wailsApp()
  if (app && app.CheckForUpdate) {
    return app.CheckForUpdate()
  }
  return {
    currentVersion: "",
    latestVersion: "",
    releaseUrl: "",
    assetName: "",
    assetUrl: "",
    assetSize: 0,
    hasUpdate: false,
    canAutoInstall: false,
    message: "当前环境不支持更新检查",
  }
}

export async function downloadAndInstallUpdate(info) {
  const app = wailsApp()
  if (app && app.DownloadAndInstallUpdate) {
    return app.DownloadAndInstallUpdate(info || {})
  }
  throw new Error("当前环境不支持自动更新")
}

export async function getSystemStats() {
  const app = wailsApp()
  return app && app.GetSystemStats ? app.GetSystemStats() : { cpu: 0, memory: 0 }
}

export async function getNetworkDelay() {
  const app = wailsApp()
  return app && app.GetNetworkDelay ? app.GetNetworkDelay() : -1
}

export async function setAlwaysOnTop(enabled) {
  const app = wailsApp()
  if (app && app.SetAlwaysOnTop) {
    return app.SetAlwaysOnTop(enabled)
  }
}

export async function setWindowSize(width, height) {
  const app = wailsApp()
  if (app && app.SetWindowSize) {
    return app.SetWindowSize(width, height)
  }
}

export async function isMiniMode() {
  const app = wailsApp()
  return app && app.IsMiniMode ? app.IsMiniMode() : false
}

// 切换 mini 窗口的鼠标穿透模式（仅 mini 进程有效）。
// 启用后窗口对鼠标完全透明，鼠标事件直接落到下层（如全屏游戏），
// 退出穿透必须靠全局热键（默认 Ctrl+Alt+Shift+G，可在 mini footer 改键）。
export async function setMouseClickThrough(enable) {
  const app = wailsApp()
  if (app && app.SetMouseClickThrough) {
    return app.SetMouseClickThrough(Boolean(enable))
  }
}

// 重新注册全局热键。
// mods: 修饰键位掩码 — 1=Alt, 2=Ctrl, 4=Shift, 8=Win（多个用 OR 组合）
// vk: Windows Virtual Key Code（字母 A-Z = 0x41-0x5A, 数字 0-9 = 0x30-0x39, F1-F12 = 0x70-0x7B）
export async function setMouseClickThroughHotkey(mods, vk) {
  const app = wailsApp()
  if (app && app.SetMouseClickThroughHotkey) {
    return app.SetMouseClickThroughHotkey(Number(mods) || 0, Number(vk) || 0)
  }
}

// 监听后端发出的「全局热键切换穿透」事件，返回 unsubscribe 函数。
export function onClickThroughToggle(handler) {
  const runtime = window.runtime
  if (!runtime || !runtime.EventsOn) {
    return () => {}
  }
  runtime.EventsOn("mini:click-through-toggle", () => {
    try { handler() } catch {}
  })
  return () => {
    if (runtime.EventsOff) runtime.EventsOff("mini:click-through-toggle")
  }
}

export async function launchMiniWindow() {
  const app = wailsApp()
  if (app && app.LaunchMiniWindow) {
    return app.LaunchMiniWindow()
  }
}

export async function setSharedTheme(theme) {
  const app = wailsApp()
  if (app && app.SetSharedTheme) {
    return app.SetSharedTheme(theme)
  }
}

export async function getSharedTheme() {
  const app = wailsApp()
  return app && app.GetSharedTheme ? app.GetSharedTheme() : ""
}

export async function setSharedFloatState(payload) {
  const app = wailsApp()
  if (app && app.SetSharedFloatState) {
    return app.SetSharedFloatState(payload)
  }
}

export async function getSharedFloatState() {
  const app = wailsApp()
  return app && app.GetSharedFloatState ? app.GetSharedFloatState() : ""
}

export async function broadcastOverlayStyle(payload) {
  const app = wailsApp()
  if (app && app.BroadcastOverlayStyle) {
    return app.BroadcastOverlayStyle(String(payload || ""))
  }
  return undefined
}

// 让用户选择保存路径，并把远程录播文件流式下载到本地。
// 返回最终保存路径；用户取消保存对话框时返回空串。
// 浏览器环境（无 wails）下回退到 window.open，由系统浏览器接管下载。
export async function downloadPlaybackToFile(url, suggestedName) {
  const app = wailsApp()
  if (app && app.DownloadPlaybackToFile) {
    return app.DownloadPlaybackToFile(String(url || ""), String(suggestedName || ""))
  }
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer")
  }
  return ""
}

export async function getTTSVoices() {
  const app = wailsApp()
  return app && app.GetTTSVoices ? app.GetTTSVoices() : []
}

export async function generateTTS(provider, voiceName, text, speed, volume, pitch, languageHint) {
  const app = wailsApp()
  if (app && app.GenerateTTS) {
    return app.GenerateTTS(
      String(provider || ""),
      String(voiceName || ""),
      String(text || ""),
      Number(speed) || 1.0,
      Number(volume) || 80,
      Number(pitch) || 1.0,
      String(languageHint || "")
    )
  }
  return ""
}
