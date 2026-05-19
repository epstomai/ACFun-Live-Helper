const OBS_OP = Object.freeze({
  HELLO: 0,
  IDENTIFY: 1,
  IDENTIFIED: 2,
  REQUEST: 6,
  REQUEST_RESPONSE: 7,
})

let requestSeed = 0

function base64FromBytes(bytes) {
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

async function sha256Base64(text) {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return base64FromBytes(new Uint8Array(hash))
}

async function makeAuthentication(password, salt, challenge) {
  const secret = await sha256Base64(`${password}${salt}`)
  return sha256Base64(`${secret}${challenge}`)
}

export class ObsRequestError extends Error {
  constructor(requestType, status = {}) {
    super(status.comment || `OBS request ${requestType} failed`)
    this.name = "ObsRequestError"
    this.requestType = requestType
    this.status = status
  }
}

export class ObsWebSocketClient {
  constructor(options = {}) {
    this.url = options.url || "ws://127.0.0.1:4455"
    this.password = options.password || ""
    this.WebSocketImpl = options.WebSocketImpl
    this.requestTimeout = options.requestTimeout || 10000
    this.socket = null
    this.pending = new Map()
    this.listeners = new Map()
  }

  isConnected() {
    return this.socket && this.socket.readyState === 1
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

    const SocketImpl = this.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null)
    if (!SocketImpl) {
      return Promise.reject(new Error("WebSocket is not available in this environment"))
    }

    this.socket = new SocketImpl(this.url)

    return new Promise((resolve, reject) => {
      let settled = false

      const fail = (error) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }

      this.socket.onerror = () => {
        fail(new Error(`无法连接 OBS WebSocket：${this.url}`))
      }

      this.socket.onclose = () => {
        this.rejectPending(new Error("OBS WebSocket 连接已关闭"))
        this.emit("close")
        if (!settled) {
          fail(new Error(`无法连接 OBS WebSocket：${this.url}`))
        }
      }

      this.socket.onmessage = async (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch (error) {
          this.emit("error", error)
          return
        }

        if (message.op === OBS_OP.HELLO) {
          try {
            const identify = { rpcVersion: 1 }
            const authentication = message.d?.authentication
            if (authentication) {
              if (!this.password) {
                throw new Error("OBS WebSocket 需要密码")
              }
              identify.authentication = await makeAuthentication(
                this.password,
                authentication.salt,
                authentication.challenge,
              )
            }
            this.send({ op: OBS_OP.IDENTIFY, d: identify })
          } catch (error) {
            fail(error)
          }
          return
        }

        if (message.op === OBS_OP.IDENTIFIED) {
          finish()
          return
        }

        this.handleMessage(message)
      }
    })
  }

  disconnect() {
    this.rejectPending(new Error("OBS WebSocket 连接已关闭"))
    if (this.socket) {
      this.socket.close()
      this.socket = null
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
      throw new Error("OBS WebSocket 未连接")
    }
    this.socket.send(JSON.stringify(payload))
  }

  async request(requestType, requestData = {}) {
    await this.connect()
    const requestId = `${Date.now()}-${++requestSeed}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`OBS request ${requestType} timed out`))
      }, this.requestTimeout)

      this.pending.set(requestId, {
        timer,
        requestType,
        resolve,
        reject,
      })

      try {
        this.send({
          op: OBS_OP.REQUEST,
          d: {
            requestId,
            requestType,
            requestData,
          },
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  handleMessage(message) {
    if (message.op !== OBS_OP.REQUEST_RESPONSE) {
      if (message.d?.eventType) {
        this.emit("event", message.d)
      }
      return
    }

    const requestId = message.d?.requestId
    const pending = requestId ? this.pending.get(requestId) : null
    if (!pending) {
      return
    }

    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    const status = message.d?.requestStatus || {}
    if (status.result) {
      pending.resolve(message.d?.responseData || {})
    } else {
      pending.reject(new ObsRequestError(pending.requestType, status))
    }
  }
}

export async function withObsClient(options, task) {
  const client = new ObsWebSocketClient(options)
  try {
    await client.connect()
    return await task(client)
  } finally {
    client.disconnect()
  }
}

export default {
  ObsWebSocketClient,
  ObsRequestError,
  withObsClient,
}
