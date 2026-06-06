package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	syswin "golang.org/x/sys/windows"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:dist
var assets embed.FS

func main() {
	isMini := consumeMiniLaunchToken()

	if isMini {
		go watchParentProcess()
	}

	app := NewApp(isMini)

	appTitle := "AcFun Live Helper"
	appWidth := 1320
	appHeight := 860
	appMinWidth := 360
	appMinHeight := 640
	alwaysOnTop := false

	if isMini {
		appTitle = "AcFun Live Helper - 桌面悬浮弹幕"
		appWidth = 360
		appHeight = 580
		appMinWidth = 240
		appMinHeight = 320
		alwaysOnTop = true
	}

	var bgColour *options.RGBA
	if isMini {
		bgColour = &options.RGBA{R: 0, G: 0, B: 0, A: 0}
	} else {
		bgColour = &options.RGBA{R: 248, G: 243, B: 245, A: 255}
	}
	webviewDataPath := sharedWebviewDataPath("main")
	if isMini {
		webviewDataPath = sharedWebviewDataPath("mini")
	}

	err := wails.Run(&options.App{
		Title:            appTitle,
		Width:            appWidth,
		Height:           appHeight,
		MinWidth:         appMinWidth,
		MinHeight:        appMinHeight,
		AlwaysOnTop:      alwaysOnTop,
		Frameless:        true,
		BackgroundColour: bgColour,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewUserDataPath:               webviewDataPath,
			WebviewGpuIsDisabled:              !isMini,
			Theme:                             windows.SystemDefault,
			WebviewIsTransparent:              isMini,
			WindowIsTranslucent:               isMini,
			BackdropType:                      windows.None,
			DisableFramelessWindowDecorations: isMini,
		},
		EnableDefaultContextMenu: true,
	})
	if err != nil {
		log.Fatal(err)
	}
}

func sharedWebviewDataPath(profile string) string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	path := filepath.Join(dir, "ACFun Live Helper", "webview", profile)
	if err := os.MkdirAll(path, 0o755); err != nil {
		return ""
	}
	return path
}

// watchParentProcess 监听父进程 (ACLIVE_PARENT_PID) 是否还活着，父进程一旦消失就退出本进程，
// 确保主窗口以任何方式（正常关闭、异常退出、wails dev 重启）结束时，悬浮窗都会一并关闭。
func watchParentProcess() {
	pidStr := os.Getenv("ACLIVE_PARENT_PID")
	if pidStr == "" {
		return
	}
	pid64, err := strconv.ParseUint(pidStr, 10, 32)
	if err != nil || pid64 == 0 {
		return
	}
	pid := uint32(pid64)

	const stillActive uint32 = 259
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		handle, err := syswin.OpenProcess(syswin.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			log.Printf("[Mini] Parent process %d not reachable: %v; exiting", pid, err)
			os.Exit(0)
		}
		var code uint32
		err = syswin.GetExitCodeProcess(handle, &code)
		_ = syswin.CloseHandle(handle)
		if err != nil {
			log.Printf("[Mini] Failed to query parent exit code: %v; exiting", err)
			os.Exit(0)
		}
		if code != stillActive {
			log.Printf("[Mini] Parent process %d exited (code=%d); exiting", pid, code)
			os.Exit(0)
		}
	}
}

func consumeMiniLaunchToken() bool {
	if os.Getenv("ACLIVE_MINI_WINDOW") != "1" {
		return false
	}

	token := os.Getenv("ACLIVE_MINI_TOKEN")
	tokenFile := os.Getenv("ACLIVE_MINI_TOKEN_FILE")
	if token == "" || tokenFile == "" {
		return false
	}

	data, err := os.ReadFile(tokenFile)
	if err != nil {
		return false
	}
	_ = os.Remove(tokenFile)
	if string(data) != token {
		return false
	}

	index := strings.LastIndex(token, "-")
	if index < 0 {
		return false
	}
	createdAt, err := strconv.ParseInt(token[index+1:], 10, 64)
	if err != nil {
		return false
	}
	age := time.Since(time.Unix(0, createdAt))
	return age >= 0 && age <= 2*time.Minute
}
