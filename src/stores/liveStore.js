import { defineStore } from "pinia"
import {
  acfunBackend,
  BackendDanmuTypes,
  BackendTypes,
  LegacyDanmuTypes,
  mapBackendDanmuMessage,
  normalizeManager,
  normalizeWatchingUser,
} from "@/services/acfunBackend"
import { ObsWebSocketClient } from "@/services/obsWebSocket"
import { appendLog as appendNativeLog, readCoverFile, saveCoverImage } from "@/services/nativeBridge"

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

function demoLiveHistoryRecord() {
  const baseTime = Date.now() - 1000 * 60 * 30
  let danmakuCount = 0
  const timeline = Array.from({ length: 61 }, (_, index) => {
    const onlineCount = Math.max(0, Math.round(24 + index * 3.4 + Math.sin(index / 3) * 18 + Math.sin(index / 9) * 32))
    danmakuCount += Math.max(0, Math.round(2 + Math.sin(index / 2) * 2 + index / 9))
    return {
      time: baseTime + index * 30 * 1000,
      onlineCount,
      danmakuCount,
    }
  })
  const lastPoint = timeline[timeline.length - 1]
  return {
    id: "demo-live-history-chart",
    liveId: "demo-live-history-chart",
    title: "测试直播曲线数据",
    coverFile: "",
    endedAt: new Date(baseTime + 30 * 60 * 1000).toLocaleString(),
    endReason: "demo",
    duration: "00:30:00",
    watchCount: lastPoint.onlineCount,
    likeCount: 862,
    danmakuCount: lastPoint.danmakuCount,
    diamond: 128,
    gift: 36,
    banana: 52,
    timeline,
  }
}

function defaultState() {
  const saved = loadSavedState()
  const savedOverlay = saved.overlay || {}
  const savedObs = saved.obs || {}
  const savedUi = saved.ui || {}
  const savedProfile = saved.userProfile || {}
  const demoHistory = demoLiveHistoryRecord()
  const savedLiveHistory = Array.isArray(saved.liveHistory) ? saved.liveHistory : []
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
      suppressOnlineCountUntil: 0,
      danmakuList: [],
      watchingList: [],
      managerList: [],
      billList: [],
      blockList: saved.blockList || [],
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
    liveHistory: [
      demoHistory,
      ...savedLiveHistory.filter((item) => item.liveId !== demoHistory.liveId),
    ].slice(0, 100),
    overlay: {
      width: savedOverlay.width || 420,
      height: savedOverlay.height || 720,
      maxItems: savedOverlay.maxItems || 18,
      fontSize: savedOverlay.fontSize || 18,
      fontFamily: savedOverlay.fontFamily || "Microsoft YaHei, Noto Sans SC, sans-serif",
      nameFontFamily: savedOverlay.nameFontFamily || savedOverlay.fontFamily || "Microsoft YaHei, Noto Sans SC, sans-serif",
      contentFontFamily: savedOverlay.contentFontFamily || savedOverlay.fontFamily || "Microsoft YaHei, Noto Sans SC, sans-serif",
      textColor: savedOverlay.textColor || "#ffffff",
      nameColor: savedOverlay.nameColor || "#fd4c5d",
      bubbleColor: savedOverlay.bubbleColor || "rgba(36, 27, 32, 0.78)",
      bubbleEnabled: savedOverlay.bubbleEnabled !== false,
      showAvatar: savedOverlay.showAvatar !== false,
      animation: savedOverlay.animation || "slide",
      rounded: savedOverlay.rounded || 18,
      gap: savedOverlay.gap || 10,
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
    },
    qrLogin: {
      status: "idle",
      imageData: "",
      expireTime: 0,
    },
  }
}

export const useLiveStore = defineStore("live", {
  state: defaultState,
  getters: {
    isLoggedIn: (state) => Boolean(state.tokenInfo && state.userId),
    currentSubCategories: (state) => state.live.subCategories.filter((item) => item.categoryID === state.live.categoryId),
  },
  actions: {
    persist() {
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
        liveHistory: this.liveHistory,
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
    async restoreSession() {
      if (!this.tokenInfo) {
        return
      }
      try {
        await this.connect()
        await acfunBackend.setToken(this.tokenInfo)
        this.userId = String(this.tokenInfo.userID || this.userId)
        await this.refreshUser()
        this.activeTab = "live"
        await this.loadStartupLiveData()
        await this.startDanmu()
        this.switchToRoomIfLive()
      } catch (error) {
        this.lastError = formatError(error)
        this.log(`恢复登录失败：${this.lastError}`)
      }
    },
    async login(account, password) {
      await this.connect()
      const tokenInfo = await acfunBackend.login(account, password)
      this.tokenInfo = tokenInfo
      this.userId = String(tokenInfo.userID || "")
      await this.refreshUser()
      this.persist()
      this.log(`登录成功：${this.userName || this.userId}`)
      this.activeTab = "live"
      await this.loadStartupLiveData()
      await this.startDanmu()
      this.switchToRoomIfLive()
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
        this.tokenInfo = tokenInfo
        this.userId = String(tokenInfo.userID || "")
        this.qrLogin.status = "success"
        await this.refreshUser()
        this.persist()
        this.log(`二维码登录成功：${this.userName || this.userId}`)
        this.activeTab = "live"
        await this.loadStartupLiveData()
        await this.startDanmu()
        this.switchToRoomIfLive()
      } catch (error) {
        this.qrLogin.status = "error"
        this.lastError = formatError(error)
        this.log(`二维码登录失败：${this.lastError}`)
        throw error
      }
    },
    logout() {
      this.tokenInfo = null
      this.userName = ""
      this.userId = ""
      this.userProfile = normalizeUserProfile()
      this.room.liveId = ""
      this.room.isLive = false
      this.room.onlineCount = 0
      this.room.likeCount = 0
      this.room.bananaCount = 0
      this.room.danmakuList = []
      this.room.watchingList = []
      this.room.managerList = []
      this.room.billList = []
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
        }
      } catch {
        this.userName = `UID ${this.userId}`
        this.userProfile = normalizeUserProfile({ nickname: this.userName }, this.userId)
      }
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
        }
      } catch (error) {
        this.log(`弹幕监听未启动：${formatError(error)}`)
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
      if (message.type === BackendDanmuTypes.TOP_USERS && Array.isArray(message.data)) {
        this.room.billList = message.data
          .map(normalizeWatchingUser)
          .filter((item) => amountValue(item.displaySendAmount) > 0)
          .sort((a, b) => amountValue(b.displaySendAmount) - amountValue(a.displaySendAmount))
      }
      if (message.type === BackendDanmuTypes.DANMU_STOP) {
        this.room.isLive = false
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
        }
        if (info.liveID) {
          await this.loadWatchingList()
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
    async addManager(user) {
      await this.request(BackendTypes.ADD_MANAGER, { managerUID: Number(user.userId) })
      this.log(`添加房管：${user.nickname} (${user.userId})`)
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
    async loadLiveStatus() {
      try {
        const status = await this.request(BackendTypes.GET_LIVE_STATUS)
        this.live.isLive = true
        this.live.liveId = status.liveID || ""
        this.live.title = status.title || this.live.title
        this.live.streamName = status.streamName || this.live.streamName
      } catch {
        this.live.isLive = false
        this.live.liveId = ""
      }
    },
    async loadPushConfig() {
      let lastError
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const config = await this.request(BackendTypes.GET_PUSH_CONFIG, undefined, { timeout: 90000 })
          this.live.streamName = config.streamName || ""
          this.live.streamUrl = config.rtmpServer || config.streamPushAddress?.[0] || ""
          this.live.streamKey = config.streamKey || ""
          this.persist()
          if (this.live.streamUrl && this.live.streamKey) {
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
      if (!this.live.streamName) {
        await this.loadPushConfig()
      }
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
      this.live.liveId = data.liveID
      this.room.liveId = data.liveID
      this.room.isLive = true
      this.summary.liveId = data.liveID
      this.summary.timeline = []
      this.summary.danmakuCount = 0
      this.pushLiveTimelinePoint(true)
      this.persist()
      this.log(`开播成功：${data.liveID}`)
      await this.startDanmu({ restart: true })
      await this.loadRoom()
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
