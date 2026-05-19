import assert from "node:assert"
import {
  AcfunBackendClient,
  BackendDanmuTypes,
  BackendTypes,
  mapBackendDanmuMessage,
  normalizeWatchingUser,
} from "../src/services/acfunBackend.js"

class FakeWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    FakeWebSocket.instances.push(this)
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  close() {
    this.readyState = 3
    if (this.onclose) {
      this.onclose({})
    }
  }

  open() {
    this.readyState = 1
    if (this.onopen) {
      this.onopen({})
    }
  }

  receive(payload) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(payload) })
    }
  }
}

FakeWebSocket.instances = []

async function testRequestResponse() {
  const client = new AcfunBackendClient({
    url: "ws://example.test/",
    WebSocketImpl: FakeWebSocket,
    heartbeatInterval: 60000,
    requestTimeout: 1000,
  })

  const connectPromise = client.connect()
  const socket = FakeWebSocket.instances[0]
  socket.open()
  await connectPromise

  const loginPromise = client.login("account", "password")
  await Promise.resolve()
  assert.strictEqual(socket.sent[0].type, BackendTypes.LOGIN)
  assert.deepStrictEqual(socket.sent[0].data, {
    account: "account",
    password: "password",
  })

  socket.receive({
    type: BackendTypes.LOGIN,
    requestID: socket.sent[0].requestID,
    result: 1,
    data: {
      tokenInfo: {
        userID: 123,
        serviceToken: "token",
      },
    },
  })

  const tokenInfo = await loginPromise
  assert.strictEqual(tokenInfo.userID, 123)
  client.close()
}

function testDanmuMapping() {
  const comment = mapBackendDanmuMessage({
    liverUID: 100,
    type: BackendDanmuTypes.COMMENT,
    data: {
      danmuInfo: {
        sendTime: 1608379795363,
        userInfo: {
          userID: 666609,
          nickname: "tester",
        },
      },
      content: "hello",
    },
  })

  assert.strictEqual(comment.length, 1)
  assert.strictEqual(comment[0].nickname, "tester")
  assert.strictEqual(comment[0].content, "hello")
  assert.strictEqual(comment[0].time, 1608379795)

  const gift = mapBackendDanmuMessage({
    liverUID: 100,
    type: BackendDanmuTypes.GIFT,
    data: {
      danmuInfo: {
        sendTime: 1608379838216,
        userInfo: {
          userID: 532848,
          nickname: "gift-user",
        },
      },
      giftDetail: {
        giftName: "打 Call",
      },
      count: 5,
      combo: 2,
    },
  })

  assert.strictEqual(gift[0].isGift, true)
  assert.strictEqual(gift[0].content, "打 Call")
  assert.strictEqual(gift[0].num, 10)
}

function testWatchingUserMapping() {
  const user = normalizeWatchingUser({
    anonymousUser: false,
    displaySendAmount: "1.2 万",
    userInfo: {
      userID: 541323,
      nickname: "viewer",
      avatar: "avatar.png",
      managerType: 1,
    },
  })

  assert.strictEqual(user.userId, 541323)
  assert.strictEqual(user.nickname, "viewer")
  assert.strictEqual(user.managerType, 1)
}

await testRequestResponse()
testDanmuMapping()
testWatchingUserMapping()
