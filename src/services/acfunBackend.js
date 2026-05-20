export const BackendTypes = Object.freeze({
  HEARTBEAT: 1,
  LOGIN: 2,
  SET_CLIENT_ID: 3,
  REQUEST_FORWARD_DATA: 4,
  FORWARD_DATA: 5,
  SET_TOKEN: 6,
  QR_CODE_LOGIN: 7,
  QR_CODE_SCANNED: 8,
  QR_CODE_LOGIN_CANCEL: 9,
  QR_CODE_LOGIN_SUCCESS: 10,

  GET_DANMU: 100,
  STOP_DANMU: 101,
  GET_WATCHING_LIST: 102,
  GET_BILLBOARD: 103,
  GET_SUMMARY: 104,
  GET_LUCK_LIST: 105,
  GET_PLAYBACK: 106,
  GET_ALL_GIFT_LIST: 107,
  GET_WALLET_BALANCE: 108,
  GET_USER_LIVE_INFO: 109,
  GET_ALL_LIVE_LIST: 110,
  GET_LIVE_DATA: 112,
  GET_GIFT_LIST: 114,
  GET_USER_INFO: 115,
  GET_LIVE_CUT_INFO: 116,

  GET_MANAGER_LIST: 200,
  ADD_MANAGER: 201,
  DELETE_MANAGER: 202,
  GET_ALL_KICK_HISTORY: 203,
  MANAGER_KICK: 204,
  AUTHOR_KICK: 205,

  GET_MEDAL_RANK_LIST: 302,

  CHECK_LIVE_AUTH: 900,
  GET_LIVE_TYPE_LIST: 901,
  GET_PUSH_CONFIG: 902,
  GET_LIVE_STATUS: 903,
  GET_TRANSCODE_INFO: 904,
  START_LIVE: 905,
  STOP_LIVE: 906,
  CHANGE_TITLE_AND_COVER: 907,
  GET_LIVE_CUT_STATUS: 908,
  SET_LIVE_CUT_STATUS: 909,
  SEND_COMMENT: 910,
})

export const BackendDanmuTypes = Object.freeze({
  COMMENT: 1000,
  LIKE: 1001,
  ENTER_ROOM: 1002,
  FOLLOW_AUTHOR: 1003,
  THROW_BANANA: 1004,
  GIFT: 1005,
  RICH_TEXT: 1006,
  JOIN_CLUB: 1007,
  SHARE_LIVE: 1008,
  DANMU_STOP: 2000,
  BANANA_COUNT: 2001,
  DISPLAY_INFO: 2002,
  TOP_USERS: 2003,
  RECENT_COMMENT: 2004,
  REDPACK_LIST: 2005,
  DANMU_STOP_ERROR: 2999,
})

export const LegacyDanmuTypes = Object.freeze({
  JOIN_ROOM: 1,
  ADD_TEXT: 2,
  ADD_GIFT: 3,
  ADD_FOLLOW: 10,
  ADD_JOIN_GROUP: 11,
})

let requestSeed = 0

export class BackendRequestError extends Error {
  constructor(response) {
    super(response && response.error ? response.error : "Backend request failed")
    this.name = "BackendRequestError"
    this.response = response
    this.result = response ? response.result : undefined
  }
}

export class AcfunBackendClient {
  constructor(options = {}) {
    this.url = options.url || "ws://localhost:15368/"
    this.WebSocketImpl = options.WebSocketImpl
    this.heartbeatInterval = options.heartbeatInterval || 5000
    this.requestTimeout = options.requestTimeout || 90000
    this.socket = null
    this.connectPromise = null
    this.pending = new Map()
    this.listeners = new Map()
    this.heartbeatTimer = null
    this.manuallyClosed = false
  }

  isConnected() {
    return this.socket && this.socket.readyState === 1
  }

  setUrl(url) {
    if (url && url !== this.url) {
      this.url = url
    }
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set())
    }
    this.listeners.get(eventName).add(handler)
    return () => this.off(eventName, handler)
  }

  off(eventName, handler) {
    const listeners = this.listeners.get(eventName)
    if (listeners) {
      listeners.delete(handler)
    }
  }

  emit(eventName, payload) {
    const listeners = this.listeners.get(eventName)
    if (listeners) {
      listeners.forEach((handler) => handler(payload))
    }
  }

  connect() {
    if (this.isConnected()) {
      return Promise.resolve()
    }
    if (this.connectPromise) {
      return this.connectPromise
    }

    const SocketImpl = this.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null)
    if (!SocketImpl) {
      return Promise.reject(new Error("WebSocket is not available in this environment"))
    }

    this.manuallyClosed = false
    this.socket = new SocketImpl(this.url)
    this.connectPromise = new Promise((resolve, reject) => {
      const socket = this.socket
      let settled = false

      socket.onopen = () => {
        settled = true
        this.connectPromise = null
        this.startHeartbeat()
        this.emit("open")
        resolve()
      }

      socket.onerror = (event) => {
        this.emit("error", event)
        if (!settled) {
          settled = true
          this.connectPromise = null
          reject(new Error(`Cannot connect to acfunlive-backend at ${this.url}`))
        }
      }

      socket.onclose = (event) => {
        this.stopHeartbeat()
        this.connectPromise = null
        this.rejectPending(new Error("Backend WebSocket connection closed"))
        this.emit("close", event)
        if (!settled) {
          settled = true
          reject(new Error(`Cannot connect to acfunlive-backend at ${this.url}`))
        }
      }

      socket.onmessage = (event) => this.handleMessage(event)
    })

    return this.connectPromise
  }

  close() {
    this.manuallyClosed = true
    this.stopHeartbeat()
    this.rejectPending(new Error("Backend WebSocket connection closed"))
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: BackendTypes.HEARTBEAT })
      }
    }, this.heartbeatInterval)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  rejectPending(error) {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
    this.pending.clear()
  }

  send(payload) {
    if (!this.isConnected()) {
      throw new Error("Backend WebSocket is not connected")
    }
    this.socket.send(JSON.stringify(payload))
  }

  async request(type, data, options = {}) {
    await this.connect()
    const requestID = options.requestID || `${Date.now()}-${++requestSeed}`
    const payload = { type, requestID }
    if (data !== undefined) {
      payload.data = data
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestID)
        reject(new Error(`Backend request ${type} timed out`))
      }, options.timeout || this.requestTimeout)

      this.pending.set(requestID, {
        type,
        timer,
        resolve,
        reject,
        raw: Boolean(options.raw),
      })

      try {
        this.send(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestID)
        reject(error)
      }
    })
  }

  async login(account, password) {
    const response = await this.request(BackendTypes.LOGIN, { account, password })
    return response && response.tokenInfo ? response.tokenInfo : null
  }

  async loginWithQRCode(onStatus = () => {}, options = {}) {
    await this.connect()
    const requestID = options.requestID || `${Date.now()}-${++requestSeed}`
    const timeout = options.timeout || 180000

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.off("message", handleMessage)
      }
      const finish = (handler, value) => {
        cleanup()
        handler(value)
      }
      const timer = setTimeout(() => {
        finish(reject, new Error("二维码登录超时"))
      }, timeout)
      const handleMessage = (message) => {
        if (!message || message.requestID !== requestID) {
          return
        }

        if (message.result !== undefined && message.result !== 1) {
          finish(reject, new BackendRequestError(message))
          return
        }

        if (message.type === BackendTypes.QR_CODE_LOGIN) {
          onStatus({
            status: "qrcode",
            imageData: message.data ? message.data.imageData : "",
            expireTime: message.data ? message.data.expireTime : 0,
          })
          return
        }

        if (message.type === BackendTypes.QR_CODE_SCANNED) {
          onStatus({ status: "scanned" })
          return
        }

        if (message.type === BackendTypes.QR_CODE_LOGIN_CANCEL) {
          finish(reject, new Error("二维码已过期或登录已取消"))
          return
        }

        if (message.type === BackendTypes.QR_CODE_LOGIN_SUCCESS) {
          const tokenInfo = message.data && message.data.tokenInfo ? message.data.tokenInfo : null
          if (!tokenInfo) {
            finish(reject, new Error("二维码登录成功响应缺少 tokenInfo"))
            return
          }
          finish(resolve, tokenInfo)
        }
      }

      this.on("message", handleMessage)
      try {
        this.send({ type: BackendTypes.QR_CODE_LOGIN, requestID })
      } catch (error) {
        finish(reject, error)
      }
    })
  }

  async setToken(tokenInfo) {
    await this.request(BackendTypes.SET_TOKEN, tokenInfo)
    return tokenInfo
  }

  handleMessage(event) {
    let message
    try {
      message = JSON.parse(event.data)
    } catch (error) {
      this.emit("error", error)
      return
    }

    this.emit("message", message)

    if (message.type === BackendTypes.HEARTBEAT && message.result === undefined) {
      this.emit("heartbeat", message)
      return
    }

    if (message.liverUID !== undefined && message.type !== undefined) {
      this.emit("danmu", message)
      return
    }

    const pending = message.requestID ? this.pending.get(message.requestID) : null
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(message.requestID)
      if (message.result === 1) {
        pending.resolve(pending.raw ? message : message.data)
      } else {
        pending.reject(new BackendRequestError(message))
      }
    }
  }
}

function getUserInfo(payload) {
  if (!payload) {
    return {}
  }
  if (payload.userInfo) {
    return payload.userInfo
  }
  if (payload.danmuInfo && payload.danmuInfo.userInfo) {
    return payload.danmuInfo.userInfo
  }
  if (payload.fansInfo) {
    return payload.fansInfo
  }
  return {}
}

function toSeconds(time) {
  if (!time) {
    return Math.floor(Date.now() / 1000)
  }
  return time > 9999999999 ? Math.floor(time / 1000) : time
}

function legacyDanmaku(message, overrides = {}) {
  const data = message.data || {}
  const userInfo = overrides.userInfo || getUserInfo(data)
  const content = overrides.content || data.content || ""
  const time = overrides.time || data.sendTime || (data.danmuInfo && data.danmuInfo.sendTime)
  const num = overrides.num || 1
  const type = overrides.type || LegacyDanmuTypes.ADD_TEXT
  const id = overrides.id || `${message.liverUID}-${message.type}-${time || Date.now()}-${userInfo.userID || 0}-${content}`

  return {
    nickname: userInfo.nickname || userInfo.name || "匿名用户",
    userId: userInfo.userID || userInfo.userId || 0,
    content,
    time: toSeconds(time),
    isGift: Boolean(overrides.isGift),
    num,
    id,
    uniqueId: `${Date.now()}-${id}`,
    type,
  }
}

function richTextToContent(data) {
  const segments = data && Array.isArray(data.segments) ? data.segments : []
  return segments.map((item) => {
    const segment = item.segment || {}
    if (segment.userInfo) {
      return segment.userInfo.nickname || ""
    }
    if (segment.text) {
      return segment.text
    }
    if (segment.alternativeText) {
      return segment.alternativeText
    }
    if (Array.isArray(segment.pictures) && segment.pictures.length) {
      return "[图片]"
    }
    return ""
  }).join("")
}

export function mapBackendDanmuMessage(message) {
  const data = message.data || {}
  switch (message.type) {
    case BackendDanmuTypes.COMMENT:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_TEXT,
        content: data.content,
      })]
    case BackendDanmuTypes.GIFT: {
      const count = Number(data.count || 1)
      const combo = Number(data.combo || 1)
      const giftDetail = data.giftDetail || {}
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_GIFT,
        content: giftDetail.giftName || "礼物",
        num: count * combo,
        isGift: true,
      })]
    }
    case BackendDanmuTypes.THROW_BANANA:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_GIFT,
        content: "香蕉",
        num: Number(data.bananaCount || 1),
        isGift: true,
      })]
    case BackendDanmuTypes.FOLLOW_AUTHOR:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_FOLLOW,
        content: "关注了主播",
      })]
    case BackendDanmuTypes.ENTER_ROOM:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.JOIN_ROOM,
        content: "进入了直播间",
      })]
    case BackendDanmuTypes.JOIN_CLUB:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_JOIN_GROUP,
        content: "加入了守护团",
        userInfo: data.fansInfo,
        time: data.joinTime,
      })]
    case BackendDanmuTypes.RICH_TEXT:
      return [legacyDanmaku(message, {
        type: LegacyDanmuTypes.ADD_TEXT,
        content: richTextToContent(data),
        time: data.sendTime,
      })]
    case BackendDanmuTypes.RECENT_COMMENT:
      return Array.isArray(data) ? data.map((item) => legacyDanmaku({
        liverUID: message.liverUID,
        type: BackendDanmuTypes.COMMENT,
        data: item,
      }, {
        type: LegacyDanmuTypes.ADD_TEXT,
        content: item.content,
      })) : []
    default:
      return []
  }
}

export function normalizeWatchingUser(item) {
  const userInfo = item && item.userInfo ? item.userInfo : {}
  return {
    ...item,
    nickname: userInfo.nickname || item.nickname || "",
    userId: userInfo.userID || item.userId || 0,
    avatar: userInfo.avatar || item.avatar || "",
    managerType: userInfo.managerType || item.managerType || 0,
  }
}

export function normalizeManager(item) {
  const userInfo = item && item.userInfo ? item.userInfo : item
  const avatar = userInfo?.avatar || item?.avatar || ""
  const avatarUrl = Array.isArray(avatar) ? avatar[0]?.url : avatar?.url || avatar
  return {
    ...item,
    nickname: userInfo?.nickname || userInfo?.name || item?.nickname || item?.name || "",
    userId: userInfo?.userID || userInfo?.userId || item?.userID || item?.userId || 0,
    avatar: avatarUrl || "",
  }
}

function pickAvatarUrl(value) {
  if (!value) return ""
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const it of value) {
      const u = pickAvatarUrl(it)
      if (u) return u
    }
    return ""
  }
  if (typeof value === "object") {
    return value.url || value.cdnUrl || value.avatar || value.headUrl || value.userHeadUrl || ""
  }
  return ""
}

// AcFun 守护榜接口（GET_MEDAL_RANK_LIST）返回结构：
//   { hasFansClub, clubName, medalCount, rankList: [{ profile: {userID, nickname, avatar, ...}, friendshipDegree, level }] }
export function normalizeGuardian(item, index = 0) {
  const src = item || {}
  const user = src.profile || src.userInfo || src.user || src.fansInfo || src.fan || src
  const avatarRaw =
    user?.userHeadUrl ||
    user?.headUrl ||
    user?.avatar ||
    user?.headPic ||
    user?.avatarUrl ||
    src.userHeadUrl ||
    src.headUrl ||
    src.avatar ||
    src.headPic ||
    ""
  return {
    rank: Number(src.rank ?? src.ranking ?? src.no ?? index + 1) || index + 1,
    userId: String(
      user?.userID ||
      user?.userId ||
      user?.uid ||
      user?.id ||
      src.userID ||
      src.userId ||
      src.uid ||
      src.id ||
      ""
    ),
    nickname:
      user?.userName ||
      user?.nickname ||
      user?.nickName ||
      user?.name ||
      src.userName ||
      src.nickname ||
      src.nickName ||
      src.name ||
      "",
    avatar: pickAvatarUrl(avatarRaw),
    medalLevel: Number(
      src.level ??
      src.medalLevel ??
      src.uperBadgeLevel ??
      src.fansLevel ??
      src.fanLevel ??
      user?.level ??
      0
    ) || 0,
    intimacy: Number(
      src.friendshipDegree ??
      src.intimacy ??
      src.fanIntimacy ??
      src.score ??
      src.fanScore ??
      src.value ??
      0
    ) || 0,
    clubName:
      src.clubName ||
      src.uperBadgeName ||
      src.badgeName ||
      src.medalName ||
      "",
  }
}

export function normalizeGuardianList(payload) {
  if (!payload) {
    return { clubName: "", medalCount: 0, rankList: [] }
  }
  // 后端可能直接返回 AcFun 原始响应，或嵌套在 data 字段下
  const root = payload && payload.data && typeof payload.data === "object" ? payload.data : payload
  const rawList = Array.isArray(root)
    ? root
    : root.friendshipDegreeRank ||
      root.rankList ||
      root.list ||
      root.medalRankList ||
      root.userRankList ||
      root.fansClubList ||
      root.data ||
      root.items ||
      []
  const rankList = Array.isArray(rawList)
    ? rawList.map((item, index) => normalizeGuardian(item, index))
    : []
  const clubName =
    (root && (root.clubName || root.uperBadgeName || root.badgeName || root.medalName)) ||
    rankList.find((m) => m.clubName)?.clubName ||
    ""
  const medalCount = Number(
    (root && (root.medalCount ?? root.totalCount ?? root.fansTotalCount ?? root.fansCount ?? root.count)) ??
    rankList.length
  ) || rankList.length
  return { clubName, medalCount, rankList }
}

export const acfunBackend = new AcfunBackendClient()

export default {
  AcfunBackendClient,
  BackendRequestError,
  BackendTypes,
  BackendDanmuTypes,
  LegacyDanmuTypes,
  acfunBackend,
  mapBackendDanmuMessage,
  normalizeWatchingUser,
  normalizeManager,
  normalizeGuardian,
  normalizeGuardianList,
}
