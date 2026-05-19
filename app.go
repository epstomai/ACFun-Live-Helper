package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"aclivehelper/backend"
)

type App struct {
	ctx           context.Context
	backendPort   int
	overlayServer *http.Server
	overlayURL    string
	logFile       *os.File
	logPath       string
	logMu         sync.Mutex
}

func NewApp() *App {
	return &App{
		backendPort: envInt("ACLIVE_BACKEND_PORT", backend.DefaultPort),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := a.setupLogFile(); err != nil {
		log.Printf("failed to setup log file: %v", err)
	}
	log.Printf("==== ACFun Live Helper started; os=%s arch=%s ====", runtime.GOOS, runtime.GOARCH)
	if err := a.startOverlayServer(); err != nil {
		log.Printf("failed to start danmaku overlay server: %v", err)
	}
	if err := a.startBackend(); err != nil {
		log.Printf("failed to start embedded acfunlive-backend: %v", err)
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.stopOverlayServer(ctx)
	a.closeLogFile()
}

func (a *App) setupLogFile() error {
	a.logMu.Lock()
	defer a.logMu.Unlock()

	if a.logFile != nil {
		return nil
	}

	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	logDir := filepath.Join(dir, "ACFun Live Helper", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	a.logPath = filepath.Join(logDir, "app.log")
	f, err := os.OpenFile(a.logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	a.logFile = f
	log.SetOutput(io.MultiWriter(f, os.Stderr))
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	return nil
}

func (a *App) closeLogFile() {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile != nil {
		_ = a.logFile.Close()
		a.logFile = nil
	}
}

// GetLogPath returns the absolute path of the backend log file.
func (a *App) GetLogPath() string {
	if a.logPath == "" {
		if err := a.setupLogFile(); err != nil {
			log.Printf("failed to setup log file: %v", err)
		}
	}
	return a.logPath
}

// AppendLog writes a frontend/UI log line into the same application log file.
func (a *App) AppendLog(message string) error {
	text := strings.TrimSpace(message)
	if text == "" {
		return nil
	}
	if a.logPath == "" || a.logFile == nil {
		if err := a.setupLogFile(); err != nil {
			return err
		}
	}
	log.Printf("[frontend] %s", text)
	return nil
}

// OpenLogFolder opens the folder containing the log file in the OS file manager.
func (a *App) OpenLogFolder() error {
	if a.logPath == "" {
		return errors.New("log file is not available")
	}
	folder := filepath.Dir(a.logPath)
	if runtime.GOOS == "windows" {
		return exec.Command("explorer", folder).Start()
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", folder).Start()
	}
	return exec.Command("xdg-open", folder).Start()
}

func (a *App) OpenCoverFile() (string, error) {
	if a.ctx == nil {
		return "", errors.New("application is not ready")
	}

	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "选择直播封面",
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "图片文件 (*.jpg;*.jpeg;*.png;*.webp;*.gif)",
				Pattern:     "*.jpg;*.jpeg;*.png;*.webp;*.gif",
			},
		},
	})
}

func (a *App) ReadCoverFile(filePath string) (string, error) {
	resolvedPath, err := filepath.Abs(strings.TrimSpace(filePath))
	if err != nil {
		return "", err
	}
	if resolvedPath == "" {
		return "", nil
	}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(resolvedPath)))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(content)), nil
}

func (a *App) SaveCoverImage(dataURL string) (string, error) {
	mimeType, payload, ok := strings.Cut(strings.TrimSpace(dataURL), ";base64,")
	if !ok || !strings.HasPrefix(mimeType, "data:image/") {
		return "", errors.New("invalid cover image data")
	}

	content, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}

	ext := imageExtension(strings.TrimPrefix(mimeType, "data:"))
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	coverDir := filepath.Join(userConfigDir, "ACFun Live Helper", "covers")
	if err := os.MkdirAll(coverDir, 0o755); err != nil {
		return "", err
	}

	filePath := filepath.Join(coverDir, fmt.Sprintf("cover-%d%s", time.Now().UnixMilli(), ext))
	if err := os.WriteFile(filePath, content, 0o644); err != nil {
		return "", err
	}

	return filePath, nil
}

func (a *App) CopyText(text string) error {
	if a.ctx == nil {
		return errors.New("application is not ready")
	}
	return wailsRuntime.ClipboardSetText(a.ctx, text)
}

func (a *App) GetOverlayBaseUrl() (string, error) {
	if a.overlayURL == "" {
		if err := a.startOverlayServer(); err != nil {
			return "", err
		}
	}
	return a.overlayURL + "/danmaku-overlay.html", nil
}

// GetBackendPort returns the loopback port that the embedded acfunlive-backend
// WebSocket server listens on. Useful for the frontend store on first launch.
func (a *App) GetBackendPort() int {
	return a.backendPort
}

func (a *App) startBackend() error {
	if isPortOpen(a.backendPort) {
		log.Printf("acfunlive-backend port %d already in use; skipping embedded start", a.backendPort)
		return nil
	}

	opts := backend.Options{
		Port:   a.backendPort,
		Debug:  true,
		TCP:    envBool("ACLIVE_BACKEND_TCP"),
		LogAll: envBool("ACLIVE_BACKEND_LOGALL"),
	}
	if err := backend.Start(opts); err != nil {
		return err
	}

	for index := 0; index < 20; index++ {
		if isPortOpen(a.backendPort) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

func (a *App) startOverlayServer() error {
	if a.overlayServer != nil && a.overlayURL != "" {
		return nil
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", a.serveOverlayAsset)

	a.overlayURL = "http://" + listener.Addr().String()
	a.overlayServer = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := a.overlayServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("danmaku overlay server stopped: %v", err)
		}
	}()

	return nil
}

func (a *App) stopOverlayServer(parent context.Context) {
	if a.overlayServer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	if err := a.overlayServer.Shutdown(ctx); err != nil {
		log.Printf("failed to stop danmaku overlay server: %v", err)
	}
	a.overlayServer = nil
	a.overlayURL = ""
}

func (a *App) serveOverlayAsset(response http.ResponseWriter, request *http.Request) {
	assetPath := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if assetPath == "" {
		assetPath = "danmaku-overlay.html"
	}

	response.Header().Set("Cache-Control", "no-store")

	if served := serveDiskAsset(response, request, filepath.Join("public", assetPath)); served {
		return
	}
	if served := serveDiskAsset(response, request, filepath.Join("dist", assetPath)); served {
		return
	}

	content, err := assets.ReadFile(path.Join("dist", assetPath))
	if err != nil {
		http.NotFound(response, request)
		return
	}

	response.Header().Set("Content-Type", contentType(assetPath))
	_, _ = response.Write(content)
}

func serveDiskAsset(response http.ResponseWriter, request *http.Request, filePath string) bool {
	resolvedPath, err := filepath.Abs(filePath)
	if err != nil {
		return false
	}
	info, err := os.Stat(resolvedPath)
	if err != nil || info.IsDir() {
		return false
	}
	http.ServeFile(response, request, resolvedPath)
	return true
}

func isPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func imageExtension(mimeType string) string {
	switch strings.ToLower(mimeType) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}

func contentType(assetPath string) string {
	mimeType := mime.TypeByExtension(filepath.Ext(assetPath))
	if mimeType != "" {
		return mimeType
	}
	return "application/octet-stream"
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return fallback
	}
	return value
}

func envBool(name string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return value == "1" || value == "true" || value == "yes"
}
