package main

import "testing"

func TestDetectTTSLangJapaneseNames(t *testing.T) {
	tests := []string{
		"雪ノ下雪乃",
		"戦場ヶ原ひたぎ",
		"アリス",
		"雪ノ下雪乃，こんにちは",
	}
	for _, text := range tests {
		if got := detectTTSLang(text); got != "ja-JP" {
			t.Fatalf("detectTTSLang(%q) = %s, want ja-JP", text, got)
		}
	}
}

func TestChooseEdgeVoiceUsesLanguageHint(t *testing.T) {
	voiceName, lang := chooseEdgeVoice("zh-CN-XiaoxiaoNeural", "今天是中文弹幕")
	if voiceName != "zh-CN-XiaoxiaoNeural" || lang != "zh-CN" {
		t.Fatalf("chooseEdgeVoice chinese hint = (%s, %s), want zh-CN-XiaoxiaoNeural zh-CN", voiceName, lang)
	}

	voiceName, lang = chooseEdgeVoice("zh-CN-XiaoxiaoNeural", "こんにちは")
	if voiceName != "ja-JP-NanamiNeural" || lang != "ja-JP" {
		t.Fatalf("chooseEdgeVoice japanese hint = (%s, %s), want ja-JP-NanamiNeural ja-JP", voiceName, lang)
	}
}

func TestDetectTTSLangChineseWithOccasionalKana(t *testing.T) {
	text := "今天直播间大家都在说の但是主要还是中文内容"
	if got := detectTTSLang(text); got != "zh-CN" {
		t.Fatalf("detectTTSLang(%q) = %s, want zh-CN", text, got)
	}
}
