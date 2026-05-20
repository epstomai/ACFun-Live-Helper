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


