package backend

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/orzogc/acfundanmu"
	"github.com/segmentio/encoding/json"
	"github.com/ugjka/messenger"
	"github.com/valyala/fastjson"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

//go:generate go run github.com/ACFUN-FOSS/acfunlive-backend/cmd -o cmd_gen.go

// Options controls the embedded backend WebSocket server.
type Options struct {
	Port   int
	Debug  bool
	TCP    bool
	LogAll bool
}

// newAcFunLiveWithRetry wraps acfundanmu.NewAcFunLive with a few quick retries
// to absorb transient upstream fasthttp connection errors. AcFun's API
// occasionally closes idle keep-alive conns; fasthttp evicts the bad conn on
// each error so subsequent attempts pick up a fresh one.
func newAcFunLiveWithRetry(opts ...acfundanmu.Option) (*acfundanmu.AcFunLive, error) {
	const maxAttempts = 7
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		ac, err := acfundanmu.NewAcFunLive(opts...)
		if err == nil {
			return ac, nil
		}
		lastErr = err
		if !isTransientUpstreamError(err.Error()) {
			return nil, err
		}
		if attempt < maxAttempts-1 {
			time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
		}
	}
	return nil, lastErr
}

// DefaultPort is the default WebSocket port the backend listens on.
const DefaultPort = 15368

// Start launches the embedded acfunlive-backend WebSocket server.
// It returns after the listener has been spawned in a background goroutine.
func Start(opts Options) error {
	if opts.Port < 1024 || opts.Port >= 65536 {
		opts.Port = DefaultPort
	}

	debugFlag := opts.Debug || opts.LogAll
	tcpFlag := opts.TCP
	logAllFlag := opts.LogAll
	isDebug = &debugFlag
	isTCP = &tcpFlag
	isLogAll = &logAllFlag

	server_ch = messenger.New(1024, false)

	mux := http.NewServeMux()
	mux.HandleFunc("/", wsHandler)

	addr := fmt.Sprintf("127.0.0.1:%d", opts.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: timeout,
		IdleTimeout:       idleTimeout,
	}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("acfunlive-backend WebSocket server error: %v", err)
		}
	}()
	debug("WebSocket server is running, the port is %d", opts.Port)
	return nil
}

func danmuClient() acfundanmu.DanmuClient {
	if *isTCP {
		return &acfundanmu.TCPDanmuClient{}
	}
	return &acfundanmu.WebSocketDanmuClient{}
}

// 打印调试信息
func debug(format string, v ...interface{}) {
	if *isDebug {
		log.Printf(format, v...)
	}
}

// 打印调试信息
func (conn *wsConn) debug(format string, v ...interface{}) {
	if *isDebug {
		addr := fmt.Sprintf("[%s] ", conn.remoteAddr)
		log.Printf(addr+format, v...)
	}
}

// 打印调试信息，isLogAll 为 true 才会打印
func (conn *wsConn) debugAll(format string, v ...interface{}) {
	if *isDebug && *isLogAll {
		addr := fmt.Sprintf("[%s] ", conn.remoteAddr)
		log.Printf(addr+format, v...)
	}
}

// 发送 WebSocket 消息
func (conn *wsConn) send(msg string) error {
	conn.debugAll("Send message: %s", msg)
	conn.writeMu.Lock()
	defer conn.writeMu.Unlock()
	_ = conn.c.SetWriteDeadline(time.Now().Add(timeout))
	err := conn.c.WriteMessage(websocket.TextMessage, []byte(msg))
	if err != nil {
		conn.debug("Failed to send message: %s, error: %v", msg, err)
	}
	return err
}

// 处理 WebSocket 连接
func wsHandler(w http.ResponseWriter, r *http.Request) {
	c, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	conn := &wsConn{
		c:          c,
		remoteAddr: c.RemoteAddr().String(),
	}
	_ = c.SetReadDeadline(time.Now().Add(idleTimeout))
	c.SetPongHandler(func(string) error {
		return c.SetReadDeadline(time.Now().Add(idleTimeout))
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer conn.c.Close()
	defer conn.debug("WebSocket connection close")
	conn.debug("WebSocket connection open")

	forward_ch, err := server_ch.Sub()
	if err != nil {
		conn.debug("Server's main channel has been killed")
		return
	}
	defer server_ch.Unsub(forward_ch)

	var pool fastjson.ParserPool
	var msg []byte
	var clientID string
	// map(int64, *acLive)
	acMap := new(sync.Map)
	var mu sync.RWMutex
	var ac *acLive
	var data []byte

	go func() {
		for {
			msg, ok := <-forward_ch
			if ok {
				switch msg := msg.(type) {
				case *forwardMsg:
					if msg.clientID == "" || msg.clientID == clientID {
						data, err := json.Marshal(msg)
						if err != nil {
							conn.debug("Forward message error: cannot marshal to json: %+v", msg)
							go conn.send(fmt.Sprintf(respErrJSON, forwardDataType, quote(msg.requestID), reqHandleErr, quote(err.Error())))
						} else {
							go conn.send(fmt.Sprintf(respJSON, forwardDataType, quote(msg.requestID), string(data)))
						}
					}
				case *broadcastMsg:
					if msg.clientID == "" || msg.clientID == clientID {
						go conn.send(msg.Message)
					}
				}
			} else {
				break
			}
		}
	}()

	for {
		_, msg, err = c.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				conn.debug("WebSocket error: %v", err)
			}
			break
		}
		_ = c.SetReadDeadline(time.Now().Add(idleTimeout))

		p := pool.Get()
		v, err := p.ParseBytes(msg)
		if err != nil {
			conn.debug("Parsing json error: %v, request data: %s", err, string(msg))
			go conn.send(fmt.Sprintf(respErrJSON, 0, "", jsonParseErr, quote(fmt.Sprintf("error: %v, request data: %s", err, string(msg)))))
			pool.Put(p)
			continue
		}

		reqType := v.GetInt("type")
		reqID := string(v.GetStringBytes("requestID"))
		if reqType != loginType && reqType != setTokenType {
			conn.debugAll("Recieve message: %s", string(msg))
		}
		mu.RLock()
		if ac == nil && reqType != heartbeatType && reqType != loginType && reqType != setClientIDType && reqType != requestForwardDataType && reqType != setTokenType && reqType != QRCodeLoginType {
			go conn.send(fmt.Sprintf(respErrJSON, reqType, quote(reqID), needLogin, quote("Need login or token")))
			pool.Put(p)
			mu.RUnlock()
			continue
		}
		mu.RUnlock()

		switch reqType {
		case heartbeatType:
			go conn.send(heartbeatJSON)
			pool.Put(p)
		case loginType:
			account := string(v.GetStringBytes("data", "account"))
			password := string(v.GetStringBytes("data", "password"))
			go func() {
				resp := conn.login(acMap, account, password, reqID)
				if aci, ok := acMap.Load(0); ok {
					mu.Lock()
					ac = aci.(*acLive)
					mu.Unlock()
				}
				_ = conn.send(resp)
			}()
			pool.Put(p)
		case QRCodeLoginType:
			go func() {
				resp := conn.loginWithQRCode(acMap, reqID)
				if aci, ok := acMap.Load(0); ok {
					mu.Lock()
					ac = aci.(*acLive)
					mu.Unlock()
				}
				_ = conn.send(resp)
			}()
			pool.Put(p)
		case setClientIDType:
			clientID = string(v.GetStringBytes("data", "clientID"))
			go conn.send(fmt.Sprintf(respNoDataJSON, setClientIDType, quote(reqID)))
			pool.Put(p)
		case requestForwardDataType:
			msg := new(forwardMsg)
			msg.requestID = reqID
			msg.SourceID = clientID
			msg.clientID = string(v.GetStringBytes("data", "clientID"))
			msg.Message = string(v.GetStringBytes("data", "message"))
			go func() {
				server_ch.Broadcast(msg)
				_ = conn.send(fmt.Sprintf(respNoDataJSON, requestForwardDataType, quote(reqID)))
			}()
			pool.Put(p)
		case setTokenType:
			conn.debug("Client sets token")
			data = v.Get("data").MarshalTo(data[:0])
			token := new(acfundanmu.TokenInfo)
			if err := json.Unmarshal(data, token); err != nil {
				go conn.send(fmt.Sprintf(respErrJSON, reqType, quote(reqID), invalidReqData, quote(fmt.Sprintf("Failed to unmarshal data to TokenInfo: %v", err))))
				pool.Put(p)
				continue
			}
			newAC, err := newAcFunLiveWithRetry(acfundanmu.SetTokenInfo(token), acfundanmu.SetDanmuClient(danmuClient()))
			if err != nil {
				go conn.send(fmt.Sprintf(respErrJSON, reqType, quote(reqID), reqHandleErr, quote(fmt.Sprintf("Failed to set TokenInfo: %v", err))))
				pool.Put(p)
				continue
			}
			mu.Lock()
			ac = &acLive{
				conn: conn,
				ac:   newAC,
			}
			acMap.Store(0, ac)
			mu.Unlock()
			go conn.send(fmt.Sprintf(respNoDataJSON, reqType, quote(reqID)))
			pool.Put(p)
		case getDanmuType:
			uid := v.GetInt64("data", "liverUID")
			if uid <= 0 {
				conn.debug("getDanmu: liverUID not exist or less than 1")
				go conn.send(fmt.Sprintf(respErrJSON, getDanmuType, quote(reqID), invalidReqData, quote("liverUID not exist or less than 1")))
			} else {
				go conn.getDanmu(ctx, cancel, acMap, uid, reqID)
			}
			pool.Put(p)
		case stopDanmuType:
			uid := v.GetInt64("data", "liverUID")
			if uid <= 0 {
				conn.debug("stopDanmu: liverUID not exist or less than 1")
				go conn.send(fmt.Sprintf(respErrJSON, stopDanmuType, quote(reqID), invalidReqData, quote("liverUID not exist or less than 1")))
			} else {
				go conn.stopDanmu(acMap, uid, reqID)
			}
			pool.Put(p)
		case getLiveCutInfoType:
			go func() {
				mu.Lock()
				resp := ac.getLiveCutInfo(v, reqID)
				mu.Unlock()
				_ = conn.send(resp)
				conn.debug("Return the live cut info's response to the client")
				pool.Put(p)
			}()
		case sendCommentType:
			go func() {
				mu.Lock()
				commentAC := ac
				uid := v.GetInt64("data", "liverUID")
				if uid > 0 {
					if aci, ok := acMap.Load(uid); ok {
						if roomAC, ok := aci.(*acLive); ok && roomAC != nil && roomAC.ac != nil {
							commentAC = roomAC
						}
					}
				}
				resp := commentAC.sendComment(v, reqID)
				mu.Unlock()
				_ = conn.send(resp)
				pool.Put(p)
			}()
		default:
			if f, ok := cmdDispatch[reqType]; ok {
				go func() {
					mu.Lock()
					resp := f(ac, v, reqID)
					mu.Unlock()
					_ = conn.send(resp)
					pool.Put(p)
				}()
			} else {
				conn.debug("Error: unknown request type: %d", reqType)
				go conn.send(fmt.Sprintf(respErrJSON, reqType, quote(reqID), invalidReqType, quote("Unknown request type")))
				pool.Put(p)
			}
		}
	}
}
