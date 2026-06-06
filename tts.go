package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"

	"github.com/gorilla/websocket"
)

const (
	edgeTrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	edgeChromiumVersion    = "143.0.3650.75"
	edgeSecMSGecVersion    = "1-" + edgeChromiumVersion
	edgeOrigin             = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
)

// TTSVoice 定义声音模型，用于导出给前端选择
type TTSVoice struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Lang        string `json:"lang"`
	Provider    string `json:"provider"`
}

// 内置稳定的 Edge TTS 神经网络发音人列表
var edgeVoices = []TTSVoice{
	{Name: "zh-CN-XiaoxiaoNeural", DisplayName: "晓晓 (女声 - 活泼)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-YunxiNeural", DisplayName: "云希 (男声 - 阳光)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-YunyangNeural", DisplayName: "云扬 (男声 - 庄重)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-XiaoyiNeural", DisplayName: "晓伊 (女声 - 温柔)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-YunjianNeural", DisplayName: "云健 (男声 - 磁性)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-YunxiaNeural", DisplayName: "云夏 (童声 - 极萌)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-Liaoning-XiaobeiNeural", DisplayName: "晓北 (女声 - 东北方言)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-CN-Sichuan-YunxiNeural", DisplayName: "云希 (男声 - 四川方言)", Lang: "zh-CN", Provider: "edge"},
	{Name: "zh-HK-HiuGaaiNeural", DisplayName: "晓佳 (女声 - 粤语)", Lang: "zh-HK", Provider: "edge"},
	{Name: "zh-TW-HsiaoChenNeural", DisplayName: "晓臻 (女声 - 闽南语)", Lang: "zh-TW", Provider: "edge"},
	{Name: "ja-JP-NanamiNeural", DisplayName: "七海 (女声 - 日语)", Lang: "ja-JP", Provider: "edge"},
	{Name: "ja-JP-KeitaNeural", DisplayName: "圭太 (男声 - 日语)", Lang: "ja-JP", Provider: "edge"},
	{Name: "en-US-JennyNeural", DisplayName: "Jenny (女声 - 英语)", Lang: "en-US", Provider: "edge"},
	{Name: "en-US-GuyNeural", DisplayName: "Guy (男声 - 英语)", Lang: "en-US", Provider: "edge"},
}

// GetTTSVoices 获取可用的 TTS 发音人列表
func (a *App) GetTTSVoices() ([]TTSVoice, error) {
	voices := make([]TTSVoice, 0, len(edgeVoices))
	// 1. 添加内置的 Edge 发音人
	voices = append(voices, edgeVoices...)

	// 2. 查询本地 Windows SAPI 已安装发音人
	sapiVoices, err := querySapiVoices()
	if err == nil && len(sapiVoices) > 0 {
		voices = append(voices, sapiVoices...)
	}

	return voices, nil
}

// GenerateTTS 生成语音并返回 Base64 Data URI
func (a *App) GenerateTTS(provider string, voiceName string, text string, speed float64, volume int, pitch float64, languageHint string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("text is empty")
	}
	languageHint = strings.TrimSpace(languageHint)
	if languageHint == "" {
		languageHint = text
	}

	if provider == "sapi" {
		return a.generateSapiTTS(voiceName, text, speed, volume)
	}

	audio, err := a.generateEdgeTTS(voiceName, text, languageHint, speed, volume, pitch)
	if err == nil {
		return audio, nil
	}
	if fallback, fallbackErr := a.generateSapiTTS("", text, speed, volume); fallbackErr == nil {
		a.AppendLog(fmt.Sprintf("[TTS] Edge TTS failed, used Windows SAPI fallback: %v", err))
		return fallback, nil
	}
	return "", err
}

// generateEdgeTTS 使用微软 Edge Read Aloud 接口合成语音
func (a *App) generateEdgeTTS(voiceName string, text string, languageHint string, speed float64, volume int, pitch float64) (string, error) {
	voiceName, voiceLang := chooseEdgeVoice(voiceName, languageHint)
	ratePercent := int((speed - 1.0) * 100)
	rateStr := fmt.Sprintf("%+d%%", ratePercent)
	volumePercent := clampInt(volume-100, -100, 100)
	volumeStr := fmt.Sprintf("%+d%%", volumePercent)
	pitchPercent := int((pitch - 1.0) * 100)
	pitchStr := fmt.Sprintf("%+dHz", pitchPercent)

	connID := randomHexStr(16)
	params := url.Values{}
	params.Set("TrustedClientToken", edgeTrustedClientToken)
	params.Set("ConnectionId", connID)
	params.Set("Sec-MS-GEC", generateEdgeSecMSGec())
	params.Set("Sec-MS-GEC-Version", edgeSecMSGecVersion)
	wsURL := "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?" + params.Encode()

	header := make(http.Header)
	header.Set("Pragma", "no-cache")
	header.Set("Cache-Control", "no-cache")
	header.Set("Origin", edgeOrigin)
	header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0")
	header.Set("Accept-Encoding", "gzip, deflate, br, zstd")
	header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	dialer := websocket.Dialer{
		HandshakeTimeout:  5 * time.Second,
		EnableCompression: true,
	}

	a.AppendLog(fmt.Sprintf("[TTS] Connecting to Edge TTS: voice=%s, rate=%s", voiceName, rateStr))
	conn, _, err := dialer.Dial(wsURL, header)
	if err != nil {
		return "", fmt.Errorf("failed to connect edge tts: %w", err)
	}
	defer conn.Close()

	configPayload := map[string]any{
		"context": map[string]any{
			"synthesis": map[string]any{
				"audio": map[string]any{
					"metadataoptions": map[string]string{
						"sentenceBoundaryEnabled": "false",
						"wordBoundaryEnabled":     "false",
					},
					"outputFormat": "audio-24khz-48kbitrate-mono-mp3",
				},
			},
		},
	}
	configBytes, _ := json.Marshal(configPayload)
	configMsg := fmt.Sprintf(
		"X-Timestamp:%s\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n%s",
		edgeTimestamp(),
		string(configBytes),
	)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(configMsg)); err != nil {
		return "", fmt.Errorf("failed to send config message: %w", err)
	}

	reqID := randomHexStr(16)
	ssmlHeader := fmt.Sprintf("X-RequestId:%s\r\nX-Timestamp:%s\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n", reqID, edgeTimestamp())
	ssmlBody := fmt.Sprintf(
		"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='%s'>"+
			"<voice name='%s'>"+
			"<prosody pitch='%s' rate='%s' volume='%s'>"+
			"%s"+
			"</prosody>"+
			"</voice>"+
			"</speak>",
		html.EscapeString(voiceLang),
		html.EscapeString(voiceName),
		pitchStr,
		rateStr,
		volumeStr,
		html.EscapeString(text),
	)

	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssmlHeader+ssmlBody)); err != nil {
		return "", fmt.Errorf("failed to send ssml: %w", err)
	}

	var audioData []byte
	done := make(chan bool)
	errChan := make(chan error, 1)

	// 3. 读取响应帧
	go func() {
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}

			if msgType == websocket.TextMessage {
				msgStr := string(data)
				if strings.Contains(msgStr, "Path:turn.end") {
					close(done)
					return
				}
			} else if msgType == websocket.BinaryMessage {
				if len(data) < 2 {
					continue
				}
				// 头部长度 (BigEndian uint16)
				headerLen := int(binary.BigEndian.Uint16(data[:2]))
				if len(data) < 2+headerLen {
					continue
				}
				headerStr := string(data[2 : 2+headerLen])
				if strings.Contains(headerStr, "Path:audio") {
					audioData = append(audioData, data[2+headerLen:]...)
				}
			}
		}
	}()

	select {
	case <-done:
		if len(audioData) == 0 {
			return "", fmt.Errorf("no audio data received from edge tts")
		}
		// 返回 MP3 Base64
		base64Str := base64.StdEncoding.EncodeToString(audioData)
		return "data:audio/mp3;base64," + base64Str, nil
	case err := <-errChan:
		return "", fmt.Errorf("read websocket error: %w", err)
	case <-time.After(10 * time.Second):
		return "", fmt.Errorf("edge tts request timeout")
	}
}

// generateSapiTTS 通过 PowerShell 异步调用 System.Speech.Synthesis 进行合成
func (a *App) generateSapiTTS(voiceName string, text string, speed float64, volume int) (string, error) {
	tempDir := filepath.Join(os.TempDir(), "aclivehelper_tts")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create temp dir: %w", err)
	}

	textFilePath := filepath.Join(tempDir, fmt.Sprintf("text_%d.txt", time.Now().UnixNano()))
	wavFilePath := filepath.Join(tempDir, fmt.Sprintf("audio_%d.wav", time.Now().UnixNano()))
	scriptPath := filepath.Join(tempDir, fmt.Sprintf("sapi_%d.ps1", time.Now().UnixNano()))

	if err := os.WriteFile(textFilePath, []byte(text), 0644); err != nil {
		return "", fmt.Errorf("failed to write temp text file: %w", err)
	}
	defer os.Remove(textFilePath)
	defer os.Remove(wavFilePath)
	defer os.Remove(scriptPath)

	rate := int((speed - 1.0) * 10)
	if rate < -10 {
		rate = -10
	}
	if rate > 10 {
		rate = 10
	}
	volume = clampInt(volume, 0, 100)

	script := strings.TrimSpace(`
param(
  [Parameter(Mandatory=$true)][string]$TextPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$VoiceName = "",
  [int]$Volume = 80,
  [int]$Rate = 0
)
Add-Type -AssemblyName System.Speech
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $syn.Volume = [Math]::Min(100, [Math]::Max(0, $Volume))
  $syn.Rate = [Math]::Min(10, [Math]::Max(-10, $Rate))
  if (-not [string]::IsNullOrWhiteSpace($VoiceName)) {
    $voice = $syn.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $VoiceName } | Select-Object -First 1
    if ($voice) {
      $syn.SelectVoice($voice.VoiceInfo.Name)
    }
  }
  $text = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8
  $syn.SetOutputToWaveFile($OutputPath)
  $syn.Speak($text) | Out-Null
} finally {
  $syn.Dispose()
}
`)
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return "", fmt.Errorf("failed to write sapi script: %w", err)
	}

	cmd := exec.Command(
		powerShellExecutable(),
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
		"-TextPath",
		textFilePath,
		"-OutputPath",
		wavFilePath,
		"-VoiceName",
		voiceName,
		"-Volume",
		strconv.Itoa(volume),
		"-Rate",
		strconv.Itoa(rate),
	)
	hideWindow(cmd)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("powershell execution failed: %v, output: %s", err, string(output))
	}

	// 读取生成的 wav 文件
	audioBytes, err := os.ReadFile(wavFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to read generated wav file: %w", err)
	}

	if len(audioBytes) == 0 {
		return "", fmt.Errorf("generated wav file is empty")
	}

	base64Str := base64.StdEncoding.EncodeToString(audioBytes)
	return "data:audio/wav;base64," + base64Str, nil
}

// querySapiVoices 调用 PowerShell 探测系统已安装的 SAPI 发音人列表
func querySapiVoices() ([]TTSVoice, error) {
	psCmd := "Add-Type -AssemblyName System.Speech; " +
		"$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
		"$list = @(); " +
		"foreach ($v in $syn.GetInstalledVoices()) { " +
		"  if ($v.Enabled) { " +
		"    $list += @{ name = $v.VoiceInfo.Name; displayName = $v.VoiceInfo.Name; lang = $v.VoiceInfo.Culture.Name; provider = 'sapi' } " +
		"  } " +
		"}; " +
		"if ($list.Count -gt 0) { $list | ConvertTo-Json -Compress } else { '[]' }"

	cmd := exec.Command(powerShellExecutable(), "-NoProfile", "-NonInteractive", "-Command", psCmd)
	hideWindow(cmd)

	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	dataStr := strings.TrimSpace(string(output))
	if dataStr == "" || dataStr == "[]" || dataStr == "null" {
		return nil, nil
	}

	// 兼容处理：如果是单个发音人，ConvertTo-Json 可能会输出单个对象而不是数组
	if strings.HasPrefix(dataStr, "{") {
		var item TTSVoice
		if err := json.Unmarshal([]byte(dataStr), &item); err != nil {
			return nil, err
		}
		return []TTSVoice{item}, nil
	}

	var list []TTSVoice
	if err := json.Unmarshal([]byte(dataStr), &list); err != nil {
		return nil, err
	}

	return list, nil
}

func chooseEdgeVoice(voiceName string, text string) (string, string) {
	targetLang := detectTTSLang(text)
	currentLang := edgeVoiceLang(voiceName)
	if voiceName != "" && (currentLang == targetLang || languageFamily(currentLang) == languageFamily(targetLang)) {
		return voiceName, currentLang
	}
	switch targetLang {
	case "ja-JP":
		return "ja-JP-NanamiNeural", "ja-JP"
	case "en-US":
		return "en-US-JennyNeural", "en-US"
	default:
		if voiceName != "" && currentLang != "" {
			return voiceName, currentLang
		}
		return "zh-CN-XiaoxiaoNeural", "zh-CN"
	}
}

func edgeVoiceLang(voiceName string) string {
	for _, voice := range edgeVoices {
		if voice.Name == voiceName {
			return voice.Lang
		}
	}
	if len(voiceName) >= 5 && voiceName[2] == '-' {
		return voiceName[:5]
	}
	return ""
}

func languageFamily(lang string) string {
	if idx := strings.IndexByte(lang, '-'); idx > 0 {
		return lang[:idx]
	}
	return lang
}

func detectTTSLang(text string) string {
	var kanaCount int
	var hanCount int
	var latinCount int
	var letterCount int
	var cjkLetterCount int
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			kanaCount++
			letterCount++
			cjkLetterCount++
		case unicode.In(r, unicode.Han):
			hanCount++
			letterCount++
			cjkLetterCount++
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
			latinCount++
			letterCount++
		case unicode.IsLetter(r):
			letterCount++
		}
	}
	if kanaCount > 0 && (cjkLetterCount <= 12 || kanaCount*3 >= cjkLetterCount || kanaCount >= 3) {
		return "ja-JP"
	}
	if letterCount > 0 && latinCount*3 >= letterCount*2 && hanCount == 0 && kanaCount == 0 {
		return "en-US"
	}
	return "zh-CN"
}

func powerShellExecutable() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	if path, err := exec.LookPath("pwsh"); err == nil {
		return path
	}
	return "powershell"
}

func edgeTimestamp() string {
	return time.Now().UTC().Format("Mon Jan 02 2006 15:04:05 GMT-0700 (Coordinated Universal Time)")
}

func generateEdgeSecMSGec() string {
	const windowsEpochSeconds int64 = 11644473600
	now := time.Now().Unix()
	ticks := now + windowsEpochSeconds
	ticks -= ticks % 300
	fileTimeTicks := ticks * 10000000
	payload := strconv.FormatInt(fileTimeTicks, 10) + edgeTrustedClientToken
	hash := sha256.Sum256([]byte(payload))
	return strings.ToUpper(hex.EncodeToString(hash[:]))
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// randomHexStr 生成 n 字节的随机 hex 字符串
func randomHexStr(n int) string {
	bytes := make([]byte, n)
	if _, err := rand.Read(bytes); err != nil {
		// 读随机数失败时使用时间戳的 md5 兜底
		return "6a5aa1d4eaff4e9b87e7efd3e4e8d3b1"
	}
	return hex.EncodeToString(bytes)
}

// hideWindow 隐藏子进程窗口 (Windows 平台)
func hideWindow(cmd *exec.Cmd) {
	// 在 Windows 平台下隐藏命令控制台窗口
	// syscall.CREATE_NO_WINDOW = 0x08000000
	if runtime.GOOS != "windows" {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000,
	}
}
