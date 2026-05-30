import { LegacyDanmuTypes } from "@/services/acfunBackend"
import { reactive, ref, watch } from "vue"
import { isMiniMode } from "@/services/nativeBridge"

const synth = window.speechSynthesis;

export const ttsSettings = reactive({
  enabled: true,         // 全局开关
  readDanmaku: true,     // 播报普通发言
  readGift: true,        // 播报送礼
  readFollow: true,      // 播报关注
  readJoinRoom: false,   // 播报进入
  rate: 1.2,             // 语速
  volume: 1.0,           // 音量
  pitch: 1.0,            // 音调
  selectedLang: "",      // 选中的语言
  selectedVoiceName: "", // 选中的发音人
});


let isMiniWindow = false;

// 自动检测当前窗口环境
if (typeof window !== 'undefined') {
  isMiniMode().then((isMini) => {
    isMiniWindow = isMini;
    if (isMini) {
      // 如果是 mini 窗口，强行关闭并屏蔽 TTS 播报
      ttsSettings.enabled = false;
      console.log("[TTS Debug] 检测到当前处于 /mini 独立弹幕窗，TTS 播报已静音拦截。");
    }
  }).catch((err) => {
    console.error("[TTS Debug] 检测 mini 窗口模式失败:", err);
  });
}

export const uniqueLangs = ref([]);
export const filteredVoices = ref([]);

export function updateVoices() {
  if (!synth) return;
  const all = synth.getVoices();
  console.log("[TTS Debug] 系统原始声音列表:", all);

  const allLangs = Array.from(new Set(all.map(v => v.lang)));

  const isChineseLang = (lang) => {
    const l = lang.toLowerCase();
    return l.includes('zh') || l.includes('cn') || l.includes('cmn') || l.includes('yue');
  };

  const chineseLangs = allLangs.filter(isChineseLang).sort((a, b) => a.localeCompare(b));
  const otherLangs = allLangs.filter(lang => !isChineseLang(lang)).sort((a, b) => a.localeCompare(b));

  uniqueLangs.value = [...chineseLangs, ...otherLangs];
  console.log("[TTS Debug] 系统语言代码列表:", uniqueLangs.value);

  if (!ttsSettings.selectedLang && uniqueLangs.value.length > 0) {
    // 优先匹配 cmn 或 zh-CN
    const defaultLang = uniqueLangs.value.find(lang => {
      const l = lang.toLowerCase();
      return l.includes('cmn') || l.includes('zh-cn');
    }) || chineseLangs[0] || uniqueLangs.value[0];

    ttsSettings.selectedLang = defaultLang;
  }

  syncVoicesForSelectedLang();
}

export function syncVoicesForSelectedLang() {
  if (!synth) return;
  const all = synth.getVoices();

  filteredVoices.value = all.filter(v => v.lang === ttsSettings.selectedLang);

  const voiceExists = filteredVoices.value.some(v => v.name === ttsSettings.selectedVoiceName);
  if (!voiceExists && filteredVoices.value.length > 0) {
    ttsSettings.selectedVoiceName = filteredVoices.value[0].name;
  }
}

watch(() => ttsSettings.selectedLang, () => {
  syncVoicesForSelectedLang();
});

if (synth) {
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = updateVoices;
  }
  updateVoices();
}

let queue = [];
let isSpeaking = false;

function playNext() {
  console.log(`[TTS Debug] playNext 启动。当前队列长度: ${queue.length}, 播放状态(isSpeaking): ${isSpeaking}`);

  if (!synth || queue.length === 0) {
    console.log("[TTS Debug] 播报结束或未加载引擎，释放状态。");
    isSpeaking = false;
    return;
  }

  isSpeaking = true;
  const text = queue.shift();
  console.log(`[TTS Debug] 正在提取队列文本开始播报 -> "${text}"`);

  const utterance = new SpeechSynthesisUtterance(text);

  const allVoices = synth.getVoices();
  let voice = allVoices.find(v => v.name === ttsSettings.selectedVoiceName && v.lang === ttsSettings.selectedLang);

  if (!voice) {
    voice = allVoices.find(v => {
      const lang = v.lang.toLowerCase();
      const name = v.name.toLowerCase();
      return lang.includes('cmn') || lang.includes('zh') || lang.includes('cn') || name.includes('chinese');
    });
  }

  if (voice) {
    console.log(`[TTS Debug] 实际调用发音人: "${voice.name}" [${voice.lang}]`);
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    console.warn("[TTS Debug] 未匹配到任何发音人，将使用系统默认 zh-CN 进行 fallback 播放。");
    utterance.lang = 'zh-CN';
  }

  utterance.rate = ttsSettings.rate;
  utterance.volume = ttsSettings.volume;
  utterance.pitch = ttsSettings.pitch;

  utterance.onstart = () => {
    console.log(`[TTS Debug] 浏览器底层已接收：正在读出 -> "${text}"`);
  };

  utterance.onend = () => {
    console.log("[TTS Debug] 浏览器播放完毕。");
    playNext();
  };

  utterance.onerror = (e) => {
    console.error("[TTS Debug] 底层播放报错，报错原因:", e);
    playNext();
  };

  synth.speak(utterance);
}

export function speak(text) {

  if (isMiniWindow) {
    return;
  }

  console.log(`[TTS Debug] speak() 接收到待播报原始请求: "${text}"`);

  if (!ttsSettings.enabled) {
    console.log("[TTS Debug] 全局启用开关(enabled)当前为 FALSE，已拦截此播放请求。");
    return;
  }

  if (!text) {
    console.log("[TTS Debug] 文本内容为空，已忽略。");
    return;
  }

  console.log(`[TTS Debug] 正在将 "${text}" 加入播放队列...`);
  queue.push(text);

  if (!isSpeaking) {
    playNext();
  } else {
    console.log("[TTS Debug] 当前正在播报其他内容，已加入排队序列中。");
  }
}

export function stopAll() {
  queue = [];
  if (synth) {
    synth.cancel();
  }
  isSpeaking = false;
  console.log("[TTS Debug] 播放已手动中止，队列已清空");
}
export function handleTtsDanmaku(item) {
  console.log("[TTS Debug] handleTtsDanmaku 收到弹幕分发对象:", item);

  if (!ttsSettings.enabled) {
    console.log("[TTS Debug] 全局播报开关关闭，拦截该弹幕处理。");
    return;
  }

  const nickname = item.nickname || "观众";
  let speakText = "";

  if (item.isGift) {
    // 1. 送礼场景 (只要 isGift 属性为 true 即判定为礼物)
    if (!ttsSettings.readGift) {
      console.log("[TTS Debug] 播报礼物选项未勾选，已忽略。");
      return;
    }
    speakText = `感谢 ${nickname} 送的 ${item.num} 个 ${item.content}`;
  } else if (item.type === LegacyDanmuTypes.ADD_TEXT) {
    // 2. 普通文字弹幕 (类型代码 2)
    if (!ttsSettings.readDanmaku) {
      console.log("[TTS Debug] 播报弹幕选项未勾选，已忽略。");
      return;
    }
    speakText = `${nickname}说：${item.content}`;
  } else if (item.type === LegacyDanmuTypes.ADD_FOLLOW) {
    // 3. 关注主播
    if (!ttsSettings.readFollow) {
      console.log("[TTS Debug] 播报关注选项未勾选，已忽略。");
      return;
    }
    speakText = `感谢 ${nickname} 关注主播`;
  } else if (item.type === LegacyDanmuTypes.JOIN_ROOM) {
    // 4. 进入直播间
    if (!ttsSettings.readJoinRoom) {
      console.log("[TTS Debug] 播报进入直播间选项未勾选，已忽略。");
      return;
    }
    speakText = `欢迎 ${nickname} 进入直播间`;
  } else if (item.type === LegacyDanmuTypes.ADD_JOIN_GROUP) {
    // 5. 加入守护团/粉丝团
    if (!ttsSettings.readFollow) {
      console.log("[TTS Debug] 播报加入粉丝团选项未勾选，已忽略。");
      return;
    }
    speakText = `感谢 ${nickname} 加入守护团`;
  } else {
    console.log(`[TTS Debug] 未知/未支持的弹幕类型: ${item.type}，已忽略。`);
  }

  if (speakText) {
    speak(speakText);
  }
}
