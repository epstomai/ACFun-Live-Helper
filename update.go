package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	appVersion        = "1.1.0"
	githubOwner       = "epstomai"
	githubRepo        = "ACFun-Live-Helper"
	githubReleaseAPI  = "https://api.github.com/repos/" + githubOwner + "/" + githubRepo + "/releases"
	githubReleasesURL = "https://github.com/" + githubOwner + "/" + githubRepo + "/releases"
)

// releaseCache 缓存上次 GitHub Releases 的 ETag 和结果，避免重复消耗速率配额。
var releaseCache struct {
	etag    string
	release githubRelease
}

type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	AssetName      string `json:"assetName"`
	AssetURL       string `json:"assetUrl"`
	AssetSize      int64  `json:"assetSize"`
	PublishedAt    string `json:"publishedAt"`
	Body           string `json:"body"`
	HasUpdate      bool   `json:"hasUpdate"`
	CanAutoInstall bool   `json:"canAutoInstall"`
	Message        string `json:"message"`
}

type UpdateInstallResult struct {
	DownloadedPath string `json:"downloadedPath"`
	Version        string `json:"version"`
	Message        string `json:"message"`
	WillRestart    bool   `json:"willRestart"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	HTMLURL     string        `json:"html_url"`
	Prerelease  bool          `json:"prerelease"`
	Draft       bool          `json:"draft"`
	PublishedAt string        `json:"published_at"`
	Body        string        `json:"body"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	ContentType        string `json:"content_type"`
}

func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{
		CurrentVersion: appVersion,
		ReleaseURL:     githubReleasesURL,
	}
	if a.isMini {
		info.Message = "悬浮窗进程不检查更新"
		return info, nil
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	release, err := fetchBestGithubRelease(ctx)
	if err != nil {
		return info, err
	}
	info.LatestVersion = strings.TrimSpace(release.TagName)
	info.ReleaseURL = release.HTMLURL
	info.PublishedAt = release.PublishedAt
	info.Body = release.Body

	cmp := compareVersions(release.TagName, appVersion)
	if cmp <= 0 {
		info.Message = "当前已是最新版本"
		return info, nil
	}

	info.HasUpdate = true
	asset, ok := chooseUpdateAsset(release.Assets)
	if !ok {
		info.Message = "发现新版本，但该 Release 没有可自动安装的 Windows 资产"
		return info, nil
	}
	info.AssetName = asset.Name
	info.AssetURL = asset.BrowserDownloadURL
	info.AssetSize = asset.Size
	info.CanAutoInstall = canInstallAsset(asset.Name)
	if info.CanAutoInstall && isDevExecutable() {
		info.CanAutoInstall = false
		info.Message = fmt.Sprintf("发现新版本 %s；开发进程不执行自动替换", info.LatestVersion)
		return info, nil
	}
	if info.CanAutoInstall {
		info.Message = fmt.Sprintf("发现新版本 %s，准备自动更新", info.LatestVersion)
	} else {
		info.Message = fmt.Sprintf("发现新版本 %s，但资产类型暂不支持自动安装", info.LatestVersion)
	}
	return info, nil
}

func (a *App) DownloadAndInstallUpdate(info UpdateInfo) (UpdateInstallResult, error) {
	result := UpdateInstallResult{
		Version: info.LatestVersion,
	}
	if a.isMini {
		return result, errors.New("悬浮窗进程不执行更新")
	}
	if !info.HasUpdate || !info.CanAutoInstall || info.AssetURL == "" || info.AssetName == "" {
		return result, errors.New("没有可自动安装的更新")
	}
	if isDevExecutable() {
		return result, errors.New("wails dev 开发进程不执行自动替换，请使用正式构建版本测试更新")
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	updateDir, err := updateCacheDir(info.LatestVersion)
	if err != nil {
		return result, err
	}
	downloadPath := filepath.Join(updateDir, sanitizeUpdateFileName(info.AssetName))
	if err := downloadFile(ctx, info.AssetURL, downloadPath); err != nil {
		return result, err
	}
	result.DownloadedPath = downloadPath

	currentExe, err := os.Executable()
	if err != nil {
		return result, fmt.Errorf("获取当前程序路径失败: %w", err)
	}
	currentExe, _ = filepath.Abs(currentExe)

	installerPath := downloadPath
	if strings.EqualFold(filepath.Ext(downloadPath), ".zip") {
		extracted, err := extractUpdateExecutable(downloadPath, updateDir)
		if err != nil {
			return result, err
		}
		installerPath = extracted
	}

	ext := strings.ToLower(filepath.Ext(installerPath))
	switch ext {
	case ".exe":
		if looksLikePortableExecutable(filepath.Base(installerPath)) {
			scriptPath, err := writePortableUpdateScript(installerPath, currentExe)
			if err != nil {
				return result, err
			}
			if err := startUpdateScript(scriptPath); err != nil {
				return result, err
			}
			result.Message = "更新包已下载，正在重启并替换程序"
		} else {
			if err := startDetached(installerPath); err != nil {
				return result, err
			}
			result.Message = "安装包已下载，正在启动安装程序"
		}
	case ".msi":
		if runtime.GOOS != "windows" {
			return result, errors.New("当前系统不支持自动运行 MSI 安装包")
		}
		if err := startDetached("msiexec.exe", "/i", installerPath); err != nil {
			return result, err
		}
		result.Message = "安装包已下载，正在启动安装程序"
	default:
		return result, fmt.Errorf("不支持的更新资产类型: %s", ext)
	}

	result.WillRestart = true
	go func() {
		time.Sleep(500 * time.Millisecond)
		if a.ctx != nil {
			wailsRuntime.Quit(a.ctx)
			return
		}
		os.Exit(0)
	}()
	return result, nil
}

func fetchBestGithubRelease(ctx context.Context) (githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubReleaseAPI+"?per_page=10", nil)
	if err != nil {
		return githubRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ACFun-Live-Helper/"+appVersion)
	if releaseCache.etag != "" {
		req.Header.Set("If-None-Match", releaseCache.etag)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("检查 GitHub 更新失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified && releaseCache.release.TagName != "" {
		return releaseCache.release, nil
	}
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		if releaseCache.release.TagName != "" {
			return releaseCache.release, nil
		}
		return githubRelease{}, fmt.Errorf("GitHub API 请求频率超限 (HTTP %d)，请稍后再试", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return githubRelease{}, fmt.Errorf("GitHub Releases 返回 HTTP %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&releases); err != nil {
		return githubRelease{}, fmt.Errorf("解析 GitHub Releases 失败: %w", err)
	}
	var best githubRelease
	for _, release := range releases {
		if release.Draft || strings.TrimSpace(release.TagName) == "" {
			continue
		}
		if best.TagName == "" || compareVersions(release.TagName, best.TagName) > 0 {
			best = release
		}
	}
	if best.TagName == "" {
		return githubRelease{}, errors.New("GitHub Releases 中没有可用版本")
	}

	if etag := resp.Header.Get("ETag"); etag != "" {
		releaseCache.etag = etag
		releaseCache.release = best
	}
	return best, nil
}

func chooseUpdateAsset(assets []githubAsset) (githubAsset, bool) {
	type candidate struct {
		asset githubAsset
		score int
	}
	var best candidate
	for _, asset := range assets {
		name := strings.ToLower(asset.Name)
		if asset.BrowserDownloadURL == "" {
			continue
		}
		if strings.Contains(name, "source") || strings.HasSuffix(name, ".sha256") || strings.HasSuffix(name, ".sig") {
			continue
		}
		score := 0
		switch {
		case strings.HasSuffix(name, ".exe"):
			score += 100
		case strings.HasSuffix(name, ".msi"):
			score += 90
		case strings.HasSuffix(name, ".zip"):
			score += 70
		default:
			continue
		}
		if strings.Contains(name, "windows") || strings.Contains(name, "win") {
			score += 25
		}
		if strings.Contains(name, "amd64") || strings.Contains(name, "x64") || strings.Contains(name, "x86_64") {
			score += 20
		}
		if strings.Contains(name, "arm64") || strings.Contains(name, "linux") || strings.Contains(name, "darwin") || strings.Contains(name, "mac") {
			score -= 80
		}
		if score > best.score {
			best = candidate{asset: asset, score: score}
		}
	}
	return best.asset, best.score > 0
}

func canInstallAsset(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".exe", ".msi", ".zip":
		return runtime.GOOS == "windows"
	default:
		return false
	}
}

func downloadFile(ctx context.Context, rawURL string, targetPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return err
	}
	tmpPath := targetPath + ".download"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "ACFun-Live-Helper/"+appVersion)
	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("下载更新失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("下载更新返回 HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("写入更新包失败: %w", err)
	}
	if err := out.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if stat, err := os.Stat(tmpPath); err != nil {
		os.Remove(tmpPath)
		return err
	} else if stat.Size() == 0 {
		os.Remove(tmpPath)
		return errors.New("更新包为空")
	}
	os.Remove(targetPath)
	return os.Rename(tmpPath, targetPath)
}

func updateCacheDir(version string) (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "ACFun Live Helper", "updates", sanitizeUpdateFileName(version))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func extractUpdateExecutable(zipPath string, updateDir string) (string, error) {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", fmt.Errorf("打开更新 zip 失败: %w", err)
	}
	defer reader.Close()

	var selected *zip.File
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		name := strings.ToLower(filepath.Base(file.Name))
		if strings.HasSuffix(name, ".exe") && !strings.Contains(name, "uninstall") {
			selected = file
			break
		}
	}
	if selected == nil {
		return "", errors.New("更新 zip 中没有可运行的 exe")
	}

	outPath := filepath.Join(updateDir, sanitizeUpdateFileName(filepath.Base(selected.Name)))
	input, err := selected.Open()
	if err != nil {
		return "", err
	}
	defer input.Close()
	output, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		os.Remove(outPath)
		return "", err
	}
	if err := output.Close(); err != nil {
		return "", err
	}
	return outPath, nil
}

func writePortableUpdateScript(newExe string, currentExe string) (string, error) {
	dir := filepath.Dir(newExe)
	scriptPath := filepath.Join(dir, "apply-update.cmd")
	script := fmt.Sprintf(`@echo off
setlocal
set "NEW_EXE=%s"
set "TARGET_EXE=%s"
for /L %%%%i in (1,1,60) do (
  copy /Y "%%NEW_EXE%%" "%%TARGET_EXE%%" >nul 2>nul
  if not errorlevel 1 goto done
  timeout /t 1 /nobreak >nul
)
exit /b 1
:done
start "" "%%TARGET_EXE%%"
del "%%~f0"
`, newExe, currentExe)
	if err := os.WriteFile(scriptPath, []byte(script), 0o644); err != nil {
		return "", err
	}
	return scriptPath, nil
}

func startUpdateScript(scriptPath string) error {
	if runtime.GOOS != "windows" {
		return errors.New("自动替换更新当前仅支持 Windows")
	}
	return startDetached("cmd.exe", "/c", scriptPath)
}

func startDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	return cmd.Start()
}

func isDevExecutable() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	name := strings.ToLower(filepath.Base(exe))
	return strings.Contains(name, "-dev") || strings.Contains(name, "wails")
}

func looksLikePortableExecutable(name string) bool {
	lower := strings.ToLower(name)
	if !strings.HasSuffix(lower, ".exe") {
		return false
	}
	return !strings.Contains(lower, "setup") &&
		!strings.Contains(lower, "install") &&
		!strings.Contains(lower, "installer")
}

func sanitizeUpdateFileName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "update"
	}
	const forbidden = "<>:\"/\\|?*"
	mapped := strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(forbidden, r) {
			return '_'
		}
		return r
	}, name)
	mapped = strings.TrimSpace(mapped)
	if mapped == "" {
		return "update"
	}
	if len([]rune(mapped)) > 120 {
		runes := []rune(mapped)
		mapped = string(runes[:120])
	}
	return mapped
}

func compareVersions(left string, right string) int {
	l := parseVersion(left)
	r := parseVersion(right)
	maxLen := len(l.numbers)
	if len(r.numbers) > maxLen {
		maxLen = len(r.numbers)
	}
	for i := 0; i < maxLen; i++ {
		var lv, rv int
		if i < len(l.numbers) {
			lv = l.numbers[i]
		}
		if i < len(r.numbers) {
			rv = r.numbers[i]
		}
		if lv > rv {
			return 1
		}
		if lv < rv {
			return -1
		}
	}
	return comparePrerelease(l.prerelease, r.prerelease)
}

type parsedVersion struct {
	numbers    []int
	prerelease string
}

var versionPrefixRE = regexp.MustCompile(`^[^\d]*`)

func parseVersion(value string) parsedVersion {
	text := strings.TrimSpace(strings.ToLower(value))
	text = versionPrefixRE.ReplaceAllString(text, "")
	mainPart, prePart, _ := strings.Cut(text, "-")
	segments := strings.Split(mainPart, ".")
	numbers := make([]int, 0, len(segments))
	for _, segment := range segments {
		n, _ := strconv.Atoi(firstNumber(segment))
		numbers = append(numbers, n)
	}
	return parsedVersion{numbers: numbers, prerelease: prePart}
}

func firstNumber(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r < '0' || r > '9' {
			break
		}
		builder.WriteRune(r)
	}
	if builder.Len() == 0 {
		return "0"
	}
	return builder.String()
}

func comparePrerelease(left string, right string) int {
	if left == "" && right == "" {
		return 0
	}
	if left == "" {
		return 1
	}
	if right == "" {
		return -1
	}
	lParts := strings.FieldsFunc(left, func(r rune) bool { return r == '.' || r == '-' })
	rParts := strings.FieldsFunc(right, func(r rune) bool { return r == '.' || r == '-' })
	maxLen := len(lParts)
	if len(rParts) > maxLen {
		maxLen = len(rParts)
	}
	for i := 0; i < maxLen; i++ {
		if i >= len(lParts) {
			return -1
		}
		if i >= len(rParts) {
			return 1
		}
		cmp := comparePrereleasePart(lParts[i], rParts[i])
		if cmp != 0 {
			return cmp
		}
	}
	return 0
}

func comparePrereleasePart(left string, right string) int {
	ln, lErr := strconv.Atoi(left)
	rn, rErr := strconv.Atoi(right)
	if lErr == nil && rErr == nil {
		if ln > rn {
			return 1
		}
		if ln < rn {
			return -1
		}
		return 0
	}
	if lErr == nil {
		return -1
	}
	if rErr == nil {
		return 1
	}
	if left > right {
		return 1
	}
	if left < right {
		return -1
	}
	return 0
}
