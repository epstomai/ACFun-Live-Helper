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
import { handleTtsDanmaku } from "@/services/tts"

const STORAGE_KEY = "aclivehelper.state.v1"
let obsClient = null
let obsClientKey = ""
let obsClientUnsubscribers = []
let obsObservedStreaming = false
let obsPreserveRestoreOnClose = false

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

function formatError(error) {
  return error && error.message ? error.message : String(error)
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

function defaultState() {
  const saved = loadSavedState()
  const savedOverlay = saved.overlay || {}
  const savedObs = saved.obs || {}
  const savedUi = saved.ui || {}
  const savedProfile = saved.userProfile || {}
  const liveHistoryByUser = loadLiveHistoryByUser(saved)
  const liveDailyStatsByUser = normalizeLiveDailyStatsByUser(saved.liveDailyStatsByUser)
  const liveTimerByUser = normalizeLiveTimerByUser(saved.liveTimerByUser)
  const currentUid = String(saved.userId || "")
  const savedLiveHistory = currentUid && Array.isArray(liveHistoryByUser[currentUid])
    ? liveHistoryByUser[currentUid]
    : []
  return {
    backendUrl: saved.backendUrl || "ws://localhost:15368/",
    connected: false,
    lastError: "",
    tokenInfo: saved.tokenInfo || null,
    userName: saved.userName || "",
    userId: saved.userId || "",
    userProfile: normalizeUserProfile(savedProfile, saved.userId || ""),
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
      connected: false,
      streaming: false,
      shouldRestoreConnection: savedObs.shouldRestoreConnection || false,
      lastStreamStopped: false,
      autoStartLive: savedObs.autoStartLive !== false,
      stopStreamingAfterClose: savedObs.stopStreamingAfterClose || false,
      autoStartStatus: "idle",
      lastError: "",
    },
    summary: {
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
    },
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
    ui: {
      theme: savedUi.theme === "dark" ? "dark" : "light",
      sidebarCollapsed: Boolean(savedUi.sidebarCollapsed),
      uiScale: Math.min(1.3, Math.max(0.8, Number(savedUi.uiScale) || 1)),
      guardianClubVisible: savedUi.guardianClubVisible !== false,
    },
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
        overlay: this.overlay,
        obs: {
          enabled: this.obs.enabled,
          url: this.obs.url,
          password: this.obs.password,
          shouldRestoreConnection: this.obs.shouldRestoreConnection,
          autoStartLive: this.obs.autoStartLive,
          stopStreamingAfterClose: this.obs.stopStreamingAfterClose,
        },
        ui: this.ui,
      }))
    },
    setTheme(theme) {
      this.ui.theme = theme === "dark" ? "dark" : "light"
      this.persist()
    },
    toggleTheme() {
      this.setTheme(this.ui.theme === "dark" ? "light" : "dark")
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
    startLiveTimer(liveId, timestamp = Date.now()) {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      const liveIdText = String(liveId || "")
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
    },
    markLiveTimerSeen(liveId, timestamp = Date.now()) {
      const uid = String(this.userId || "")
      if (!uid) {
        return
      }
      const liveIdText = String(liveId || "")
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
      return acfunBackend.request(type, data, options)
    },
    async ensureBackendToken() {
      if (!this.tokenInfo) {
        return
      }
      await this.connect()
      await acfunBackend.setToken(this.tokenInfo)
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
    logout() {
      this.finishLiveTimer(Date.now(), !(this.live.isLive || this.room.isLive))
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
      acfunBackend.close()
      this.persist()
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
      } catch {
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
        this.log(`弹幕错误：${message.data?.error || "未知错误"}`)
      }

      const list = mapBackendDanmuMessage(message)
      let newDanmakuCount = 0
      list.forEach((item) => {
        if (!this.isDuplicateDanmaku(item)) {
          this.room.danmakuList.unshift(item)
          newDanmakuCount += 1

          // === [TTS Debug] 打印收到的弹幕详情 ===
          console.log("[TTS Debug] liveStore 成功接收到一条【未重复】的弹幕:", {
            nickname: item.nickname,
            content: item.content,
            type: item.type,
            isGift: item.isGift
          });

          try {
            handleTtsDanmaku(item)
          } catch (e) {
            console.error("[TTS Debug] TTS 语音合成调用失败:", e)
          }
        } else {
          // 如果弹幕被判定为重复，也会打印出来，方便排查是不是被去重拦截了
          console.log("[TTS Debug] 收到一条弹幕，但被去重机制拦截了:", item.content);
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
    async connectObsClient() {
      const client = this.getObsClient()
      await client.connect()
      this.obs.connected = true
      this.obs.enabled = true
      this.obs.shouldRestoreConnection = true
      this.obs.lastError = ""
      this.obs.url = normalizeObsUrl(this.obs.url)
      this.persist()
      return client
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
