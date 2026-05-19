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
