package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:            "ACFun Live Helper",
		Width:            1320,
		Height:           860,
		MinWidth:         1100,
		MinHeight:        720,
		BackgroundColour: &options.RGBA{R: 248, G: 243, B: 245, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewUserDataPath:  sharedWebviewDataPath(),
			WebviewGpuIsDisabled: true,
			Theme:                windows.SystemDefault,
		},
		EnableDefaultContextMenu: true,
	})
	if err != nil {
		log.Fatal(err)
	}
}

func sharedWebviewDataPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	path := filepath.Join(dir, "ACFun Live Helper", "webview")
	if err := os.MkdirAll(path, 0o755); err != nil {
		return ""
	}
	return path
}
