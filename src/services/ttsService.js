import { generateTTS } from "./nativeBridge"
import { BackendDanmuTypes } from "./acfunBackend"
import { aIslandEmotes } from "@/assets/previewData.js"

const COMMENT_TYPES = new Set([
  BackendDanmuTypes.COMMENT,
  BackendDanmuTypes.RICH_TEXT,
])

const GIFT_TYPES = new Set([
  BackendDanmuTypes.GIFT,
  BackendDanmuTypes.THROW_BANANA,
])

const EMOJI_READINGS = new Map([
  ["😂", "笑哭"],
  ["🤣", "笑哭"],
  ["😀", "笑脸"],
  ["😃", "笑脸"],
  ["😄", "笑脸"],
  ["😁", "笑脸"],
  ["😆", "大笑"],
  ["😅", "尴尬笑"],
  ["😇", "天使笑"],
  ["🙂", "微笑"],
  ["🙃", "倒脸"],
  ["😉", "眨眼"],
  ["😊", "微笑"],
  ["😌", "安心"],
  ["😍", "喜欢"],
  ["🥰", "喜欢"],
  ["😘", "亲亲"],
  ["😗", "亲亲"],
  ["😙", "亲亲"],
  ["😚", "亲亲"],
  ["😋", "可爱"],
  ["😛", "吐舌"],
  ["😜", "调皮"],
  ["😝", "吐舌"],
  ["🤑", "财迷"],
  ["🤗", "抱抱"],
  ["🤭", "偷笑"],
  ["🤫", "嘘"],
  ["🤔", "思考"],
  ["🤐", "闭嘴"],
  ["🤨", "疑惑"],
  ["😐", "无语"],
  ["😑", "无语"],
  ["😶", "沉默"],
  ["😏", "坏笑"],
  ["😒", "不屑"],
  ["🙄", "翻白眼"],
  ["😬", "龇牙"],
  ["🤥", "说谎"],
  ["😔", "失落"],
  ["😪", "困"],
  ["🤤", "流口水"],
  ["😴", "睡觉"],
  ["😷", "口罩"],
  ["🤒", "发烧"],
  ["🤕", "受伤"],
  ["🤢", "恶心"],
  ["🤮", "呕吐"],
  ["🤧", "打喷嚏"],
  ["🥵", "热"],
  ["🥶", "冷"],
  ["🥴", "晕"],
  ["😵", "晕"],
  ["🤯", "爆炸头"],
  ["🤠", "牛仔"],
  ["🥳", "庆祝"],
  ["🥸", "伪装"],
  ["😎", "酷"],
  ["😭", "大哭"],
  ["😢", "哭"],
  ["🥺", "委屈"],
  ["😞", "难过"],
  ["😟", "担心"],
  ["😕", "困惑"],
  ["🙁", "不开心"],
  ["☹", "不开心"],
  ["😣", "忍耐"],
  ["😖", "难受"],
  ["😫", "累"],
  ["😩", "累"],
  ["😤", "生气"],
  ["😡", "生气"],
  ["😠", "生气"],
  ["🤬", "愤怒"],
  ["😱", "震惊"],
  ["😨", "害怕"],
  ["😰", "冷汗"],
  ["😥", "失望"],
  ["😓", "汗"],
  ["😮", "惊讶"],
  ["😯", "惊讶"],
  ["😲", "惊讶"],
  ["😳", "脸红"],
  ["🥹", "感动"],
  ["😺", "猫笑脸"],
  ["😸", "猫笑脸"],
  ["😹", "猫笑哭"],
  ["😻", "猫喜欢"],
  ["😼", "猫坏笑"],
  ["😽", "猫亲亲"],
  ["🙀", "猫震惊"],
  ["😿", "猫哭"],
  ["😾", "猫生气"],
  ["🙈", "捂眼"],
  ["🙉", "捂耳"],
  ["🙊", "捂嘴"],
  ["👋", "挥手"],
  ["🤚", "举手"],
  ["🖐", "举手"],
  ["✋", "举手"],
  ["🖖", "瓦肯举手"],
  ["👌", "好的"],
  ["🤌", "捏手指"],
  ["🤏", "一点点"],
  ["✌", "胜利"],
  ["🤞", "好运"],
  ["🫰", "比心"],
  ["🤟", "爱你"],
  ["🤘", "摇滚"],
  ["🤙", "打电话"],
  ["👈", "左指"],
  ["👉", "右指"],
  ["👆", "上指"],
  ["👇", "下指"],
  ["☝", "上指"],
  ["✊", "拳头"],
  ["👊", "拳头"],
  ["🤛", "左拳"],
  ["🤜", "右拳"],
  ["👍", "点赞"],
  ["👎", "倒赞"],
  ["🙏", "拜托"],
  ["👏", "鼓掌"],
  ["🙌", "欢呼"],
  ["👐", "张手"],
  ["🤲", "捧手"],
  ["🤝", "握手"],
  ["✍", "写字"],
  ["❤", "爱心"],
  ["🧡", "橙色爱心"],
  ["💛", "黄色爱心"],
  ["💚", "绿色爱心"],
  ["💙", "蓝色爱心"],
  ["💜", "紫色爱心"],
  ["🖤", "黑色爱心"],
  ["🤍", "白色爱心"],
  ["🤎", "棕色爱心"],
  ["💗", "爱心"],
  ["💖", "闪亮爱心"],
  ["💘", "一箭穿心"],
  ["💝", "礼物爱心"],
  ["💞", "旋转爱心"],
  ["💓", "心跳"],
  ["💟", "爱心"],
  ["❣", "爱心感叹"],
  ["💕", "爱心"],
  ["💔", "心碎"],
  ["❤‍🔥", "火热爱心"],
  ["❤‍🩹", "修补爱心"],
  ["✨", "闪光"],
  ["⭐", "星星"],
  ["🌟", "发光星星"],
  ["💫", "星星转圈"],
  ["💥", "爆炸"],
  ["💢", "生气符号"],
  ["💦", "汗水"],
  ["💨", "飞走"],
  ["💤", "睡觉"],
  ["🔥", "火"],
  ["🎉", "庆祝"],
  ["🎊", "彩带"],
  ["🎁", "礼物"],
  ["🎂", "蛋糕"],
  ["🏆", "奖杯"],
  ["🏅", "奖牌"],
  ["✅", "正确"],
  ["☑", "勾选"],
  ["✔", "对勾"],
  ["❌", "错误"],
  ["✖", "叉"],
  ["⭕", "圆圈"],
  ["❗", "感叹号"],
  ["❓", "问号"],
  ["‼", "双感叹号"],
  ["⁉", "感叹问号"],
  ["⚠", "警告"],
  ["💯", "满分"],
  ["🔞", "十八禁"],
  ["🎵", "音乐"],
  ["🎶", "音乐"],
  ["🔔", "铃铛"],
  ["🔕", "静音铃铛"],
  ["📢", "喇叭"],
  ["📣", "喊话"],
  ["💡", "灯泡"],
  ["🔒", "锁"],
  ["🔓", "开锁"],
  ["🔑", "钥匙"],
  ["💰", "钱袋"],
  ["💸", "飞钱"],
  ["💎", "钻石"],
  ["☀", "太阳"],
  ["🌙", "月亮"],
  ["☁", "云"],
  ["🌧", "下雨"],
  ["⛄", "雪人"],
  ["⚡", "闪电"],
  ["🌈", "彩虹"],
  ["🍎", "苹果"],
  ["🍉", "西瓜"],
  ["🍓", "草莓"],
  ["🍔", "汉堡"],
  ["🍟", "薯条"],
  ["🍕", "披萨"],
  ["🍜", "面条"],
  ["🍚", "米饭"],
  ["🍰", "蛋糕"],
  ["☕", "咖啡"],
  ["🍺", "啤酒"],
  ["🍻", "干杯"],
  ["🥂", "干杯"],
  ["👑", "皇冠"],
  ["💻", "电脑"],
  ["📱", "手机"],
  ["🎮", "游戏手柄"],
  ["🚀", "火箭"],
  ["🚗", "汽车"],
  ["✈", "飞机"],
  ["🏠", "房子"],
  ["👨‍👩‍👧‍👦", "家庭"],
  ["👨‍💻", "程序员"],
  ["👩‍💻", "程序员"],
])

const FALLBACK_KAOMOJI_REGEX = /(?:\b(?:orz|OTL)\b|[（(][^()\n]{0,30}[ωΩДд∀▽△◇□■★☆´｀'`^＾;；=≧≦><･・ﾟ°︵益╥﹏_っつノﾉヽヾ][^()\n]{0,30}[）)]|[ヽヾ][^\s\n]{0,30}[ﾉノ])/giu
const EMOJI_MODIFIER_REGEX = /[\u{1f3fb}-\u{1f3ff}]/gu
const EMOJI_SEQUENCE_REGEX = /\p{Extended_Pictographic}(?:[\ufe0e\ufe0f]|[\u{1f3fb}-\u{1f3ff}])*(?:\u200d\p{Extended_Pictographic}(?:[\ufe0e\ufe0f]|[\u{1f3fb}-\u{1f3ff}])*)*/gu
const EMOJI_FLAG_REGEX = /[\u{1f1e6}-\u{1f1ff}]{2}/gu
const EMOJI_KEYCAP_REGEX = /[0-9#*]\ufe0f?\u20e3/gu
const TTS_CONTROL_CHARS_REGEX = /[\u200b-\u200d\ufe0e\ufe0f]/gu
const A_ISLAND_HIDE_TAG_REGEX = /\[h\][\s\S]*?\[\/h\]/giu

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const A_ISLAND_EMOTE_PATTERNS = [...aIslandEmotes]
  .filter(Boolean)
  .sort((a, b) => Array.from(b).length - Array.from(a).length)
  .map((emote) => ({
    regex: new RegExp(escapeRegExp(emote), "gu"),
    reading: "颜文字",
  }))

function normalizeEmojiKey(value) {
  return String(value || "")
    .replace(/[\ufe0e\ufe0f]/g, "")
    .replace(EMOJI_MODIFIER_REGEX, "")
}

function emojiCategoryReading(emoji) {
  const code = normalizeEmojiKey(emoji).codePointAt(0)
  if (!code) {
    return "图标"
  }
  if ((code >= 0x1f600 && code <= 0x1f64f) || (code >= 0x1f900 && code <= 0x1f9ff)) {
    return "表情图标"
  }
  if (code >= 0x1f680 && code <= 0x1f6ff) {
    return "交通工具"
  }
  if ((code >= 0x2600 && code <= 0x27bf) || (code >= 0x1f700 && code <= 0x1f8ff)) {
    return "符号"
  }
  if ((code >= 0x1f300 && code <= 0x1f5ff) || (code >= 0x1fa70 && code <= 0x1faff)) {
    return "图标"
  }
  return "图标"
}

function readEmoji(value) {
  const key = normalizeEmojiKey(value)
  if (EMOJI_READINGS.has(key)) {
    return EMOJI_READINGS.get(key)
  }
  return emojiCategoryReading(key)
}

function normalizeTtsText(value) {
  let text = String(value || "")
    .replace(A_ISLAND_HIDE_TAG_REGEX, " 防剧透 ")
  A_ISLAND_EMOTE_PATTERNS.forEach(({ regex, reading }) => {
    text = text.replace(regex, ` ${reading} `)
  })
  return text
    .replace(FALLBACK_KAOMOJI_REGEX, " 颜文字 ")
    .replace(EMOJI_FLAG_REGEX, " 旗帜 ")
    .replace(EMOJI_KEYCAP_REGEX, " 按键 ")
    .replace(EMOJI_SEQUENCE_REGEX, (emoji) => ` ${readEmoji(emoji)} `)
    .replace(TTS_CONTROL_CHARS_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateTtsText(text, maxLength) {
  const chars = Array.from(text)
  if (chars.length <= maxLength) {
    return text
  }
  return `${chars.slice(0, maxLength).join("")}，内容超长`
}

function isKana(char) {
  const code = char.codePointAt(0)
  return (code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff) || (code >= 0xff66 && code <= 0xff9f)
}

function isLatin(char) {
  return /^[A-Za-z]$/.test(char)
}

function isHan(char) {
  return /\p{Script=Han}/u.test(char)
}

function isLetter(char) {
  return /\p{L}/u.test(char)
}

function detectTtsLang(text) {
  let kanaCount = 0
  let hanCount = 0
  let latinCount = 0
  let letterCount = 0
  let cjkLetterCount = 0

  Array.from(String(text || "")).forEach((char) => {
    if (isKana(char)) {
      kanaCount += 1
      letterCount += 1
      cjkLetterCount += 1
      return
    }
    if (isHan(char)) {
      hanCount += 1
      letterCount += 1
      cjkLetterCount += 1
      return
    }
    if (isLatin(char)) {
      latinCount += 1
      letterCount += 1
      return
    }
    if (isLetter(char)) {
      letterCount += 1
    }
  })

  if (kanaCount > 0 && (cjkLetterCount <= 12 || kanaCount * 3 >= cjkLetterCount || kanaCount >= 3)) {
    return "ja-JP"
  }
  if (letterCount > 0 && latinCount * 3 >= letterCount * 2 && hanCount === 0 && kanaCount === 0) {
    return "en-US"
  }
  return "zh-CN"
}

function isAsciiNickname(text) {
  return /^[A-Za-z0-9]+$/.test(String(text || "")) && /[A-Za-z]/.test(String(text || ""))
}

function detectNicknameTtsLang(text) {
  if (isAsciiNickname(text)) {
    return "zh-CN"
  }
  return detectTtsLang(text)
}

function nicknameLanguageHint(text) {
  return isAsciiNickname(text) ? "中文昵称" : text
}

function buildDanmakuSegments(text, item, settings) {
  if (!settings.includeNickname || !item.nickname) {
    return [{ text, languageHint: text }]
  }

  const cleanNickname = item.nickname.replace(/[^\u4e00-\u9fa5\u3040-\u30ffa-zA-Z0-9]/g, "").substring(0, 12)
  if (!cleanNickname) {
    return [{ text, languageHint: text }]
  }

  const nicknameLang = detectNicknameTtsLang(cleanNickname)
  const textLang = detectTtsLang(text)
  if (nicknameLang !== textLang) {
    return [
      { text: `${cleanNickname}，`, languageHint: nicknameLanguageHint(cleanNickname) },
      { text, languageHint: text },
    ]
  }

  return [{ text: `${cleanNickname}，${text}`, languageHint: text }]
}

class TTSService {
  constructor() {
    this.queue = []
    this.isPlaying = false
    this.isGenerating = false
    this.currentAudio = null
    this.generationToken = 0
  }

  // 接收弹幕并过滤、装配、入队
  speakDanmaku(item, settings, context = {}) {
    if (!settings || !settings.enabled) {
      return
    }

    const sourceType = Number(context.sourceType || 0)
    if (COMMENT_TYPES.has(sourceType)) {
      if (!settings.readComment) {
        return
      }
    } else if (GIFT_TYPES.has(sourceType)) {
      if (!settings.readGift) {
        return
      }
    } else {
      return
    }

    // 1. 过滤自己发送的弹幕
    if (item.self) {
      return
    }

    if (Array.isArray(context.blockList) && context.blockList.some((blocked) => Number(blocked.userId) === Number(item.userId))) {
      return
    }

    // 2. 文本规范化：把 emoji / 颜文字转成可朗读词，避免合成器直接静音跳过。
    let text = normalizeTtsText(item.content)
    if (!text) {
      return
    }

    // 3. 超长内容截断
    const maxLength = Number(settings.maxLength) || 50
    text = truncateTtsText(text, maxLength)

    // 4. 组装朗读片段：昵称和正文语言不同时分段，避免日文昵称把中文弹幕带成日语。
    const segments = buildDanmakuSegments(text, item, settings)

    // 5. 队列溢出控制 (爆量丢弃最旧，保持时效性)
    const limit = Number(settings.queueLimit) || 5
    if (this.queue.length >= limit) {
      this.queue.shift()
    }

    this.queue.push({
      segments,
      settings: { ...settings }
    })

    this.triggerPlay()
  }

  triggerPlay() {
    if (this.isPlaying || this.isGenerating) {
      return
    }
    this.playNext()
  }

  async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false
      return
    }

    const item = this.queue.shift()
    const token = this.generationToken
    const segments = Array.isArray(item.segments) && item.segments.length
      ? item.segments
      : [{ text: item.text, languageHint: item.languageHint || item.text }]

    await this.prepareAndPlaySegments(item, segments, token)
  }

  async prepareAndPlaySegments(item, segments, token) {
    if (token !== this.generationToken) {
      return
    }

    this.isGenerating = true

    const audioPromises = segments.map((segment) => this.generateSegmentAudio(item, segment))
    await this.playAudioPromises(audioPromises, 0, token)
  }

  async generateSegmentAudio(item, segment) {
    try {
      // 后端合成音频并返回 base64 URI
      const base64Uri = await generateTTS(
        item.settings.provider,
        item.settings.voiceName,
        segment.text,
        item.settings.speed,
        item.settings.volume,
        item.settings.pitch || 1.0,
        segment.languageHint || segment.text
      )
      if (!base64Uri) {
        return null
      }
      const audio = new Audio(base64Uri)
      audio.preload = "auto"
      audio.volume = (Number(item.settings.volume) || 80) / 100
      audio.load()
      return { audio, segment }
    } catch (e) {
      console.error("[TTS] 片段生成失败:", e)
      return null
    }
  }

  async playAudioPromises(audioPromises, index, token) {
    if (token !== this.generationToken) {
      return
    }

    if (index >= audioPromises.length) {
      this.isPlaying = false
      this.isGenerating = false
      this.currentAudio = null
      this.playNext()
      return
    }

    const audioItem = await audioPromises[index]
    if (token !== this.generationToken) {
      return
    }

    this.isGenerating = false

    if (!audioItem) {
      this.playAudioPromises(audioPromises, index + 1, token)
      return
    }

    const { audio } = audioItem
    this.isPlaying = true
    this.currentAudio = audio

    audio.onended = () => {
      if (this.currentAudio === audio) {
        this.currentAudio = null
      }
      this.playAudioPromises(audioPromises, index + 1, token)
    }

    audio.onerror = (e) => {
      console.error("[TTS] 播放音频失败:", e)
      if (this.currentAudio === audio) {
        this.currentAudio = null
      }
      this.playAudioPromises(audioPromises, index + 1, token)
    }

    try {
      await audio.play()
    } catch (e) {
      console.error("[TTS] 播放音频失败:", e)
      if (this.currentAudio === audio) {
        this.currentAudio = null
      }
      this.playAudioPromises(audioPromises, index + 1, token)
    }
  }

  // 停止朗读并清空播放队列
  stop() {
    this.generationToken += 1
    this.queue = []
    this.isPlaying = false
    this.isGenerating = false
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
      } catch (e) {
        // ignore
      }
      this.currentAudio = null
    }
  }

  // 试听测试接口
  async test(settings, customText) {
    this.stop()

    const testText = normalizeTtsText(customText) || "你好，这只是一条弹幕语音测试，欢迎使用！"
    let speakText = testText
    if (settings.includeNickname) {
      speakText = `测试主播说：${testText}`
    }

    this.isGenerating = true
    const token = this.generationToken
    try {
      const base64Uri = await generateTTS(
        settings.provider,
        settings.voiceName,
        speakText,
        settings.speed,
        settings.volume,
        settings.pitch || 1.0,
        testText
      )
      if (token !== this.generationToken) {
        return
      }
      this.isGenerating = false

      if (!base64Uri) {
        return
      }

      this.isPlaying = true
      this.currentAudio = new Audio(base64Uri)
      this.currentAudio.volume = (Number(settings.volume) || 80) / 100

      this.currentAudio.onended = () => {
        this.isPlaying = false
        this.currentAudio = null
      }
      this.currentAudio.onerror = () => {
        this.isPlaying = false
        this.currentAudio = null
      }

      await this.currentAudio.play()
    } catch (e) {
      console.error("[TTS] 试听失败:", e)
      this.isGenerating = false
      this.isPlaying = false
    }
  }
}

export const ttsService = new TTSService()
export default ttsService
