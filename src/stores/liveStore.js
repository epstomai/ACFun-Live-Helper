import { defineStore } from "pinia"
import {
  acfunBackend,
  BackendDanmuTypes,
  BackendTypes,
  LegacyDanmuTypes,
  mapBackendDanmuMessage,
  normalizeGuardianList,
  normalizeManager,
  normalizeWatchingUser,
} from "@/services/acfunBackend"
import { ObsWebSocketClient } from "@/services/obsWebSocket"
import { appendLog as appendNativeLog, readCoverFile, saveCoverImage } from "@/services/nativeBridge"
import { ttsService } from "@/services/ttsService"


const STORAGE_KEY = "aclivehelper.state.v1"
let obsClient = null
let obsClientKey = ""
let obsClientUnsubscribers = []
let obsObservedStreaming = false
let obsPreserveRestoreOnClose = false
let liveTimelineSampler = null
const LIVE_TIMELINE_SAMPLE_INTERVAL_MS = 60000
const GIFT_STATS_FULL_PAGE_LIMIT = 300
const GIFT_STATS_AUTO_PAGE_LIMIT = 50
const GIFT_STATS_AUTO_RECORD_LIMIT = 2000
const GIFT_STATS_AUTO_TIME_LIMIT_MS = 8000
const INTERACTION_HISTORY_LIMIT = 30
const INTERACTION_SONG_QUEUE_LIMIT = 100
const INTERACTION_RECENT_LIMIT = 80
const INTERACTION_SONG_PER_USER_LIMIT = 20
const INTERACTION_ADMIN_PREVIEW_LIMIT = 50
const INTERACTION_SONG_PREPLAY_LIMIT = 100
const SONG_REQUEST_OBS_MODES = new Set(["vinylPortrait"])

function minuteEndTimestamp(timestamp) {
  return Math.floor(Number(timestamp || Date.now()) / 60000) * 60000 + 59999
}

function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
  } catch {
    return {}
  }
}

function amountValue(value) {
  if (value === undefined || value === null) {
    return 0
  }
  const text = String(value).trim()
  const number = Number.parseFloat(text)
  if (Number.isNaN(number)) {
    return 0
  }
  return text.includes("万") ? number * 10000 : number
}

function parseCount(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") {
      continue
    }
    const text = String(value).replace(/[,\s]/g, "")
    const number = Number.parseFloat(text)
    if (!Number.isNaN(number)) {
      return Math.round(text.includes("万") ? number * 10000 : number)
    }
  }
  return null
}

function parseGiftRecordTime(record) {
  const value = record?.createTime
  if (value === undefined || value === null || value === "") {
    return 0
  }
  const number = Number(value)
  if (Number.isFinite(number)) {
    return number > 9999999999 ? number : number * 1000
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDateTimeLocal(value, includeMinuteEnd = false) {
  const text = String(value || "").trim()
  if (!text) {
    return 0
  }
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return includeMinuteEnd ? parsed + 59999 : parsed
}

function giftStatsRange(giftStats) {
  let start = parseDateTimeLocal(giftStats.dateRangeStart)
  let end = parseDateTimeLocal(giftStats.dateRangeEnd, true)
  if (start && end && start > end) {
    const oldStart = start
    start = end
    end = oldStart
  }
  return {
    active: Boolean(start || end),
    start,
    end,
  }
}

function isGiftRecordInRange(record, range) {
  if (!range.active) {
    return true
  }
  const time = parseGiftRecordTime(record)
  if (!time) {
    return false
  }
  if (range.start && time < range.start) {
    return false
  }
  if (range.end && time > range.end) {
    return false
  }
  return true
}

function buildGiftStatsSummary(sendRecords, receiveRecords, range) {
  const sendMap = new Map()
  const recvMap = new Map()
  let sendAcoinTotal = 0
  let receiveDiamondTotal = 0
  let receivePeachTotal = 0

  const touch = (map, r) => {
    const uid = String(r.userId)
    let u = map.get(uid)
    if (!u) {
      u = { uid, userName: r.userName || uid, acoin: 0, diamond: 0, peach: 0 }
      map.set(uid, u)
    }
    if (!u.userName && r.userName) u.userName = r.userName
    return u
  }

  sendRecords.forEach((r) => {
    if (!isGiftRecordInRange(r, range)) {
      return
    }
    const acoin = Number(r.acoin) || 0
    sendAcoinTotal += acoin
    touch(sendMap, r).acoin += acoin
  })

  receiveRecords.forEach((r) => {
    if (!isGiftRecordInRange(r, range)) {
      return
    }
    const u = touch(recvMap, r)
    if (r.giftName === "桃子") {
      const peach = Number(r.giftCount) || 0
      u.peach += peach
      receivePeachTotal += peach
    } else {
      const diamond = Number(r.azuanAmount) || 0
      u.diamond += diamond
      receiveDiamondTotal += diamond
    }
  })

  return {
    sendAcoinTotal,
    receiveDiamondTotal,
    receivePeachTotal,
    sendRank: [...sendMap.values()].filter((u) => u.acoin > 0).sort((a, b) => b.acoin - a.acoin).slice(0, 100),
    peachRank: [...recvMap.values()].filter((u) => u.peach > 0).sort((a, b) => b.peach - a.peach).slice(0, 100),
    contribRank: [...recvMap.values()].filter((u) => u.diamond > 0).sort((a, b) => b.diamond - a.diamond).slice(0, 100),
  }
}

function applyGiftStatsSummary(giftStats, summary) {
  giftStats.sendAcoinTotal = summary.sendAcoinTotal
  giftStats.receiveDiamondTotal = summary.receiveDiamondTotal
  giftStats.receivePeachTotal = summary.receivePeachTotal
  giftStats.sendRank = summary.sendRank
  giftStats.peachRank = summary.peachRank
  giftStats.contribRank = summary.contribRank
}

function giftStatsCacheStart(sendRecords, receiveRecords) {
  let start = 0
  ;[sendRecords, receiveRecords].forEach((records) => {
    records.forEach((record) => {
      const time = parseGiftRecordTime(record)
      if (time && (!start || time < start)) {
        start = time
      }
    })
  })
  return start
}

function isGiftStatsRangeCoveredByCache(giftStats, range) {
  if (!giftStats.fetchedAt) {
    return false
  }
  if (!range.active) {
    return Boolean(giftStats.cacheComplete)
  }
  const cacheStart = Number(giftStats.cacheRangeStart) || 0
  const cacheEnd = Number(giftStats.cacheRangeEnd || giftStats.fetchedAt) || 0
  if (!giftStats.cacheComplete && !cacheStart) {
    return false
  }
  if (!giftStats.cacheComplete && !range.start) {
    return false
  }
  if (!giftStats.cacheComplete && range.start && cacheStart && range.start < cacheStart) {
    return false
  }
  if (range.end && cacheEnd && range.end > cacheEnd) {
    return false
  }
  return true
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.min(max, Math.max(min, number))
}

function normalizeInteractionKeyword(value, fallback) {
  const text = String(value || "").trim()
  return (text || fallback).slice(0, 20)
}

function normalizeInteractionSettings(savedInteraction = {}) {
  const lottery = savedInteraction.lottery || {}
  const songRequest = savedInteraction.songRequest || {}
  const obsMode = SONG_REQUEST_OBS_MODES.has(songRequest.obsMode) ? songRequest.obsMode : "vinylPortrait"
  const maxQueueSize = clampInteger(songRequest.maxQueueSize, 5, INTERACTION_SONG_QUEUE_LIMIT, 30)
  return {
    lottery: {
      keyword: normalizeInteractionKeyword(lottery.keyword, "抽奖"),
      winnerCount: clampInteger(lottery.winnerCount, 1, 20, 1),
      uniqueByUser: lottery.uniqueByUser !== false,
    },
      songRequest: {
        keyword: normalizeInteractionKeyword(songRequest.keyword, "点歌"),
        uniqueByUser: songRequest.uniqueByUser !== false,
        obsMode,
        maxPerUser: clampInteger(songRequest.maxPerUser, 1, INTERACTION_SONG_PER_USER_LIMIT, 3),
        maxQueueSize,
        adminPreviewLimit: clampInteger(songRequest.adminPreviewLimit, 5, INTERACTION_ADMIN_PREVIEW_LIMIT, 12),
        browserSourceName: String(songRequest.browserSourceName || "ACFun 点歌机").trim() || "ACFun 点歌机",
      },
  }
}

function normalizeDanmakuUser(item = {}) {
  const userId = String(item.userId || "").trim()
  const nickname = String(item.nickname || "匿名用户").trim() || "匿名用户"
  return {
    userId,
    nickname,
    userKey: userId || nickname,
  }
}

function normalizeDanmakuContent(item = {}) {
  return String(item.content || "").trim()
}

function buildInteractionEntry(item, extra = {}) {
  const user = normalizeDanmakuUser(item)
  const time = Number(item.time || Math.floor(Date.now() / 1000))
  const title = String(extra.title || normalizeDanmakuContent(item) || "未命名歌曲").trim()
  return {
    id: `${Date.now()}-${user.userKey || "anon"}-${time}-${String(item.id || "").slice(-12)}`,
    userId: user.userId,
    nickname: user.nickname,
    content: normalizeDanmakuContent(item),
    time,
    sourceId: item.id || item.uniqueId || "",
    title: title.slice(0, 100),
    category: normalizeSongCategory(extra.category || title),
    remark: String(extra.remark || "").trim().slice(0, 120),
    url: String(extra.url || "").trim().slice(0, 300),
    durationSeconds: clampInteger(extra.durationSeconds, 30, 7200, estimateSongDuration(title)),
    ...extra,
  }
}

function normalizeSongCategory(value) {
  const text = String(value || "").trim()
  if (/youtu|youtube|youtu\.be|^https?:\/\//i.test(text)) {
    return "YouTube"
  }
  if (/伴奏|karaoke|off vocal|instrumental/i.test(text)) {
    return "伴奏"
  }
  return "观众点播"
}

function estimateSongDuration(title) {
  const text = String(title || "")
  const base = 210 + (text.length % 9) * 12
  return Math.min(420, Math.max(120, base))
}

function isPlainTextDanmaku(item) {
  return item && !item.isGift && item.type === LegacyDanmuTypes.ADD_TEXT && normalizeDanmakuContent(item)
}

function lotteryKeywordMatched(content, keyword) {
  const text = String(content || "").toLowerCase()
  const key = String(keyword || "").trim().toLowerCase()
  return Boolean(key && text.includes(key))
}

function extractSongTitle(content, keyword) {
  const text = String(content || "").trim()
  const key = String(keyword || "").trim()
  if (!text || !key) {
    return ""
  }
  const lowerText = text.toLowerCase()
  const lowerKey = key.toLowerCase()
  const candidates = key.startsWith("#") || key.startsWith("/") ? [key] : [key, `#${key}`, `/${key}`]
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    if (!lowerText.startsWith(lowerCandidate)) {
      continue
    }
    return text
      .slice(candidate.length)
      .replace(/^[\s:：,，;；\-—|]+/, "")
      .trim()
      .slice(0, 80)
  }
  if (lowerText.startsWith(lowerKey)) {
    return text.slice(key.length).trim().slice(0, 80)
  }
  return ""
}

function randomIndex(max) {
  const size = Number(max) || 0
  if (size <= 1) {
    return 0
  }
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const buffer = new Uint32Array(1)
    cryptoApi.getRandomValues(buffer)
    return buffer[0] % size
  }
  return Math.floor(Math.random() * size)
}

function formatError(error) {
  return error && error.message ? error.message : String(error)
}

const AUTH_EXPIRED_MESSAGE = "登录已过期，请重新登录"

function errorSignalText(error) {
  const parts = [formatError(error)]
  if (error && typeof error === "object") {
    parts.push(error.error, error.result)
    if (error.response && typeof error.response === "object") {
      parts.push(error.response.error, error.response.result)
    }
    if (error.data && typeof error.data === "object") {
      parts.push(error.data.error, error.data.result)
    }
  }
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map((part) => String(part))
    .join(" ")
}

function isAuthExpiredError(error) {
  const text = errorSignalText(error)
  return /(?:^|\D)100(?:04|25|26|27|28)(?:\D|$)|token过期|INVALID_TOKEN|TOKEN_EXPIRED|PASSWORD_CHANGED|LOGIN_ON_OTHER_DEVICE|登录.*(?:过期|失效|无效)|(?:请|需要).*登录|用户未登录|未登录/i.test(text)
}

function isBackendNeedsLoginError(error) {
  return /Need login(?: or token)?|需要登录|未登录/i.test(errorSignalText(error))
}

function canRetryWithSavedToken(type) {
  return ![
    BackendTypes.HEARTBEAT,
    BackendTypes.LOGIN,
    BackendTypes.SET_TOKEN,
    BackendTypes.QR_CODE_LOGIN,
    BackendTypes.QR_CODE_SCANNED,
    BackendTypes.QR_CODE_LOGIN_CANCEL,
    BackendTypes.QR_CODE_LOGIN_SUCCESS,
  ].includes(type)
}

function normalizeUserProfile(info = {}, fallbackId = "") {
  return {
    userId: String(info.userID || info.userId || fallbackId || ""),
    nickname: info.nickname || (fallbackId ? `UID ${fallbackId}` : ""),
    avatar: info.avatar || "",
    avatarFrame: info.avatarFrame || "",
    followingCount: info.followingCount || 0,
    fansCount: info.fansCount || 0,
    contributeCount: info.contributeCount || 0,
    signature: info.signature || "",
    verifiedText: info.verifiedText || "",
    liveId: info.liveID || "",
    likeCount: info.likeCount || 0,
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function normalizeObsUrl(value) {
  const text = String(value || "").trim()
  if (!text) {
    return "ws://127.0.0.1:4455"
  }
  if (/^wss?:\/\//i.test(text)) {
    return text
  }
  return `ws://${text}`
}

function summaryRecord(summary, live = {}) {
  return {
    id: summary.liveId || `${Date.now()}`,
    liveId: summary.liveId || "",
    title: live.title || "",
    coverFile: live.coverFile || "",
    endedAt: summary.endedAt || new Date().toLocaleString(),
    endReason: summary.endReason || "",
    duration: summary.duration || "00:00:00",
    watchCount: summary.watchCount || 0,
    likeCount: summary.likeCount || 0,
    danmakuCount: summary.danmakuCount || 0,
    diamond: summary.diamond || 0,
    gift: summary.gift || 0,
    banana: summary.banana || 0,
    timeline: Array.isArray(summary.timeline) ? summary.timeline : [],
  }
}

function emptyLiveSummary() {
  return {
    liveId: "",
    endReason: "",
    endedAt: "",
    diamond: 0,
    gift: 0,
    banana: 0,
    watchCount: 0,
    likeCount: 0,
    danmakuCount: 0,
    duration: "00:00:00",
    timeline: [],
  }
}

function normalizeLiveSummary(summary = {}) {
  const base = emptyLiveSummary()
  if (!summary || typeof summary !== "object") {
    return base
  }
  return {
    liveId: String(summary.liveId || ""),
    endReason: String(summary.endReason || ""),
    endedAt: String(summary.endedAt || ""),
    diamond: Number(summary.diamond || 0),
    gift: Number(summary.gift || 0),
    banana: Number(summary.banana || 0),
    watchCount: Number(summary.watchCount || 0),
    likeCount: Number(summary.likeCount || 0),
    danmakuCount: Number(summary.danmakuCount || 0),
    duration: summary.duration || base.duration,
    timeline: Array.isArray(summary.timeline) ? summary.timeline : [],
  }
}

function renderCroppedDataUrl(sourceDataUrl, crop) {
  return new Promise((resolve) => {
    if (!sourceDataUrl) {
      resolve("")
      return
    }
    const image = new Image()
    image.onload = () => {
      try {
        const aspect = crop && crop.aspect === "16:9" ? 16 / 9 : 16 / 10
        const canvas = document.createElement("canvas")
        canvas.width = 1280
        canvas.height = Math.round(canvas.width / aspect)
        const context = canvas.getContext("2d")
        if (!context) {
          resolve("")
          return
        }
        const imageWidth = image.naturalWidth
        const imageHeight = image.naturalHeight
        let baseWidth = imageWidth
        let baseHeight = baseWidth / aspect
        if (baseHeight > imageHeight) {
          baseHeight = imageHeight
          baseWidth = baseHeight * aspect
        }
        const zoom = Number(crop && crop.zoom) || 1
        const x = Number(crop && crop.x) || 50
        const y = Number(crop && crop.y) || 50
        const sourceWidth = baseWidth / zoom
        const sourceHeight = baseHeight / zoom
        const sourceX = (imageWidth - sourceWidth) * (x / 100)
        const sourceY = (imageHeight - sourceHeight) * (y / 100)
        context.fillStyle = "#fffafa"
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/png"))
      } catch {
        resolve("")
      }
    }
    image.onerror = () => resolve("")
    image.src = sourceDataUrl
  })
}

// 把 saved 中的直播历史规范化为 { [userId]: Record[] } 形式。
// 兼容老格式 saved.liveHistory（全局数组）：把它迁移到当前 saved.userId 名下。
function loadLiveHistoryByUser(saved) {
  const raw = saved.liveHistoryByUser
  const byUser = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {}
  Object.keys(byUser).forEach((uid) => {
    byUser[uid] = normalizeLiveHistoryRecords(byUser[uid])
  })
  if (Array.isArray(saved.liveHistory) && saved.liveHistory.length) {
    const oldUid = String(saved.userId || "")
    if (oldUid && !byUser[oldUid]) {
      byUser[oldUid] = normalizeLiveHistoryRecords(saved.liveHistory)
    }
  }
  return byUser
}

function normalizeLiveHistoryRecords(records) {
  if (!Array.isArray(records)) {
    return []
  }
  return records
    .filter((item) => !isDemoLiveHistoryRecord(item))
    .slice(0, 100)
    .map((item) => {
      // playback 是 GET_PLAYBACK 返回的带签名 URL，可能在一段时间后失效，
      // 仅作为内存缓存使用，持久化时剔除掉，下次点击"回放"时重新拉取。
      if (item && Object.prototype.hasOwnProperty.call(item, "playback")) {
        const { playback, ...rest } = item
        void playback
        return rest
      }
      return item
    })
}

function isDemoLiveHistoryRecord(record) {
  return record?.liveId === "demo-live-history-chart" || record?.title === "测试直播曲线数据"
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function localDayStartTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function nextLocalDayStartTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function normalizeLiveDailyStatsByUser(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }
  return Object.entries(raw).reduce((result, [uid, stats]) => {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
      return result
    }
    const normalized = Object.entries(stats).reduce((days, [dateKey, value]) => {
      const source = value && typeof value === "object" ? value.durationSeconds : value
      const durationSeconds = Math.max(0, Math.floor(Number(source) || 0))
      if (durationSeconds > 0) {
        days[dateKey] = { durationSeconds }
      }
      return days
    }, {})
    if (Object.keys(normalized).length) {
      result[String(uid)] = normalized
    }
    return result
  }, {})
}

function normalizeLiveTimerByUser(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }
  return Object.entries(raw).reduce((result, [uid, value]) => {
    const startedAt = Math.floor(Number(value?.startedAt) || 0)
    if (startedAt > 0) {
      const lastSeenAt = Math.max(startedAt, Math.floor(Number(value?.lastSeenAt) || startedAt))
      result[String(uid)] = {
        liveId: String(value?.liveId || ""),
        startedAt,
        lastSeenAt,
      }
    }
    return result
  }, {})
}

function addLiveDurationByDate(statsByUser, uid, startedAt, endedAt) {
  const userId = String(uid || "")
  const start = Math.floor(Number(startedAt) || 0)
  const end = Math.floor(Number(endedAt) || 0)
  if (!userId || start <= 0 || end <= start) {
    return statsByUser
  }
  const nextByUser = { ...statsByUser }
  const userStats = { ...(nextByUser[userId] || {}) }
  let cursor = start
  while (cursor < end) {
    const dateKey = localDateKey(cursor)
    const dayEnd = nextLocalDayStartTimestamp(cursor)
    const segmentEnd = Math.min(end, dayEnd > cursor ? dayEnd : end)
    const seconds = Math.floor((segmentEnd - cursor) / 1000)
    if (seconds > 0) {
      const old = userStats[dateKey] || {}
      userStats[dateKey] = {
        durationSeconds: Math.max(0, Math.floor(Number(old.durationSeconds) || 0)) + seconds,
      }
    }
    if (segmentEnd <= cursor) {
      break
    }
    cursor = segmentEnd
  }
  nextByUser[userId] = userStats
  return nextByUser
}

function isNotLiveError(error) {
  return /未开播|已关播|380023|129004/i.test(formatError(error))
}

function normalizeTtsSettings(raw = {}) {
  const provider = raw.provider === "sapi" ? "sapi" : "edge"
  return {
    enabled: Boolean(raw.enabled),
    provider,
    voiceName: raw.voiceName || (provider === "sapi" ? "" : "zh-CN-XiaoxiaoNeural"),
    volume: Math.min(100, Math.max(0, Number(raw.volume ?? 80) || 80)),
    speed: Math.min(2, Math.max(0.5, Number(raw.speed ?? 1) || 1)),
    pitch: Math.min(2, Math.max(0.5, Number(raw.pitch ?? 1) || 1)),
    includeNickname: raw.includeNickname !== false,
    readComment: raw.readComment !== false,
    readGift: Boolean(raw.readGift),
    maxLength: Math.min(200, Math.max(10, Number(raw.maxLength ?? 50) || 50)),
    queueLimit: Math.min(30, Math.max(1, Number(raw.queueLimit ?? 5) || 5)),
  }
}

function defaultState() {
  const saved = loadSavedState()
  const savedOverlay = saved.overlay || {}
  const savedObs = saved.obs || {}
  const savedUi = saved.ui || {}
  const savedGiftStats = saved.giftStats || {}
  const savedProfile = saved.userProfile || {}
  const savedInteraction = normalizeInteractionSettings(saved.interaction)
  const liveHistoryByUser = loadLiveHistoryByUser(saved)
  const liveDailyStatsByUser = normalizeLiveDailyStatsByUser(saved.liveDailyStatsByUser)
  const liveTimerByUser = normalizeLiveTimerByUser(saved.liveTimerByUser)
  const currentUid = String(saved.userId || "")
  const savedLiveHistory = currentUid && Array.isArray(liveHistoryByUser[currentUid])
    ? liveHistoryByUser[currentUid]
    : []
  const savedSummary = normalizeLiveSummary(saved.liveSummary)
  return {
    backendUrl: saved.backendUrl || "ws://localhost:15368/",
    connected: false,
    lastError: "",
    tokenInfo: saved.tokenInfo || null,
    userName: saved.userName || "",
    userId: saved.userId || "",
    userProfile: normalizeUserProfile(savedProfile, saved.userId || ""),
    giftStats: {
      loading: false,
      loaded: false,
      error: "",
      progress: "",
      dateRangeStart: savedGiftStats.dateRangeStart || "",
      dateRangeEnd: savedGiftStats.dateRangeEnd || "",
      sendRecords: [],
      receiveRecords: [],
      fetchedAt: 0,
      cacheRangeStart: 0,
      cacheRangeEnd: 0,
      cacheComplete: false,
      pagesRead: 0,
      totalRecords: 0,
      limited: false,
      limitReason: "",
      sendAcoinTotal: 0,
      receiveDiamondTotal: 0,
      receivePeachTotal: 0,
      sendRank: [],
      peachRank: [],
      contribRank: [],
    },
    room: {
      isLive: false,
      liveId: "",
      onlineCount: 0,
      likeCount: 0,
      bananaCount: 0,
      diamondCount: 0,
      suppressOnlineCountUntil: 0,
      danmakuList: [],
      watchingList: [],
      managerList: [],
      billList: [],
      blockList: saved.blockList || [],
      todayFansAdded: 0,
      liveStartTime: 0,
      accumulatedTime: 0,
      ticker: 0,
    },
    live: {
      isLive: false,
      liveId: "",
      title: saved.liveTitle || "",
      coverFile: saved.coverFile || "",
      coverHistory: saved.coverHistory || [],
      coverCrops: saved.coverCrops && typeof saved.coverCrops === "object" ? saved.coverCrops : {},
      coverAspect: saved.coverAspect === "16:9" ? "16:9" : "16:10",
      categoryId: saved.categoryId || 0,
      subCategoryId: saved.subCategoryId || 0,
      categories: [],
      subCategories: [],
      streamName: "",
      streamUrl: "",
      streamKey: "",
      transcodes: [],
      // 直播剪辑信息（GET_LIVE_CUT_INFO）。
      // status: 主播是否允许观众剪辑；主播自己在直播中总能拿到 url / redirectURL。
      liveCutInfo: { status: false, url: "", redirectURL: "" },
    },
    obs: {
      enabled: savedObs.enabled || false,
      url: savedObs.url || "ws://127.0.0.1:4455",
      password: savedObs.password || "",
      browserSourceName: savedObs.browserSourceName || "",
      syncBrowserSourceOnConnect: savedObs.syncBrowserSourceOnConnect !== false,
      browserSourceUrl: "",
      lastBrowserSourceSyncedSourceName: "",
      lastBrowserSourceSyncedUrl: "",
      connected: false,
      streaming: false,
      shouldRestoreConnection: savedObs.shouldRestoreConnection || false,
      lastStreamStopped: false,
      autoStartLive: savedObs.autoStartLive !== false,
      stopStreamingAfterClose: savedObs.stopStreamingAfterClose || false,
      autoStartStatus: "idle",
      lastError: "",
    },
    summary: liveTimerByUser[currentUid]?.startedAt ? savedSummary : emptyLiveSummary(),
    // 当前登录用户的直播历史视图。真正的多账号存档在 liveHistoryByUser 里，
    // persist() 会把 liveHistory 同步写回 liveHistoryByUser[当前 userId]。
    liveHistory: savedLiveHistory.slice(0, 100),
    liveHistoryByUser,
    liveDailyStatsByUser,
    liveTimerByUser,
    overlay: {
      width: savedOverlay.width || 420,
      height: savedOverlay.height || 720,
      maxItems: savedOverlay.maxItems || 18,
      fontSize: savedOverlay.fontSize || 18,
      fontFamily: savedOverlay.fontFamily || "Microsoft YaHei",
      nameFontFamily: savedOverlay.nameFontFamily || savedOverlay.fontFamily || "Microsoft YaHei",
      contentFontFamily: savedOverlay.contentFontFamily || savedOverlay.fontFamily || "Microsoft YaHei",
      textColor: savedOverlay.textColor || "#ffffff",
      nameColor: savedOverlay.nameColor || "#fd4c5d",
      bubbleColor: savedOverlay.bubbleColor || "rgba(36, 27, 32, 0.78)",
      bubbleEnabled: savedOverlay.bubbleEnabled !== false,
      showAvatar: savedOverlay.showAvatar !== false,
      animation: savedOverlay.animation || "slide",
      rounded: savedOverlay.rounded || 18,
      gap: savedOverlay.gap || 10,
      // 整体缩放：通过 CSS zoom 把 overlay 全部视觉元素按比例放大 / 缩小，OBS 浏览器源宽高不变。
      scale: Number(savedOverlay.scale) > 0 ? Number(savedOverlay.scale) : 1,
      convertChinese: savedOverlay.convertChinese || "none",
    },
    logs: [],
    progress: "",
    eventsBound: false,
    activeTab: "account",
    interaction: {
      lottery: {
        active: false,
        keyword: savedInteraction.lottery.keyword,
        winnerCount: savedInteraction.lottery.winnerCount,
        uniqueByUser: savedInteraction.lottery.uniqueByUser,
        participants: [],
        winners: [],
        history: [],
        recent: [],
      },
      songRequest: {
        active: false,
        playbackPaused: false,
        shuffle: false,
        obsMode: savedInteraction.songRequest.obsMode,
        keyword: savedInteraction.songRequest.keyword,
        uniqueByUser: savedInteraction.songRequest.uniqueByUser,
        maxPerUser: savedInteraction.songRequest.maxPerUser,
        maxQueueSize: savedInteraction.songRequest.maxQueueSize,
        adminPreviewLimit: savedInteraction.songRequest.adminPreviewLimit,
        browserSourceName: savedInteraction.songRequest.browserSourceName,
        browserSourceUrl: "",
        lastBrowserSourceSyncedSourceName: "",
        lastBrowserSourceSyncedUrl: "",
        current: null,
        progressSeconds: 0,
        queue: [],
        preplay: [],
        played: [],
        recent: [],
      },
    },
    ui: {
      theme: savedUi.theme === "dark" ? "dark" : "light",
      sidebarCollapsed: Boolean(savedUi.sidebarCollapsed),
      uiScale: Math.min(1.3, Math.max(0.8, Number(savedUi.uiScale) || 1)),
      guardianClubVisible: savedUi.guardianClubVisible !== false,
    },
    tts: normalizeTtsSettings(saved.tts),
    qrLogin: {
      status: "idle",
      imageData: "",
      expireTime: 0,
    },
    guardianClub: {
      clubName: "",
      medalCount: 0,
      rankList: [],
      loading: false,
    },
  }
}

export const useLiveStore = defineStore("live", {
  state: defaultState,
  getters: {
    isLoggedIn: (state) => Boolean(state.tokenInfo && state.userId),
    currentSubCategories: (state) => state.live.subCategories.filter((item) => item.categoryID === state.live.categoryId),
    liveDurationSeconds: (state) => {
      const _ = state.room.ticker
      const uid = String(state.userId || "")
      if (!uid) {
        return 0
      }
      const todayKey = localDateKey()
      const stats = state.liveDailyStatsByUser?.[uid]?.[todayKey]
      const baseSeconds = Math.max(0, Math.floor(Number(stats?.durationSeconds) || 0))
      if ((!state.live.isLive && !state.room.isLive) || !state.room.liveStartTime) {
        return baseSeconds
      }
      const activeStart = Math.max(state.room.liveStartTime, localDayStartTimestamp())
      const activeSeconds = Math.floor((Date.now() - activeStart) / 1000)
      return baseSeconds + Math.max(0, activeSeconds)
    },
    formattedLiveDuration() {
      const totalSeconds = this.liveDurationSeconds
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    },
  },
  actions: {
    persist() {
      // 把当前登录用户的 liveHistory 同步进 liveHistoryByUser，避免账号切换后丢失。
      const uid = String(this.userId || "")
      const byUserSnapshot = { ...this.liveHistoryByUser }
      if (uid) {
        byUserSnapshot[uid] = normalizeLiveHistoryRecords(this.liveHistory)
      }
      this.liveHistoryByUser = byUserSnapshot
      const liveDailyStatsByUser = normalizeLiveDailyStatsByUser(this.liveDailyStatsByUser)
      const liveTimerByUser = normalizeLiveTimerByUser(this.liveTimerByUser)
      this.liveDailyStatsByUser = liveDailyStatsByUser
      this.liveTimerByUser = liveTimerByUser
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        backendUrl: this.backendUrl,
        tokenInfo: this.tokenInfo,
        userName: this.userName,
        userId: this.userId,
        userProfile: this.userProfile,
        blockList: this.room.blockList,
        liveTitle: this.live.title,
        coverFile: this.live.coverFile,
        coverHistory: this.live.coverHistory,
        coverCrops: this.live.coverCrops,
        coverAspect: this.live.coverAspect,
        categoryId: this.live.categoryId,
        subCategoryId: this.live.subCategoryId,
        liveHistoryByUser: byUserSnapshot,
        liveDailyStatsByUser,
        liveTimerByUser,
        liveSummary: this.live.isLive || this.room.isLive ? normalizeLiveSummary(this.summary) : emptyLiveSummary(),
        giftStats: {
          dateRangeStart: this.giftStats.dateRangeStart,
          dateRangeEnd: this.giftStats.dateRangeEnd,
        },
        interaction: {
          lottery: {
            keyword: this.interaction.lottery.keyword,
            winnerCount: this.interaction.lottery.winnerCount,
            uniqueByUser: this.interaction.lottery.uniqueByUser,
          },
          songRequest: {
            keyword: this.interaction.songRequest.keyword,
            uniqueByUser: this.interaction.songRequest.uniqueByUser,
            obsMode: this.interaction.songRequest.obsMode,
            maxPerUser: this.interaction.songRequest.maxPerUser,
            maxQueueSize: this.interaction.songRequest.maxQueueSize,
            adminPreviewLimit: this.interaction.songRequest.adminPreviewLimit,
            browserSourceName: this.interaction.songRequest.browserSourceName,
          },
        },
        overlay: this.overlay,
        obs: {
          enabled: this.obs.enabled,
          url: this.obs.url,
          password: this.obs.password,
          browserSourceName: this.obs.browserSourceName,
          syncBrowserSourceOnConnect: this.obs.syncBrowserSourceOnConnect,
          shouldRestoreConnection: this.obs.shouldRestoreConnection,
          autoStartLive: this.obs.autoStartLive,
          stopStreamingAfterClose: this.obs.stopStreamingAfterClose,
        },
        ui: this.ui,
        tts: this.tts,
      }))
    },
    setTheme(theme) {
      this.ui.theme = theme === "dark" ? "dark" : "light"
      this.persist()
    },
    toggleTheme() {
      this.setTheme(this.ui.theme === "dark" ? "light" : "dark")
    },
    resetGiftStatsResults() {
      const gs = this.giftStats
      gs.loaded = false
      gs.error = ""
      gs.progress = ""
      gs.sendAcoinTotal = 0
      gs.receiveDiamondTotal = 0
      gs.receivePeachTotal = 0
      gs.sendRank = []
      gs.peachRank = []
      gs.contribRank = []
    },
    applyGiftStatsFilter() {
      const gs = this.giftStats
      const sendRecords = Array.isArray(gs.sendRecords) ? gs.sendRecords : []
      const receiveRecords = Array.isArray(gs.receiveRecords) ? gs.receiveRecords : []
      if (!gs.fetchedAt && sendRecords.length === 0 && receiveRecords.length === 0) {
        this.resetGiftStatsResults()
        return
      }
      applyGiftStatsSummary(gs, buildGiftStatsSummary(sendRecords, receiveRecords, giftStatsRange(gs)))
      gs.loaded = true
      gs.error = ""
      gs.progress = ""
    },
    async setGiftStatsDateRange(start, end) {
      this.giftStats.dateRangeStart = start || ""
      this.giftStats.dateRangeEnd = end || ""
      this.persist()
      const range = giftStatsRange(this.giftStats)
      if (
        this.isLoggedIn &&
        !this.giftStats.loading &&
        !isGiftStatsRangeCoveredByCache(this.giftStats, range)
      ) {
        await this.loadGiftStats({ automatic: false })
        return
      }
      this.applyGiftStatsFilter()
    },
    toggleSidebar() {
      this.ui.sidebarCollapsed = !this.ui.sidebarCollapsed
      this.persist()
    },
    setUiScale(value) {
      this.ui.uiScale = Math.min(1.3, Math.max(0.8, Number(value) || 1))
      this.persist()
    },
    toggleGuardianClubVisible() {
      this.ui.guardianClubVisible = !this.ui.guardianClubVisible
      this.persist()
    },
    setLotteryKeyword(value) {
      this.interaction.lottery.keyword = normalizeInteractionKeyword(value, "抽奖")
      this.persist()
    },
    setLotteryWinnerCount(value) {
      this.interaction.lottery.winnerCount = clampInteger(value, 1, 20, 1)
      this.persist()
    },
    setLotteryUniqueByUser(value) {
      this.interaction.lottery.uniqueByUser = Boolean(value)
      this.persist()
    },
    startLottery() {
      this.interaction.lottery.active = true
      this.log(`弹幕抽奖已开启：关键词「${this.interaction.lottery.keyword}」`)
    },
    stopLottery() {
      this.interaction.lottery.active = false
      this.log("弹幕抽奖已暂停")
    },
    clearLotteryParticipants() {
      const lottery = this.interaction.lottery
      lottery.participants = []
      lottery.winners = []
      lottery.recent = []
    },
    drawLotteryWinners() {
      const lottery = this.interaction.lottery
      const pool = Array.isArray(lottery.participants) ? lottery.participants.slice() : []
      if (!pool.length) {
        throw new Error("当前没有可抽取的参与者")
      }
      const count = Math.min(clampInteger(lottery.winnerCount, 1, 20, 1), pool.length)
      const winners = []
      for (let i = 0; i < count; i += 1) {
        const index = randomIndex(pool.length)
        winners.push(pool.splice(index, 1)[0])
      }
      const drawTime = Math.floor(Date.now() / 1000)
      lottery.winners = winners.map((item, index) => ({
        ...item,
        rank: index + 1,
        drawTime,
      }))
      lottery.history = [
        {
          id: `${Date.now()}-${winners.map((item) => item.id).join("-")}`,
          time: drawTime,
          winnerCount: winners.length,
          participantCount: lottery.participants.length,
          keyword: lottery.keyword,
          winners: lottery.winners,
        },
        ...lottery.history,
      ].slice(0, INTERACTION_HISTORY_LIMIT)
      this.log(`弹幕抽奖开奖：${winners.map((item) => item.nickname).join("、")}`)
      return lottery.winners
    },
    setSongRequestKeyword(value) {
      this.interaction.songRequest.keyword = normalizeInteractionKeyword(value, "点歌")
      this.persist()
    },
    setSongRequestUniqueByUser(value) {
      this.interaction.songRequest.uniqueByUser = Boolean(value)
      this.persist()
    },
    setSongRequestObsMode(value) {
      this.interaction.songRequest.obsMode = SONG_REQUEST_OBS_MODES.has(value) ? value : "vinylPortrait"
      this.persist()
    },
    setSongRequestBrowserSourceUrl(url) {
      this.interaction.songRequest.browserSourceUrl = String(url || "").trim()
    },
    setSongRequestBrowserSourceName(value) {
      this.interaction.songRequest.browserSourceName = String(value || "").trim() || "ACFun 点歌机"
      this.persist()
    },
    setSongRequestMaxPerUser(value) {
      this.interaction.songRequest.maxPerUser = clampInteger(value, 1, INTERACTION_SONG_PER_USER_LIMIT, 3)
      this.persist()
    },
    setSongRequestMaxQueueSize(value) {
      this.interaction.songRequest.maxQueueSize = clampInteger(value, 5, INTERACTION_SONG_QUEUE_LIMIT, 30)
      this.interaction.songRequest.queue = this.interaction.songRequest.queue.slice(0, this.interaction.songRequest.maxQueueSize)
      this.persist()
    },
    setSongRequestAdminPreviewLimit(value) {
      this.interaction.songRequest.adminPreviewLimit = clampInteger(value, 5, INTERACTION_ADMIN_PREVIEW_LIMIT, 12)
      this.persist()
    },
    saveSongRequestSettings(settings = {}) {
      if (Object.prototype.hasOwnProperty.call(settings, "obsMode")) {
        this.setSongRequestObsMode(settings.obsMode)
      }
      if (Object.prototype.hasOwnProperty.call(settings, "maxPerUser")) {
        this.interaction.songRequest.maxPerUser = clampInteger(settings.maxPerUser, 1, INTERACTION_SONG_PER_USER_LIMIT, 3)
      }
      if (Object.prototype.hasOwnProperty.call(settings, "maxQueueSize")) {
        this.interaction.songRequest.maxQueueSize = clampInteger(settings.maxQueueSize, 5, INTERACTION_SONG_QUEUE_LIMIT, 30)
        this.interaction.songRequest.queue = this.interaction.songRequest.queue.slice(0, this.interaction.songRequest.maxQueueSize)
      }
      if (Object.prototype.hasOwnProperty.call(settings, "adminPreviewLimit")) {
        this.interaction.songRequest.adminPreviewLimit = clampInteger(settings.adminPreviewLimit, 5, INTERACTION_ADMIN_PREVIEW_LIMIT, 12)
      }
      this.persist()
      this.log("弹幕点歌设置已保存")
    },
    async syncSongRequestBrowserSourceUrl({
      client = null,
      force = false,
      required = true,
      silent = false,
    } = {}) {
      const song = this.interaction.songRequest
      const inputName = String(song.browserSourceName || "").trim()
      const url = String(song.browserSourceUrl || "").trim()
      if (!inputName) {
        if (required && !silent) {
          throw new Error("请先填写点歌 OBS 源名称")
        }
        return false
      }
      if (!url) {
        if (required && !silent) {
          throw new Error("点歌 OBS 浏览器源 URL 尚未初始化")
        }
        return false
      }
      if (!client && !this.obs.connected) {
        throw new Error("请先连接 OBS")
      }
      if (
        !force
        && song.lastBrowserSourceSyncedSourceName === inputName
        && song.lastBrowserSourceSyncedUrl === url
      ) {
        return false
      }
      try {
        const obs = client || await this.connectObsClient({ syncBrowserSource: false })
        await obs.request("SetInputSettings", {
          inputName,
          inputSettings: { url },
          overlay: true,
        })
        await obs.request("PressInputPropertiesButton", {
          inputName,
          propertyName: "refreshnocache",
        })
        this.obs.connected = true
        this.obs.enabled = true
        this.obs.lastError = ""
        song.lastBrowserSourceSyncedSourceName = inputName
        song.lastBrowserSourceSyncedUrl = url
        this.persist()
        this.log(`已同步并刷新点歌 OBS 源：${inputName}`)
        return true
      } catch (error) {
        const message = formatError(error)
        this.obs.lastError = message
        this.log(`点歌 OBS 源 URL 同步或刷新失败：${message}`)
        if (!silent) {
          throw error
        }
        return false
      }
    },
    startSongRequest() {
      this.interaction.songRequest.active = true
      this.log(`弹幕点歌已开启：关键词「${this.interaction.songRequest.keyword}」`)
    },
    stopSongRequest() {
      this.interaction.songRequest.active = false
      this.log("弹幕点歌已暂停")
    },
    clearSongRequestQueue() {
      this.interaction.songRequest.queue = []
      this.interaction.songRequest.recent = []
    },
    clearPlayedSongRequests() {
      this.interaction.songRequest.played = []
    },
    addManualSongRequest(title, requester = "主播", options = {}) {
      const cleanTitle = String(title || "").trim().slice(0, 80)
      if (!cleanTitle) {
        throw new Error("请输入歌名")
      }
      const added = this.addSongRequestEntry({
        title: cleanTitle,
        item: {
          nickname: String(requester || "主播").trim() || "主播",
          userId: "",
          content: cleanTitle,
          time: Math.floor(Date.now() / 1000),
        },
        manual: true,
        ...options,
      })
      if (!added) {
        throw new Error("点歌队列已满")
      }
      return added
    },
    addPreplaySongRequest(title, remark = "") {
      const cleanTitle = String(title || "").trim().slice(0, 100)
      if (!cleanTitle) {
        throw new Error("请输入 YouTube 网址或关键词")
      }
      const entry = buildInteractionEntry({
        nickname: "Admin",
        userId: "",
        content: cleanTitle,
        time: Math.floor(Date.now() / 1000),
      }, {
        title: cleanTitle,
        remark,
        manual: true,
        preplay: true,
        category: normalizeSongCategory(cleanTitle),
        url: /^https?:\/\//i.test(cleanTitle) ? cleanTitle : "",
      })
      this.interaction.songRequest.preplay = [
        entry,
        ...this.interaction.songRequest.preplay,
      ].slice(0, INTERACTION_SONG_PREPLAY_LIMIT)
      return entry
    },
    removePreplaySongRequest(id) {
      this.interaction.songRequest.preplay = this.interaction.songRequest.preplay.filter((item) => item.id !== id)
    },
    enqueuePreplaySongRequest(id) {
      const song = this.interaction.songRequest
      const entry = song.preplay.find((item) => item.id === id)
      if (!entry) {
        return false
      }
      const added = this.addSongRequestEntry({
        title: entry.title,
        item: {
          nickname: "Admin",
          userId: "",
          content: entry.title,
          time: Math.floor(Date.now() / 1000),
        },
        manual: true,
        remark: entry.remark,
        category: entry.category,
        url: entry.url,
        durationSeconds: entry.durationSeconds,
      })
      if (added) {
        this.removePreplaySongRequest(id)
      }
      return Boolean(added)
    },
    addSongRequestEntry({ title, item, manual = false }) {
      const song = this.interaction.songRequest
      if (song.queue.length >= song.maxQueueSize) {
        song.recent = [
          buildInteractionEntry(item, { action: "点歌失败", title, reason: "队列已满" }),
          ...song.recent,
        ].slice(0, INTERACTION_RECENT_LIMIT)
        return false
      }
      const user = normalizeDanmakuUser(item)
      if (!manual && user.userKey) {
        const userQueueCount = song.queue.filter((entry) => entry.userKey === user.userKey).length
        if (song.uniqueByUser && userQueueCount > 0) {
          song.recent = [
            buildInteractionEntry(item, { action: "点歌忽略", title, reason: "已有未播点歌" }),
            ...song.recent,
          ].slice(0, INTERACTION_RECENT_LIMIT)
          return false
        }
        if (userQueueCount >= song.maxPerUser) {
          song.recent = [
            buildInteractionEntry(item, { action: "点歌拒绝", title, reason: "超过个人上限" }),
            ...song.recent,
          ].slice(0, INTERACTION_RECENT_LIMIT)
          return false
        }
      }
      const entry = buildInteractionEntry(item, {
        title: String(title || "").trim().slice(0, 80),
        userKey: user.userKey,
        manual,
      })
      song.queue = [...song.queue, entry].slice(0, song.maxQueueSize)
      song.recent = [
        { ...entry, action: manual ? "手动加入" : "加入队列" },
        ...song.recent,
      ].slice(0, INTERACTION_RECENT_LIMIT)
      return true
    },
    playSongRequest(id) {
      const song = this.interaction.songRequest
      let entry = null
      if (id) {
        const index = song.queue.findIndex((item) => item.id === id)
        if (index >= 0) {
          ;[entry] = song.queue.splice(index, 1)
        }
      } else if (song.shuffle && song.queue.length > 1) {
        const index = randomIndex(song.queue.length)
        ;[entry] = song.queue.splice(index, 1)
      } else {
        entry = song.queue.shift() || null
      }
      if (!entry) {
        song.current = null
        song.progressSeconds = 0
        return null
      }
      song.current = {
        ...entry,
        startedAt: Math.floor(Date.now() / 1000),
        durationSeconds: clampInteger(entry.durationSeconds, 30, 7200, estimateSongDuration(entry.title)),
      }
      song.progressSeconds = 0
      song.playbackPaused = false
      return song.current
    },
    pauseSongPlayback() {
      this.interaction.songRequest.playbackPaused = true
    },
    resumeSongPlayback() {
      this.interaction.songRequest.playbackPaused = false
    },
    toggleSongShuffle() {
      this.interaction.songRequest.shuffle = !this.interaction.songRequest.shuffle
    },
    replayCurrentSong() {
      const song = this.interaction.songRequest
      if (!song.current) {
        return
      }
      song.current = { ...song.current, startedAt: Math.floor(Date.now() / 1000) }
      song.progressSeconds = 0
      song.playbackPaused = false
    },
    skipCurrentSong() {
      const song = this.interaction.songRequest
      if (song.current) {
        song.played = [{ ...song.current, playedAt: Math.floor(Date.now() / 1000), skipped: true }, ...song.played].slice(0, INTERACTION_HISTORY_LIMIT)
      }
      return this.playSongRequest()
    },
    closeSongRequestSystem() {
      const song = this.interaction.songRequest
      song.active = false
      song.current = null
      song.progressSeconds = 0
      song.playbackPaused = false
      this.log("弹幕点歌系统已关闭")
    },
    markSongRequestPlayed(id) {
      const song = this.interaction.songRequest
      if (song.current && song.current.id === id) {
        song.played = [{ ...song.current, playedAt: Math.floor(Date.now() / 1000) }, ...song.played].slice(0, INTERACTION_HISTORY_LIMIT)
        song.current = null
        song.progressSeconds = 0
        return
      }
      const index = song.queue.findIndex((item) => item.id === id)
      if (index < 0) {
        return
      }
      const [entry] = song.queue.splice(index, 1)
      song.played = [{ ...entry, playedAt: Math.floor(Date.now() / 1000) }, ...song.played].slice(0, INTERACTION_HISTORY_LIMIT)
    },
    removeSongRequest(id) {
      const song = this.interaction.songRequest
      song.queue = song.queue.filter((item) => item.id !== id)
    },
    moveSongRequest(id, direction) {
      const song = this.interaction.songRequest
      const index = song.queue.findIndex((item) => item.id === id)
      if (index < 0) {
        return
      }
      const nextIndex = direction < 0 ? index - 1 : index + 1
      if (nextIndex < 0 || nextIndex >= song.queue.length) {
        return
      }
      const queue = song.queue.slice()
      const [entry] = queue.splice(index, 1)
      queue.splice(nextIndex, 0, entry)
      song.queue = queue
    },
    handleInteractionDanmaku(item) {
      if (!isPlainTextDanmaku(item)) {
        return
      }
      const content = normalizeDanmakuContent(item)
      const lottery = this.interaction.lottery
      if (lottery.active && lotteryKeywordMatched(content, lottery.keyword)) {
        const user = normalizeDanmakuUser(item)
        const duplicate = lottery.uniqueByUser
          ? lottery.participants.some((entry) => entry.userKey === user.userKey)
          : lottery.participants.some((entry) => entry.sourceId && entry.sourceId === (item.id || item.uniqueId))
        if (!duplicate) {
          const entry = buildInteractionEntry(item, { userKey: user.userKey })
          lottery.participants = [entry, ...lottery.participants].slice(0, 1000)
          lottery.recent = [{ ...entry, action: "参与抽奖" }, ...lottery.recent].slice(0, INTERACTION_RECENT_LIMIT)
        }
      }
      const song = this.interaction.songRequest
      if (song.active) {
        const title = extractSongTitle(content, song.keyword)
        if (title) {
          this.addSongRequestEntry({ title, item })
        }
      }
    },
    // 把 liveHistoryByUser[当前 userId] 加载到 this.liveHistory（账号切换时调用）
    loadHistoryForCurrentUser() {
      const uid = String(this.userId || "")
      if (!uid) {
        this.liveHistory = []
        return
      }
      const arr = this.liveHistoryByUser[uid]
      this.liveHistory = normalizeLiveHistoryRecords(arr)
    },
    // 把当前 liveHistory 视图保存回 liveHistoryByUser[当前 userId]（账号切换前调用）
    saveHistoryForCurrentUser() {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      this.liveHistoryByUser = {
        ...this.liveHistoryByUser,
        [uid]: normalizeLiveHistoryRecords(this.liveHistory),
      }
    },
    ensureLiveSummary(liveId) {
      const liveIdText = String(liveId || this.live.liveId || this.room.liveId || this.summary.liveId || "")
      if (!liveIdText) {
        return
      }
      if (this.summary.liveId !== liveIdText) {
        this.summary.liveId = liveIdText
        this.summary.endReason = ""
        this.summary.endedAt = ""
        this.summary.duration = "00:00:00"
        this.summary.timeline = []
      }
      if (!Array.isArray(this.summary.timeline)) {
        this.summary.timeline = []
      }
    },
    startLiveTimelineSampler() {
      if (liveTimelineSampler) {
        return
      }
      liveTimelineSampler = window.setInterval(() => {
        if (!this.live.isLive && !this.room.isLive) {
          this.stopLiveTimelineSampler()
          return
        }
        this.loadRoom()
          .catch((error) => {
            this.log(`直播曲线采样失败：${formatError(error)}`)
          })
          .finally(() => {
            this.pushLiveTimelinePoint()
            this.syncLiveTimelineToHistory()
            this.persist()
          })
      }, LIVE_TIMELINE_SAMPLE_INTERVAL_MS)
    },
    stopLiveTimelineSampler() {
      if (!liveTimelineSampler) {
        return
      }
      window.clearInterval(liveTimelineSampler)
      liveTimelineSampler = null
    },
    startLiveTimer(liveId, timestamp = Date.now()) {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      const liveIdText = String(liveId || "")
      this.ensureLiveSummary(liveIdText)
      this.startLiveTimelineSampler()
      const old = this.liveTimerByUser[uid]
      if (old?.startedAt && (!old.liveId || old.liveId === liveIdText)) {
        const startedAt = Math.floor(Number(old.startedAt) || timestamp)
        this.room.liveStartTime = startedAt
        this.liveTimerByUser = {
          ...this.liveTimerByUser,
          [uid]: {
            liveId: liveIdText || old.liveId || "",
            startedAt,
            lastSeenAt: Math.max(startedAt, Math.floor(timestamp)),
          },
        }
        return
      }
      if (old?.startedAt) {
        this.finishLiveTimer(Math.floor(Number(old.lastSeenAt) || timestamp), true)
      }
      this.room.liveStartTime = timestamp
      this.liveTimerByUser = {
        ...this.liveTimerByUser,
        [uid]: {
          liveId: liveIdText,
          startedAt: timestamp,
          lastSeenAt: timestamp,
        },
      }
      this.pushLiveTimelinePoint(true)
    },
    markLiveTimerSeen(liveId, timestamp = Date.now()) {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      const liveIdText = String(liveId || "")
      this.ensureLiveSummary(liveIdText)
      this.startLiveTimelineSampler()
      const old = this.liveTimerByUser[uid]
      if (!old?.startedAt) {
        this.startLiveTimer(liveIdText, timestamp)
        return
      }
      if (old.liveId && liveIdText && old.liveId !== liveIdText) {
        this.finishLiveTimer(Math.floor(Number(old.lastSeenAt) || timestamp), true)
        this.startLiveTimer(liveIdText, timestamp)
        return
      }
      this.liveTimerByUser = {
        ...this.liveTimerByUser,
        [uid]: {
          liveId: liveIdText || old.liveId || "",
          startedAt: old.startedAt,
          lastSeenAt: Math.max(Math.floor(Number(old.lastSeenAt) || old.startedAt), Math.floor(timestamp)),
        },
      }
      this.room.liveStartTime = Math.floor(Number(old.startedAt) || timestamp)
    },
    finishLiveTimer(endedAt = Date.now(), useLastSeen = false) {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      const old = this.liveTimerByUser[uid]
      if (!old?.startedAt) {
        this.room.liveStartTime = 0
        this.room.accumulatedTime = 0
        return
      }
      const fallbackEnd = useLastSeen ? old.lastSeenAt : endedAt
      const effectiveEnd = Math.floor(Number(fallbackEnd) || Number(old.lastSeenAt) || endedAt)
      this.liveDailyStatsByUser = addLiveDurationByDate(this.liveDailyStatsByUser, uid, old.startedAt, effectiveEnd)
      const nextTimers = { ...this.liveTimerByUser }
      delete nextTimers[uid]
      this.liveTimerByUser = nextTimers
      this.room.liveStartTime = 0
      this.room.accumulatedTime = 0
      this.stopLiveTimelineSampler()
    },
    log(message) {
      const text = String(message || "")
      this.logs.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: new Date().toLocaleTimeString(),
        message: text,
      })
      this.logs = this.logs.slice(0, 200)
      appendNativeLog(text).catch(() => {})
    },
    persistLiveRecord() {
      if (!this.summary.liveId) {
        return
      }
      const record = summaryRecord(this.summary, this.live)
      this.liveHistory = [
        record,
        ...this.liveHistory.filter((item) => item.liveId !== record.liveId),
      ].slice(0, 100)
      this.persist()
    },
    syncLiveTimelineToHistory() {
      const liveId = this.summary.liveId
      if (!liveId) {
        return
      }
      const index = this.liveHistory.findIndex((item) => item.liveId === liveId)
      if (index < 0) {
        return
      }
      const timeline = Array.isArray(this.summary.timeline) ? this.summary.timeline : []
      this.liveHistory = this.liveHistory.map((item, itemIndex) => (
        itemIndex === index ? { ...item, timeline } : item
      ))
    },
    pushLiveTimelinePoint(force = false) {
      if (!this.live.isLive && !this.room.isLive && !this.summary.liveId) {
        return
      }
      const now = Date.now()
      const timeline = Array.isArray(this.summary.timeline) ? this.summary.timeline : []
      const last = timeline[timeline.length - 1]
      if (!force && last && now - last.time < 30000) {
        return
      }
      timeline.push({
        time: now,
        onlineCount: Number(this.room.onlineCount || 0),
        danmakuCount: Number(this.summary.danmakuCount || 0),
      })
      this.summary.timeline = timeline.slice(-720)
    },
    removeLiveRecord(liveId) {
      this.liveHistory = this.liveHistory.filter((item) => item.liveId !== liveId)
      this.persist()
    },
    bindBackendEvents() {
      if (this.eventsBound) {
        return
      }
      this.eventsBound = true
      acfunBackend.on("open", () => {
        this.connected = true
        this.lastError = ""
        this.log("已连接 acfunlive-backend")
      })
      acfunBackend.on("close", () => {
        this.connected = false
        this.log("acfunlive-backend 连接已关闭")
      })
      acfunBackend.on("error", (error) => {
        this.lastError = formatError(error)
        this.log(`Backend 错误：${this.lastError}`)
      })
      acfunBackend.on("danmu", (message) => {
        this.handleDanmuMessage(message)
      })
    },
    async connect() {
      this.bindBackendEvents()
      acfunBackend.setUrl(this.backendUrl)
      await acfunBackend.connect()
      this.connected = true
    },
    async request(type, data, options) {
      await this.connect()
      try {
        return await acfunBackend.request(type, data, options)
      } catch (error) {
        if (isAuthExpiredError(error)) {
          this.handleAuthExpired("登录状态")
          throw new Error(AUTH_EXPIRED_MESSAGE)
        }
        if (this.tokenInfo && canRetryWithSavedToken(type) && isBackendNeedsLoginError(error)) {
          try {
            await this.ensureBackendToken()
            return await acfunBackend.request(type, data, options)
          } catch (retryError) {
            if (isAuthExpiredError(retryError)) {
              this.handleAuthExpired("登录状态")
              throw new Error(AUTH_EXPIRED_MESSAGE)
            }
            throw retryError
          }
        }
        throw error
      }
    },
    async ensureBackendToken() {
      if (!this.tokenInfo) {
        return
      }
      await this.connect()
      try {
        await acfunBackend.setToken(this.tokenInfo)
      } catch (error) {
        if (isAuthExpiredError(error)) {
          this.handleAuthExpired("恢复登录")
          throw new Error(AUTH_EXPIRED_MESSAGE)
        }
        throw error
      }
    },
    async restoreSession() {
      if (!this.tokenInfo) {
        return
      }
      try {
        await this.ensureBackendToken()
        const nextUserId = String(this.tokenInfo.userID || this.userId)
        if (nextUserId !== String(this.userId || "")) {
          this.finishLiveTimer(Date.now(), !(this.live.isLive || this.room.isLive))
          this.saveHistoryForCurrentUser()
        }
        this.userId = nextUserId
        this.loadHistoryForCurrentUser()
        this.persist()
        await this.refreshUser()
        await this.loadStartupLiveData()
        await this.startDanmu()
      } catch (error) {
        if (isAuthExpiredError(error)) {
          this.lastError = AUTH_EXPIRED_MESSAGE
          return
        }
        this.lastError = formatError(error)
        this.log(`恢复登录失败：${this.lastError}`)
      }
    },
    async login(account, password) {
      await this.connect()
      const tokenInfo = await acfunBackend.login(account, password)
      this.finishLiveTimer(Date.now(), !(this.live.isLive || this.room.isLive))
      this.saveHistoryForCurrentUser()
      this.tokenInfo = tokenInfo
      this.userId = String(tokenInfo.userID || "")
      await this.refreshUser()
      this.loadHistoryForCurrentUser()
      this.persist()
      this.log(`登录成功：${this.userName || this.userId}`)
      await this.loadStartupLiveData()
      await this.startDanmu()
    },
    async loginWithQRCode() {
      await this.connect()
      this.qrLogin = {
        status: "waiting",
        imageData: "",
        expireTime: 0,
      }
      try {
        const tokenInfo = await acfunBackend.loginWithQRCode((event) => {
          if (event.status === "qrcode") {
            this.qrLogin = {
              status: "qrcode",
              imageData: event.imageData || "",
              expireTime: event.expireTime || 0,
            }
          } else if (event.status === "scanned") {
            this.qrLogin.status = "scanned"
          }
        })
        this.finishLiveTimer(Date.now(), !(this.live.isLive || this.room.isLive))
        this.saveHistoryForCurrentUser()
        this.tokenInfo = tokenInfo
        this.userId = String(tokenInfo.userID || "")
        this.qrLogin.status = "success"
        await this.refreshUser()
        this.loadHistoryForCurrentUser()
        this.persist()
        this.log(`二维码登录成功：${this.userName || this.userId}`)
        await this.loadStartupLiveData()
        await this.startDanmu()
      } catch (error) {
        this.qrLogin.status = "error"
        this.lastError = formatError(error)
        this.log(`二维码登录失败：${this.lastError}`)
        throw error
      }
    },
    clearAccountSession({ closeBackend = true } = {}) {
      this.stopLiveTimelineSampler()
      this.saveHistoryForCurrentUser()
      this.tokenInfo = null
      this.userName = ""
      this.userId = ""
      this.userProfile = normalizeUserProfile()
      this.loadHistoryForCurrentUser()
      this.guardianClub.clubName = ""
      this.guardianClub.medalCount = 0
      this.guardianClub.rankList = []
      this.guardianClub.loading = false
      this.room.liveId = ""
      this.room.isLive = false
      this.room.onlineCount = 0
      this.room.likeCount = 0
      this.room.bananaCount = 0
      this.room.diamondCount = 0
      this.room.danmakuList = []
      this.room.watchingList = []
      this.room.managerList = []
      this.room.billList = []
      this.room.todayFansAdded = 0
      this.room.liveStartTime = 0
      this.room.accumulatedTime = 0
      this.live.isLive = false
      this.live.liveId = ""
      this.live.streamName = ""
      this.live.streamUrl = ""
      this.live.streamKey = ""
      this.live.transcodes = []
      this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
      if (closeBackend) {
        acfunBackend.close()
      }
      ttsService.stop()
      this.persist()
    },
    logout() {
      this.finishLiveTimer(Date.now(), !(this.live.isLive || this.room.isLive))
      this.clearAccountSession()
    },
    handleAuthExpired(context = "登录状态") {
      const hadSession = Boolean(this.tokenInfo || this.userId)
      if (!hadSession) {
        this.lastError = AUTH_EXPIRED_MESSAGE
        return
      }
      this.finishLiveTimer(Date.now(), true)
      this.clearAccountSession()
      this.lastError = AUTH_EXPIRED_MESSAGE
      this.log(`${context}：${AUTH_EXPIRED_MESSAGE}`)
    },
    async refreshUser() {
      if (!this.userId) {
        return
      }
      try {
        const info = await this.request(BackendTypes.GET_USER_INFO, { userID: Number(this.userId) })
        const profile = normalizeUserProfile(info, this.userId)
        this.userProfile = profile
        this.userName = profile.nickname || `UID ${this.userId}`
        if (profile.liveId) {
          this.room.liveId = profile.liveId
          this.live.liveId = profile.liveId
          this.room.isLive = true
          this.live.isLive = true
          this.markLiveTimerSeen(profile.liveId)
        }
      } catch (error) {
        if (isAuthExpiredError(error)) {
          throw error
        }
        this.userName = `UID ${this.userId}`
        this.userProfile = normalizeUserProfile({ nickname: this.userName }, this.userId)
      }
      this.loadGuardianList().catch(() => {})
    },
    switchToRoomIfLive() {
      if (this.room.isLive || this.live.isLive || this.room.liveId || this.live.liveId) {
        this.activeTab = "room"
      }
    },
    async loadStartupLiveData() {
      const jobs = [
        { name: "推流码", run: () => this.loadPushConfig() },
        { name: "直播状态", run: () => this.loadLiveStatus() },
        { name: "直播分类", run: () => this.loadLiveTypes() },
        { name: "直播间信息", run: () => this.loadRoom() },
        { name: "转码信息", run: () => this.loadTranscodeInfo() },
        { name: "录像剪辑权限", run: () => this.loadLiveCutStatus() },
      ]
      for (const job of jobs) {
        try {
          await job.run()
        } catch (error) {
          if (isAuthExpiredError(error)) {
            return
          }
          this.log(`${job.name}加载失败：${formatError(error)}`)
        }
      }
    },
    async startDanmu({ restart = false } = {}) {
      if (!this.userId) {
        return
      }
      if (restart) {
        try {
          await this.request(BackendTypes.STOP_DANMU, { liverUID: Number(this.userId) })
        } catch {
          // backend returns an error when nothing is subscribed yet — ignore
        }
      }
      try {
        const data = await this.request(BackendTypes.GET_DANMU, { liverUID: Number(this.userId) })
        if (data && data.StreamInfo) {
          const streamInfo = data.StreamInfo
          const liveInfo = data.LiveInfo || data.liveInfo || {}
          const displayInfo = liveInfo.displayInfo || liveInfo.DisplayInfo || streamInfo.displayInfo || streamInfo.DisplayInfo || {}
          this.room.isLive = true
          this.room.liveId = streamInfo.liveID || ""
          this.live.liveId = this.room.liveId || this.live.liveId
          this.live.isLive = true
          this.markLiveTimerSeen(this.room.liveId)
          this.live.streamName = streamInfo.streamName || this.live.streamName
          const onlineCount = parseCount(displayInfo.watchingCount, displayInfo.WatchingCount)
          if (onlineCount !== null) {
            this.room.onlineCount = onlineCount
          }
          const likeCount = parseCount(displayInfo.likeCount, displayInfo.LikeCount)
          if (likeCount !== null) {
            this.room.likeCount = likeCount
          }
          const bananaCount = parseCount(liveInfo.allBananaCount, liveInfo.AllBananaCount, streamInfo.allBananaCount, streamInfo.AllBananaCount)
          if (bananaCount !== null) {
            this.room.bananaCount = bananaCount
          }
          await this.loadTranscodeInfo()
          // 拿到 liveID 后异步拉取剪辑信息 + 当前剪辑权限开关，失败不阻塞弹幕监听
          this.loadLiveCutInfo().catch(() => {})
          this.loadLiveCutStatus().catch(() => {})
        }
      } catch (error) {
        const message = formatError(error)
        if (isAuthExpiredError(error) || message === AUTH_EXPIRED_MESSAGE) {
          return
        }
        // "直播已关播 / 主播未开播" 是预期未开播态，不污染用户日志，仅写控制台。
        const isOffline = /已关播|未开播|129004|380023/.test(message)
        if (isOffline) {
          console.info("[startDanmu]", message)
        } else {
          this.log(`弹幕监听未启动：${message}`)
        }
      }
    },
    async stopDanmu() {
      if (!this.userId || !this.connected) {
        return
      }
      try {
        await this.request(BackendTypes.STOP_DANMU, { liverUID: Number(this.userId) })
      } catch (error) {
        this.log(`弹幕监听停止失败：${formatError(error)}`)
      }
    },
    handleDanmuMessage(message) {
      let timelineChanged = false
      if (message.type === BackendDanmuTypes.DISPLAY_INFO && message.data) {
        const onlineCount = parseCount(message.data.watchingCount, message.data.WatchingCount)
        if (onlineCount !== null && Date.now() >= this.room.suppressOnlineCountUntil) {
          this.room.onlineCount = onlineCount
          timelineChanged = true
        }
        const likeCount = parseCount(message.data.likeCount, message.data.LikeCount)
        if (likeCount !== null) {
          this.room.likeCount = likeCount
        }
      }
      if (message.type === BackendDanmuTypes.BANANA_COUNT && message.data) {
        const bananaCount = parseCount(message.data.bananaCount, message.data.BananaCount)
        if (bananaCount !== null) {
          this.room.bananaCount = bananaCount
        }
      }
      if (message.type === BackendDanmuTypes.GIFT && message.data) {
        const giftDetail = message.data.giftDetail || {}
        if (giftDetail.payWalletType === 1) {
          const price = Number(giftDetail.price || 0)
          const count = Number(message.data.count || 1)
          const combo = Number(message.data.combo || 1)
          const addedDiamond = price * count * combo * 100
          this.room.diamondCount = (this.room.diamondCount || 0) + addedDiamond
        }
      }
      if (message.type === BackendDanmuTypes.FOLLOW_AUTHOR) {
        this.room.todayFansAdded = (this.room.todayFansAdded || 0) + 1
      }
      if (message.type === BackendDanmuTypes.TOP_USERS && Array.isArray(message.data)) {
        this.room.billList = message.data
          .map(normalizeWatchingUser)
          .filter((item) => amountValue(item.displaySendAmount) > 0)
          .sort((a, b) => amountValue(b.displaySendAmount) - amountValue(a.displaySendAmount))
      }
      if (message.type === BackendDanmuTypes.DANMU_STOP) {
        // 后端检测到主播关播会推 DANMU_STOP。
        // 任何"还有 liveId 但还没记历史"的情况都触发自动收尾，避免漏记。
        // handleAutoStop 内部自带防重入，多次触发只会清状态、不会重复写历史。
        const liveId = this.live.liveId || this.room.liveId || this.summary.liveId
        const needFinalize = !!liveId && !this.liveHistory.some((it) => it.liveId === liveId)
        if (needFinalize) {
          this.handleAutoStop("danmu stop").catch((error) => {
            this.log(`自动关播收尾失败：${formatError(error)}`)
          })
        } else {
          this.room.isLive = false
        }
      }
      if (message.type === BackendDanmuTypes.DANMU_STOP_ERROR) {
        const errorMessage = message.data?.error || "未知错误"
        if (isAuthExpiredError(message)) {
          this.handleAuthExpired("弹幕连接")
          return
        }
        this.log(`弹幕错误：${errorMessage}`)
      }

      const list = mapBackendDanmuMessage(message)
      const isRecent = message.type === BackendDanmuTypes.RECENT_COMMENT
      let newDanmakuCount = 0
      list.forEach((item) => {
        if (!this.isDuplicateDanmaku(item)) {
          this.room.danmakuList.unshift(item)
          newDanmakuCount += 1
          if (!isRecent && this.tts.enabled) {
            ttsService.speakDanmaku(item, this.tts, {
              sourceType: message.type,
              blockList: this.room.blockList,
            })
          }
          if (!isRecent) {
            this.handleInteractionDanmaku(item)
          }
        }
      })
      this.room.danmakuList = this.room.danmakuList.slice(0, 300)
      if (newDanmakuCount) {
        this.summary.danmakuCount = Number(this.summary.danmakuCount || 0) + newDanmakuCount
      }
      if (timelineChanged || newDanmakuCount) {
        this.pushLiveTimelinePoint()
      }
    },
    isDuplicateDanmaku(item) {
      const itemTime = Number(item.time || 0)
      return this.room.danmakuList.some((old) => {
        if (old.id === item.id) {
          return true
        }
        if (old.type !== item.type || old.content !== item.content) {
          return false
        }
        if (Number(old.userId || 0) !== Number(item.userId || 0)) {
          return false
        }
        const oldTime = Number(old.time || 0)
        return oldTime && itemTime && Math.abs(oldTime - itemTime) <= 3
      })
    },
    async loadRoom() {
      if (!this.userId) {
        return
      }
      try {
        const info = await this.request(BackendTypes.GET_USER_LIVE_INFO, { userID: Number(this.userId) })
        this.room.isLive = Boolean(info.liveID)
        this.room.liveId = info.liveID || ""
        this.room.onlineCount = info.onlineCount || 0
        const likeCount = parseCount(info.likeCount)
        if (likeCount !== null) {
          this.room.likeCount = likeCount
        }
        if (info.liveID) {
          this.live.liveId = info.liveID
          this.live.isLive = true
          this.markLiveTimerSeen(info.liveID)
          this.pushLiveTimelinePoint()
          this.persist()
          await this.loadWatchingList()
        } else {
          // GET_USER_LIVE_INFO 返回空 liveID → 主播未在直播。
          // 如果之前还认为在直播（timer/isLive/summary 任一有线索），自动走收尾，把本场写入历史。
          const uid = String(this.userId || "")
          const hadOngoingSession =
            this.live.isLive ||
            !!this.liveTimerByUser[uid]?.startedAt ||
            !!this.summary.liveId
          if (hadOngoingSession) {
            this.handleAutoStop("room offline").catch((error) => {
              this.log(`自动关播收尾失败：${formatError(error)}`)
            })
          } else {
            this.live.isLive = false
            this.live.liveId = ""
          }
        }
      } catch (error) {
        this.log(`直播间信息获取失败：${formatError(error)}`)
      }
    },
    async loadWatchingList() {
      if (!this.room.liveId) {
        return
      }
      const list = await this.request(BackendTypes.GET_WATCHING_LIST, { liveID: this.room.liveId })
      const normalized = Array.isArray(list) ? list.map(normalizeWatchingUser) : []
      this.room.watchingList = normalized.filter((item) => !item.anonymousUser)
      this.room.billList = this.room.watchingList
        .filter((item) => amountValue(item.displaySendAmount) > 0)
        .sort((a, b) => amountValue(b.displaySendAmount) - amountValue(a.displaySendAmount))

      for (const item of this.room.watchingList) {
        if (this.room.blockList.some((blocked) => Number(blocked.userId) === Number(item.userId))) {
          await this.kickUser(item)
        }
      }
    },
    async loadManagerList() {
      const list = await this.request(BackendTypes.GET_MANAGER_LIST)
      this.room.managerList = Array.isArray(list) ? list.map(normalizeManager) : []
    },
    async loadGuardianList() {
      if (!this.userId) {
        return
      }
      this.guardianClub.loading = true
      try {
        const payload = await this.request(BackendTypes.GET_MEDAL_RANK_LIST, {
          liverUID: Number(this.userId),
        })
        const normalized = normalizeGuardianList(payload)
        this.guardianClub.clubName = normalized.clubName
        this.guardianClub.medalCount = normalized.medalCount
        this.guardianClub.rankList = normalized.rankList
      } catch (error) {
        this.log(`守护团列表加载失败：${formatError(error)}`)
        throw error
      } finally {
        this.guardianClub.loading = false
      }
    },
    async addManager(user) {
      await this.request(BackendTypes.ADD_MANAGER, { managerUID: Number(user.userId) })
      this.log(`添加房管：${user.nickname} (${user.userId})`)
      await this.loadManagerList()
    },
    async addManagerByUid(uid) {
      const userId = Number(uid)
      if (!userId || isNaN(userId)) {
        throw new Error("请输入有效的 UID")
      }
      let nickname = `UID ${userId}`
      try {
        const info = await this.request(BackendTypes.GET_USER_INFO, { userID: userId })
        if (info && info.nickname) {
          nickname = info.nickname
        }
      } catch (error) {
        this.log(`获取用户(${userId})信息失败：${error.message || error}，将直接尝试添加`)
      }
      await this.request(BackendTypes.ADD_MANAGER, { managerUID: userId })
      this.log(`添加房管：${nickname} (${userId})`)
      await this.loadManagerList()
    },
    async deleteManager(user) {
      await this.request(BackendTypes.DELETE_MANAGER, { managerUID: Number(user.userId) })
      this.log(`移除房管：${user.nickname} (${user.userId})`)
      await this.loadManagerList()
    },
    async kickUser(user) {
      if (!this.room.liveId) {
        return
      }
      await this.request(BackendTypes.AUTHOR_KICK, {
        liveID: this.room.liveId,
        kickedUID: Number(user.userId),
      })
      this.log(`踢出观众：${user.nickname} (${user.userId})`)
    },
    blockUser(user) {
      if (!this.room.blockList.some((item) => Number(item.userId) === Number(user.userId))) {
        this.room.blockList.unshift({
          nickname: user.nickname,
          userId: user.userId,
        })
        this.persist()
      }
    },
    unblockUser(user) {
      this.room.blockList = this.room.blockList.filter((item) => Number(item.userId) !== Number(user.userId))
      this.persist()
    },
    async sendComment(content) {
      const text = String(content || "").trim()
      if (!text) {
        throw new Error("请输入弹幕内容")
      }
      const liveId = this.room.liveId || this.live.liveId
      if (!liveId) {
        throw new Error("当前没有直播间 liveID")
      }
      this.room.suppressOnlineCountUntil = Date.now() + 5000
      await this.request(BackendTypes.SEND_COMMENT, {
        liveID: liveId,
        liverUID: Number(this.userId),
        content: text,
        nickname: this.userName || "我",
        avatar: this.userProfile.avatar || "",
      })
      this.log(`弹幕已发送：${text}`)
    },
    // 发布一条动态（文字 / 图片）。imgs 为可选的图片数组 [{url,width,height}]。
    async addMoment(content, imgs) {
      const text = String(content || "").trim()
      const images = Array.isArray(imgs) ? imgs : []
      if (!text && images.length === 0) {
        throw new Error("动态内容不能为空")
      }
      if ([...text].length > 233) {
        throw new Error("内容长度必须为 1-233 字")
      }
      const data = await this.request(BackendTypes.ADD_MOMENT, {
        content: text,
        imgs: images,
      })
      this.log(`动态已发布：${text || "[图片]"}`)
      return data
    },
    // 拉取并聚合礼物统计（送出/收到记录，分页 pcursor）
    async loadGiftStats(options = {}) {
      const gs = this.giftStats
      const automatic = Boolean(options.automatic)
      const startedAt = Date.now()
      const stats = {
        pages: 0,
        records: 0,
        limited: false,
        limitReason: "",
      }
      const limitBy = (reason) => {
        stats.limited = true
        stats.limitReason = reason
      }
      gs.loading = true
      gs.error = ""
      gs.limited = false
      gs.limitReason = ""
      gs.progress = "准备中…"
      try {
        await this.ensureBackendToken()
        const fetchAll = async (kind) => {
          const allRecords = []
          let pcursor = "0"
          let pages = 0
          while (pcursor !== "no_more" && pages < GIFT_STATS_FULL_PAGE_LIMIT) {
            if (automatic && stats.pages >= GIFT_STATS_AUTO_PAGE_LIMIT) {
              limitBy(`自动统计已暂停：已读取 ${GIFT_STATS_AUTO_PAGE_LIMIT} 页`)
              break
            }
            if (automatic && stats.records >= GIFT_STATS_AUTO_RECORD_LIMIT) {
              limitBy(`自动统计已暂停：已读取 ${GIFT_STATS_AUTO_RECORD_LIMIT} 条记录`)
              break
            }
            if (automatic && Date.now() - startedAt >= GIFT_STATS_AUTO_TIME_LIMIT_MS) {
              limitBy("自动统计已暂停：读取时间超过 8 秒")
              break
            }
            const data = await this.request(BackendTypes.GET_REWARD_RECORDS, { kind, pcursor })
            const records = Array.isArray(data?.records) ? data.records : []
            allRecords.push(...records)
            pcursor = data?.pcursor || "no_more"
            pages += 1
            stats.pages += 1
            stats.records += records.length
            gs.progress = `${kind === "give" ? "送出" : "收到"}记录已读取 ${pages} 页…`
            if (records.length === 0 && pcursor !== "no_more") break
          }
          if (pcursor !== "no_more" && pages >= GIFT_STATS_FULL_PAGE_LIMIT) {
            limitBy(`已达到单类记录 ${GIFT_STATS_FULL_PAGE_LIMIT} 页安全上限`)
          }
          return allRecords
        }

        const sendRecords = await fetchAll("give")
        const receiveRecords = automatic && stats.limited ? [] : await fetchAll("receive")

        gs.sendRecords = sendRecords
        gs.receiveRecords = receiveRecords
        gs.fetchedAt = Date.now()
        gs.cacheRangeStart = giftStatsCacheStart(sendRecords, receiveRecords)
        gs.cacheRangeEnd = minuteEndTimestamp(gs.fetchedAt)
        gs.cacheComplete = !stats.limited
        gs.pagesRead = stats.pages
        gs.totalRecords = stats.records
        gs.limited = stats.limited
        gs.limitReason = stats.limitReason
        this.applyGiftStatsFilter()
        gs.progress = ""
        this.log(`礼物统计完成：送出 ${gs.sendAcoinTotal} AC币，收到 ${gs.receiveDiamondTotal} 钻石${gs.limited ? "（自动暂停）" : ""}`)
        return {
          limited: gs.limited,
          limitReason: gs.limitReason,
          totalRecords: gs.totalRecords,
          pagesRead: gs.pagesRead,
        }
      } catch (error) {
        gs.error = formatError(error)
        this.log(`礼物统计失败：${gs.error}`)
        throw error
      } finally {
        gs.loading = false
      }
    },
    // 拉取指定 liveID 的录播信息（GET_PLAYBACK），并把结果缓存到对应的历史记录上。
    // 关播后该 liveID 仍可继续查询，可用于"直播历史"里点开回放。
    async fetchPlayback(liveId) {
      const id = String(liveId || "").trim()
      if (!id) {
        return null
      }
      try {
        const data = await this.request(BackendTypes.GET_PLAYBACK, { liveID: id })
        const playback = {
          duration: Number(data?.duration) || 0,
          url: String(data?.url || ""),
          backupURL: String(data?.backupURL || ""),
        }
        this.setHistoryPlayback(id, playback)
        return playback
      } catch (error) {
        this.log(`回放获取失败 (${id})：${formatError(error)}`)
        throw error
      }
    },
    setHistoryPlayback(liveId, playback) {
      const id = String(liveId || "")
      if (!id) {
        return
      }
      // 仅更新内存中的 liveHistory；playback 不会持久化（normalizeLiveHistoryRecords 会剔除），
      // 所以这里不调用 persist()，避免不必要的存储写入。
      this.liveHistory = this.liveHistory.map((item) => (
        item.liveId === id ? { ...item, playback } : item
      ))
    },
    // 查询"是否允许观众剪辑本次直播录像"的开关状态（GET_LIVE_CUT_STATUS）。
    // 与 loadLiveCutInfo 互补：后者拿 url / redirectURL，本接口仅返回 canCut 布尔。
    async loadLiveCutStatus() {
      if (!this.userId) {
        return
      }
      try {
        const data = await this.request(BackendTypes.GET_LIVE_CUT_STATUS)
        this.live.liveCutInfo = {
          ...this.live.liveCutInfo,
          status: Boolean(data?.canCut),
        }
      } catch (error) {
        if (!isNotLiveError(error)) {
          this.log(`录像剪辑开关状态获取失败：${formatError(error)}`)
        }
      }
    },
    // 设置"是否允许观众剪辑本次直播录像"（SET_LIVE_CUT_STATUS）。
    // A 站后端限制：主播直播时无法修改（错误码 127017），需在开播前或关播后调用。
    // 成功后乐观更新本地 status，失败抛出错误由 UI 决定是否回滚。
    async setLiveCutCanCut(canCut) {
      if (!this.userId) {
        throw new Error("未登录，无法修改录像剪辑权限")
      }
      if (this.live.isLive) {
        throw new Error("直播中无法更改剪辑设置，请在开播前或关播后修改")
      }
      const next = Boolean(canCut)
      await this.request(BackendTypes.SET_LIVE_CUT_STATUS, { canCut: next })
      this.live.liveCutInfo = {
        ...this.live.liveCutInfo,
        status: next,
      }
      this.log(next ? "已允许观众剪辑本次录像" : "已设为仅主播可剪辑")
    },
    // 拉取直播剪辑信息（GET_LIVE_CUT_INFO），仅在主播当前在直播中可用。
    // 失败时若是"未开播/已关播"类错误则静默，避免日志刷屏。
    async loadLiveCutInfo() {
      if (!this.userId) {
        return
      }
      const liveId = this.live.liveId || this.room.liveId
      if (!liveId) {
        return
      }
      try {
        const data = await this.request(BackendTypes.GET_LIVE_CUT_INFO, {
          liverUID: Number(this.userId),
          liveID: liveId,
        })
        this.live.liveCutInfo = {
          status: Boolean(data?.status),
          url: String(data?.url || ""),
          redirectURL: String(data?.redirectURL || ""),
        }
      } catch (error) {
        if (!isNotLiveError(error)) {
          this.log(`直播剪辑信息获取失败：${formatError(error)}`)
        }
      }
    },
    async loadLiveStatus() {
      try {
        const status = await this.request(BackendTypes.GET_LIVE_STATUS)
        const liveId = status.liveID || ""
        this.live.isLive = Boolean(liveId)
        this.live.liveId = liveId
        this.live.title = status.title || this.live.title
        this.live.streamName = status.streamName || this.live.streamName
        if (liveId) {
          this.markLiveTimerSeen(liveId)
          this.pushLiveTimelinePoint()
          this.persist()
          this.loadLiveCutInfo().catch(() => {})
          this.loadLiveCutStatus().catch(() => {})
        } else {
          this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
        }
      } catch (error) {
        if (isNotLiveError(error)) {
          // 之前认为还在直播态，则走自动收尾，把本场写入历史；否则只清状态。
          const uid = String(this.userId || "")
          const hadOngoingSession =
            this.live.isLive ||
            this.room.isLive ||
            !!this.liveTimerByUser[uid]?.startedAt ||
            !!this.summary.liveId
          if (hadOngoingSession) {
            this.handleAutoStop("live status offline").catch((e) => {
              this.log(`自动关播收尾失败：${formatError(e)}`)
            })
            return
          }
          this.room.isLive = false
          this.room.liveId = ""
          this.finishLiveTimer(Date.now(), true)
          this.persist()
        }
        this.live.isLive = false
        this.live.liveId = ""
        this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
      }
    },
    async loadPushConfig() {
      let lastError
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const config = await this.request(BackendTypes.GET_PUSH_CONFIG, undefined, { timeout: 90000 })
          const nextStreamKey = config.streamKey || ""
          const previousStreamKey = this.live.streamKey
          this.live.streamName = config.streamName || ""
          this.live.streamUrl = config.rtmpServer || config.streamPushAddress?.[0] || ""
          this.live.streamKey = nextStreamKey
          this.persist()
          // 仅在 streamKey 实际变化时记录日志，避免未开播状态下被定时刷新反复刷屏
          if (this.live.streamUrl && nextStreamKey && nextStreamKey !== previousStreamKey) {
            this.log("推流码已获取")
          }
          return
        } catch (error) {
          lastError = error
          const message = formatError(error)
          if (!/server closed connection|EOF|timeout|reset|the server returned|peer/i.test(message)) {
            throw error
          }
          if (attempt === 3) {
            break
          }
          this.log(`getPushConfig 重试 (${attempt + 1}/3)：${message}`)
          await wait(400 + attempt * 600)
        }
      }
      throw lastError
    },
    async loadLiveTypes() {
      const list = await this.request(BackendTypes.GET_LIVE_TYPE_LIST)
      this.live.subCategories = Array.isArray(list) ? list : []
      const categories = new Map()
      this.live.subCategories.forEach((item) => {
        categories.set(item.categoryID, item.categoryName)
      })
      this.live.categories = Array.from(categories.entries()).map(([id, name]) => ({ id, name }))
      if (!this.live.categoryId && this.live.categories.length) {
        this.live.categoryId = this.live.categories[0].id
      }
      if (!this.live.subCategoryId && this.currentSubCategories.length) {
        this.live.subCategoryId = this.currentSubCategories[0].subCategoryID
      }
      this.persist()
    },
    async loadTranscodeInfo() {
      // 未开播时不应自动回退到 loadPushConfig，否则定时刷新会让推流码每 8s 拉一次。
      // 用户进入开播页或手动点"刷新转码"前会先调用 loadPushConfig；这里只在已有 streamName 时取转码。
      if (!this.live.streamName) {
        return
      }
      const list = await this.request(BackendTypes.GET_TRANSCODE_INFO, { streamName: this.live.streamName })
      this.live.transcodes = Array.isArray(list) ? list : []
    },
    setCoverFile(file) {
      const text = String(file || "").trim()
      this.live.coverFile = text
      if (text) {
        this.addCoverHistory(text)
      } else {
        this.persist()
      }
    },
    addCoverHistory(file) {
      const text = String(file || "").trim()
      if (!text) {
        return
      }
      this.live.coverHistory = [
        text,
        ...this.live.coverHistory.filter((item) => item !== text),
      ].slice(0, 12)
      this.persist()
    },
    removeCoverHistory(file) {
      this.live.coverHistory = this.live.coverHistory.filter((item) => item !== file)
      if (this.live.coverFile === file) {
        this.live.coverFile = ""
      }
      if (this.live.coverCrops && this.live.coverCrops[file]) {
        const next = { ...this.live.coverCrops }
        delete next[file]
        this.live.coverCrops = next
      }
      this.persist()
    },
    setCoverCrop(file, crop) {
      if (!file || !crop) return
      this.live.coverCrops = {
        ...this.live.coverCrops,
        [file]: {
          x: Number(crop.x) || 0,
          y: Number(crop.y) || 0,
          zoom: Number(crop.zoom) || 1,
          aspect: crop.aspect === "16:9" ? "16:9" : "16:10",
        },
      }
      this.persist()
    },
    clearCoverCrop(file) {
      if (!file || !this.live.coverCrops || !this.live.coverCrops[file]) return
      const next = { ...this.live.coverCrops }
      delete next[file]
      this.live.coverCrops = next
      this.persist()
    },
    async resolveUploadCover() {
      const file = this.live.coverFile
      if (!file) return ""
      const crop = this.live.coverCrops && this.live.coverCrops[file]
      if (!crop) return file
      if (/\.gif(?:$|[?#])/i.test(file)) return file
      const dataUrl = await readCoverFile(file)
      if (!dataUrl) return file
      const cropped = await renderCroppedDataUrl(dataUrl, crop)
      if (!cropped) return file
      const savedPath = await saveCoverImage(cropped)
      return savedPath || file
    },
    async startLive() {
      const coverFile = await this.resolveUploadCover()
      const data = await this.request(BackendTypes.START_LIVE, {
        title: this.live.title,
        coverFile,
        streamName: this.live.streamName,
        portrait: false,
        panoramic: false,
        categoryID: Number(this.live.categoryId),
        subCategoryID: Number(this.live.subCategoryId),
      })
      this.live.isLive = true
      this.live.isLive = true
      this.room.liveId = data.liveID
      this.room.isLive = true
      this.room.diamondCount = 0
      this.room.todayFansAdded = 0
      this.startLiveTimer(data.liveID)
      this.room.accumulatedTime = 0
      this.summary.liveId = data.liveID
      this.summary.timeline = []
      this.summary.danmakuCount = 0
      this.pushLiveTimelinePoint(true)
      this.persist()
      this.log(`开播成功：${data.liveID}`)
      await this.startDanmu({ restart: true })
      await this.loadRoom()
    },
    // 任意自动检测到关播的路径都走这里收尾：
    //   - DANMU_STOP 弹幕事件
    //   - loadRoom 看到 GET_USER_LIVE_INFO 返回 liveID 为空
    //   - loadLiveStatus 看到 "未开播/已关播" 错误
    // 与 stopLive 不同：不向后端调 STOP_LIVE，但仍要 finishLiveTimer + persistLiveRecord
    // + 异步 loadSummary / stopDanmu / 可选 stopObsStream。
    //
    // 防重入：基于 liveHistory 是否已包含该 liveId 判重，重复触发只清状态不再写历史。
    async handleAutoStop(reason = "danmu stop") {
      const liveId = this.live.liveId || this.room.liveId || this.summary.liveId
      if (!liveId) {
        this.live.isLive = false
        this.room.isLive = false
        this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
        return
      }
      // 已经记录过这场 → 只清状态
      if (this.liveHistory.some((item) => item.liveId === liveId)) {
        this.live.isLive = false
        this.room.isLive = false
        this.live.liveId = ""
        this.room.liveId = ""
        this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
        return
      }
      this.live.isLive = false
      this.room.isLive = false
      this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
      this.summary.liveId = liveId
      this.summary.endReason = this.summary.endReason || reason
      this.summary.endedAt = this.summary.endedAt || new Date().toLocaleString()
      // 用本场计时器估算 duration，避免历史里出现 00:00:00。
      // finishLiveTimer 之后 liveStartTime 会被清零，必须先算。
      if (!this.summary.duration || this.summary.duration === "00:00:00") {
        const sessionMs = this.room.liveStartTime ? Math.max(0, Date.now() - this.room.liveStartTime) : 0
        if (sessionMs > 0) {
          this.summary.duration = this.formatDuration(sessionMs)
        }
      }
      this.finishLiveTimer(Date.now(), false)
      this.pushLiveTimelinePoint(true)
      this.persistLiveRecord()
      this.live.liveId = ""
      this.room.liveId = ""
      this.log(`检测到关播 (${reason})，已保存本场直播记录`)
      this.loadSummary(liveId).catch((error) => {
        this.log(`直播统计获取失败：${formatError(error)}`)
      })
      this.stopDanmu().catch(() => {})
      if (this.obs.enabled && this.obs.stopStreamingAfterClose) {
        this.stopObsStream().catch((error) => {
          this.log(`OBS 停止推流失败：${formatError(error)}`)
        })
      }
    },
    async stopLive() {
      if (!this.live.liveId && !this.room.liveId) {
        return
      }
      const liveId = this.live.liveId || this.room.liveId
      const info = await this.request(BackendTypes.STOP_LIVE, { liveID: liveId })
      this.live.isLive = false
      this.room.isLive = false
      this.live.liveId = ""
      this.room.liveId = ""
      this.live.liveCutInfo = { status: false, url: "", redirectURL: "" }
      this.finishLiveTimer(Date.now(), false)
      this.summary.liveId = liveId
      this.summary.endReason = info.endReason || "author stopped"
      this.summary.endedAt = new Date().toLocaleString()
      this.summary.duration = this.formatDuration(info.duration || 0)
      this.pushLiveTimelinePoint(true)
      this.persistLiveRecord()
      this.log(`直播已停止：${info.endReason || "author stopped"}`)
      try {
        await this.stopDanmu()
      } catch {
        // ignore
      }
      if (this.obs.enabled && this.obs.stopStreamingAfterClose) {
        try {
          await this.stopObsStream()
        } catch (error) {
          this.log(`OBS 停止推流失败：${formatError(error)}`)
        }
      }
      try {
        await this.loadSummary(liveId)
      } catch (error) {
        this.log(`直播统计获取失败：${formatError(error)}`)
      }
    },
    getObsOptions() {
      return {
        url: normalizeObsUrl(this.obs.url),
        password: this.obs.password,
      }
    },
    getObsClient() {
      const options = this.getObsOptions()
      const key = JSON.stringify(options)
      if (obsClient && obsClientKey === key && obsClient.isConnected()) {
        return obsClient
      }
      obsClientUnsubscribers.forEach((unsubscribe) => unsubscribe())
      obsClientUnsubscribers = []
      if (obsClient && obsClient.isConnected()) {
        obsClient.disconnect()
      }
      obsClient = new ObsWebSocketClient(options)
      obsClientKey = key
      obsClientUnsubscribers = [
        obsClient.on("event", (event) => this.handleObsEvent(event)),
        obsClient.on("close", () => {
          this.obs.connected = false
          this.obs.streaming = false
          if (!obsPreserveRestoreOnClose) {
            this.obs.shouldRestoreConnection = false
          }
          this.obs.autoStartStatus = "idle"
          this.persist()
          this.log("OBS WebSocket 连接已关闭")
        }),
        obsClient.on("error", (error) => {
          this.obs.lastError = formatError(error)
          this.log(`OBS WebSocket 错误：${this.obs.lastError}`)
        }),
      ]
      return obsClient
    },
    async connectObsClient({ syncBrowserSource = true } = {}) {
      const client = this.getObsClient()
      const shouldSyncBrowserSource = syncBrowserSource && !client.isConnected()
      await client.connect()
      this.obs.connected = true
      this.obs.enabled = true
      this.obs.shouldRestoreConnection = true
      this.obs.lastError = ""
      this.obs.url = normalizeObsUrl(this.obs.url)
      this.persist()
      if (shouldSyncBrowserSource && this.obs.syncBrowserSourceOnConnect) {
        await this.syncObsBrowserSourceUrl({ client, force: true, required: false, silent: true })
      }
      return client
    },
    setObsBrowserSourceUrl(url) {
      this.obs.browserSourceUrl = String(url || "").trim()
    },
    async syncObsBrowserSourceUrl({
      client = null,
      force = false,
      required = true,
      silent = false,
    } = {}) {
      if (!this.obs.syncBrowserSourceOnConnect && !force) {
        return false
      }

      const inputName = String(this.obs.browserSourceName || "").trim()
      const url = String(this.obs.browserSourceUrl || "").trim()
      if (!inputName) {
        if (required && !silent) {
          throw new Error("请先填写 OBS 浏览器源名称")
        }
        return false
      }
      if (!url) {
        if (required && !silent) {
          throw new Error("浏览器来源 URL 尚未初始化")
        }
        return false
      }
      if (!client && !this.obs.connected) {
        throw new Error("请先连接 OBS")
      }

      if (
        !force
        && this.obs.lastBrowserSourceSyncedSourceName === inputName
        && this.obs.lastBrowserSourceSyncedUrl === url
      ) {
        return false
      }

      try {
        const obs = client || await this.connectObsClient({ syncBrowserSource: false })
        await obs.request("SetInputSettings", {
          inputName,
          inputSettings: { url },
          overlay: true,
        })
        await obs.request("PressInputPropertiesButton", {
          inputName,
          propertyName: "refreshnocache",
        })
        this.obs.connected = true
        this.obs.enabled = true
        this.obs.lastError = ""
        this.obs.lastBrowserSourceSyncedSourceName = inputName
        this.obs.lastBrowserSourceSyncedUrl = url
        this.persist()
        this.log(`已同步并刷新 OBS 浏览器源：${inputName}`)
        return true
      } catch (error) {
        const message = formatError(error)
        this.obs.lastError = message
        this.log(`OBS 浏览器源 URL 同步或刷新失败：${message}`)
        if (!silent) {
          throw error
        }
        return false
      }
    },
    async restoreObsConnection() {
      if (!this.obs.shouldRestoreConnection) {
        return
      }
      try {
        const obs = await this.connectObsClient()
        await this.syncObsStreamStatus(obs)
        this.log("OBS WebSocket 已自动重连")
      } catch (error) {
        this.obs.connected = false
        this.obs.streaming = false
        this.obs.shouldRestoreConnection = false
        this.obs.autoStartStatus = "idle"
        this.obs.lastError = formatError(error)
        this.persist()
        this.log(`OBS 自动重连失败：${this.obs.lastError}`)
      }
    },
    rememberObsConnectionForNextLaunch() {
      obsPreserveRestoreOnClose = true
      this.obs.shouldRestoreConnection = Boolean(this.obs.connected)
      this.persist()
    },
    handleObsEvent(event) {
      if (event?.eventType !== "StreamStateChanged") {
        return
      }
      const eventData = event.eventData || {}
      const outputActive = Boolean(eventData.outputActive)
      this.obs.streaming = outputActive
      this.obs.connected = true
      if (outputActive) {
        obsObservedStreaming = true
        this.obs.lastStreamStopped = false
      } else {
        if (!obsObservedStreaming && !this.obs.streaming) {
          return
        }
        obsObservedStreaming = false
        this.obs.lastStreamStopped = true
        this.obs.autoStartStatus = "idle"
      }
    },
    async syncObsStreamStatus(client) {
      const obs = client || await this.connectObsClient()
      const status = await obs.request("GetStreamStatus")
      const outputActive = Boolean(status.outputActive)
      if (this.obs.streaming && !outputActive) {
        this.obs.lastStreamStopped = true
      }
      if (outputActive) {
        obsObservedStreaming = true
      }
      this.obs.connected = true
      this.obs.streaming = outputActive
      this.obs.enabled = true
      this.obs.lastError = ""
      this.persist()
      return status
    },
    async testObsConnection() {
      const obs = await this.connectObsClient()
      await this.syncObsStreamStatus(obs)
      await this.pushObsStreamSettings()
      this.log("OBS WebSocket 连接成功")
    },
    disconnectObs() {
      this.obs.shouldRestoreConnection = false
      this.obs.autoStartStatus = "idle"
      if (obsClient && obsClient.isConnected()) {
        obsClient.disconnect()
      } else {
        this.obs.connected = false
        this.obs.streaming = false
      }
      this.persist()
      this.log("已主动断开 OBS WebSocket")
    },
    async pushObsStreamSettings() {
      if (!this.live.streamUrl || !this.live.streamKey) {
        await this.loadPushConfig()
      }
      if (!this.live.streamUrl || !this.live.streamKey) {
        throw new Error("缺少推流地址或串流密钥")
      }

      const obs = await this.connectObsClient()
      await obs.request("SetStreamServiceSettings", {
        streamServiceType: "rtmp_common",
        streamServiceSettings: {
          service: "Custom",
          server: this.live.streamUrl,
          key: this.live.streamKey,
          use_auth: false,
        },
      })
      this.obs.connected = true
      this.obs.enabled = true
      this.obs.lastError = ""
      this.persist()
      this.log("已写入 OBS 推流地址和串流密钥")
    },
    async startObsStream() {
      const obs = await this.connectObsClient()
      await obs.request("StartStream")
      await this.syncObsStreamStatus(obs)
      this.obs.streaming = true
      this.obs.lastStreamStopped = false
      this.persist()
      this.log("OBS 已开始推流")
    },
    async stopObsStream() {
      const obs = await this.connectObsClient()
      const status = await obs.request("GetStreamStatus")
      if (status.outputActive) {
        await obs.request("StopStream")
      }
      this.obs.connected = true
      this.obs.streaming = false
      this.obs.lastStreamStopped = true
      this.obs.autoStartStatus = "idle"
      this.obs.lastError = ""
      this.persist()
      this.log("OBS 已停止推流")
    },
    async startObsAndAutoLive() {
      try {
        this.progress = "正在拉取推流配置…"
        await this.loadPushConfig()
        this.progress = "写入 OBS 推流参数…"
        await this.pushObsStreamSettings()
        this.progress = "启动 OBS 推流…"
        await this.startObsStream()
        if (this.obs.autoStartLive) {
          return await this.waitForStreamAndStartLive()
        }
        return false
      } finally {
        this.progress = ""
      }
    },
    async waitForStreamAndStartLive() {
      if (this.live.isLive || this.room.isLive) {
        return true
      }
      if (!this.live.streamName) {
        await this.loadPushConfig()
      }
      if (!this.live.streamName) {
        throw new Error("缺少 streamName，无法检测转码")
      }

      this.obs.autoStartStatus = "waiting"
      const attempts = 36
      const intervalMs = 5000
      let sawObsStreaming = obsObservedStreaming
      for (let index = 0; index < attempts; index += 1) {
        this.progress = `等待 AcFun 接收 OBS 推流（${index + 1}/${attempts}）…`
        const status = await this.syncObsStreamStatus()
        if (status.outputActive) {
          sawObsStreaming = true
        }
        if (!status.outputActive && sawObsStreaming) {
          this.obs.autoStartStatus = "idle"
          this.obs.lastStreamStopped = true
          throw new Error("OBS 已断流，已停止等待开播")
        }
        await this.loadTranscodeInfo()
        if (this.live.transcodes.length > 0) {
          this.obs.autoStartStatus = "starting"
          this.progress = "检测到推流，正在开播…"
          await this.startLive()
          this.obs.autoStartStatus = "live"
          this.log("检测到 OBS 推流到账，已自动开播")
          return true
        }
        await wait(intervalMs)
      }
      this.obs.autoStartStatus = "idle"
      throw new Error("等待 AcFun 接收到 OBS 推流超时")
    },
    async changeTitleAndCover() {
      const liveId = this.live.liveId || this.room.liveId
      if (!liveId) {
        return
      }
      const coverFile = await this.resolveUploadCover()
      await this.request(BackendTypes.CHANGE_TITLE_AND_COVER, {
        title: this.live.title,
        coverFile,
        liveID: liveId,
      })
      this.persist()
      this.log("标题和封面已更新")
    },
    async loadSummary(liveId) {
      if (!liveId) {
        return
      }
      const data = await this.request(BackendTypes.GET_SUMMARY, { liveID: liveId })
      this.summary.liveId = liveId
      this.summary.endReason = this.summary.endReason || data.endReason || ""
      this.summary.endedAt = this.summary.endedAt || new Date().toLocaleString()
      this.summary.diamond = data.diamondCount || 0
      this.summary.gift = data.giftCount || 0
      this.summary.banana = data.bananaCount || 0
      this.summary.watchCount = data.watchCount || 0
      this.summary.likeCount = data.likeCount || 0
      if (data.duration !== undefined && data.duration !== null) {
        this.summary.duration = this.formatDuration(data.duration || 0)
      }
      this.persistLiveRecord()
    },
    formatDuration(ms) {
      const totalSeconds = Math.floor(ms / 1000)
      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0")
      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0")
      const seconds = String(totalSeconds % 60).padStart(2, "0")
      return `${hours}:${minutes}:${seconds}`
    },
  },
})
