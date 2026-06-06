package backend

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/orzogc/acfundanmu"
	"github.com/segmentio/encoding/json"
	"github.com/valyala/fastjson"
)

// 发动态相关接口（复刻 AcFun App 抓包，实测无需 sign）
const (
	momentTokenURL = "https://id.app.acfun.cn/rest/web/token/get"
	momentAddURL   = "https://api-ipv6.app.acfun.cn/rest/app/moment/add"
	momentMidSID   = "acfun.midground.api"
	momentMidAt    = "acfun.midground.api.at"

	momentMaxLen    = 233
	momentUserAgent = "AcFun/6.79.1 (iPhone; iOS 17.0; Scale/3.00)"
	momentReferer   = "https://www.acfun.cn/"
)

// 动态里的图片
type momentImg struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// 动态发布参数
type momentParams struct {
	Content           string      `json:"content"`
	Imgs              []momentImg `json:"imgs"`
	ShareResourceType int         `json:"shareResourceType"`
	VisibleForFans    bool        `json:"visibleForFans"`
}

// genUUID 生成大写 UUID，用作 random / udid 头
func genUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%X-%X-%X-%X-%X", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// genMomentTokenHeader 生成 token 头：protobuf{1:1, 2:"<13位毫秒时间戳>"} 的 base64
func genMomentTokenHeader() string {
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	buf := []byte{0x08, 0x01, 0x12, byte(len(ts))}
	buf = append(buf, []byte(ts)...)
	return base64.StdEncoding.EncodeToString(buf)
}

// genGid 生成设备全局 id（egid/gid），服务器一般只记录不强校验
func genGid() string {
	b := make([]byte, 31)
	_, _ = rand.Read(b)
	const hexUpper = "0123456789ABCDEF"
	s := make([]byte, 62)
	for i, v := range b {
		s[i*2] = hexUpper[v>>4]
		s[i*2+1] = hexUpper[v&0x0f]
	}
	return "DFP" + string(s)
}

// getMomentAccessToken 用网页登录态换取 app 的 access_token（acfun.midground.api.at）
func (ac *acLive) getMomentAccessToken(token *acfundanmu.TokenInfo) (string, error) {
	form := url.Values{}
	form.Set("sid", momentMidSID)
	req, err := http.NewRequest(http.MethodPost, momentTokenURL, bytes.NewReader([]byte(form.Encode())))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", momentReferer)
	req.Header.Set("User-Agent", browserCommentUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for _, cookie := range token.Cookies {
		req.AddCookie(&http.Cookie{Name: string(cookie.Key()), Value: string(cookie.Value())})
	}
	if token.DeviceID != "" {
		req.AddCookie(&http.Cookie{Name: "_did", Value: token.DeviceID})
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var p fastjson.Parser
	data, err := p.ParseBytes(body)
	if err != nil {
		return "", fmt.Errorf("cannot parse token response %s", string(body))
	}
	if data.GetInt("result") != 0 {
		return "", fmt.Errorf("token response %s", string(body))
	}
	at := string(data.GetStringBytes(momentMidAt))
	if at == "" {
		return "", fmt.Errorf("access_token missing in response %s", string(body))
	}
	return at, nil
}

// addMoment 发布一条动态（文字 / 图片）
func (ac *acLive) addMoment(v *fastjson.Value, reqID string) string {
	content := string(v.GetStringBytes("data", "content"))

	var imgs []momentImg
	if arr := v.GetArray("data", "imgs"); arr != nil {
		for _, item := range arr {
			imgs = append(imgs, momentImg{
				URL:    string(item.GetStringBytes("url")),
				Width:  item.GetInt("width"),
				Height: item.GetInt("height"),
			})
		}
	}

	if content == "" && len(imgs) == 0 {
		ac.conn.debug("addMoment() error: empty content")
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), invalidReqData, quote("动态内容不能为空"))
	}
	if len([]rune(content)) > momentMaxLen {
		ac.conn.debug("addMoment() error: content too long")
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), invalidReqData, quote(fmt.Sprintf("内容长度必须为1-%d", momentMaxLen)))
	}

	token := ac.ac.GetTokenInfo()
	if len(token.Cookies) == 0 {
		ac.conn.debug("addMoment() error: need login")
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), needLogin, quote("Need login"))
	}

	at, err := ac.getMomentAccessToken(token)
	if err != nil {
		ac.conn.debug("addMoment() error: cannot get access_token: %v", err)
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	body, err := ac.postMoment(token, at, content, imgs)
	if err != nil {
		ac.conn.debug("addMoment() error: %v", err)
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	var p fastjson.Parser
	data, err := p.ParseBytes(body)
	if err != nil {
		ac.conn.debug("addMoment() error: cannot parse response %s", string(body))
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	if data.GetInt("result") != 0 {
		errMsg := string(data.GetStringBytes("error_msg"))
		if errMsg == "" {
			errMsg = string(body)
		}
		ac.conn.debug("addMoment() error: %s", errMsg)
		return fmt.Sprintf(respErrJSON, addMomentType, quote(reqID), reqHandleErr, quote(errMsg))
	}

	ac.conn.debug("addMoment() accepted by AcFun: %s", string(body))
	momentID := data.Get("moment", "momentId")
	if momentID == nil {
		momentID = data.Get("momentId")
	}
	mid := ""
	if momentID != nil {
		mid = momentID.String()
	}
	return fmt.Sprintf(respJSON, addMomentType, quote(reqID), fmt.Sprintf(`{"momentId":%s}`, quote(mid)))
}

func (ac *acLive) postMoment(token *acfundanmu.TokenInfo, at, content string, imgs []momentImg) ([]byte, error) {
	gid := genGid()
	did := token.DeviceID
	if did == "" {
		did = genUUID()
	}

	if imgs == nil {
		imgs = []momentImg{}
	}
	params, err := json.Marshal(momentParams{
		Content:           content,
		Imgs:              imgs,
		ShareResourceType: 0,
		VisibleForFans:    false,
	})
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("market", "appstore")
	query.Set("app_version", "6.79.1.635")
	query.Set("product", "ACFUN_APP")
	query.Set("sys_version", "17.0")
	query.Set("egid", gid)
	query.Set("origin", "ios")
	query.Set("sys_name", "ios")
	query.Set("resolution", "1284x2778")
	query.Set("access_token", at)

	form := url.Values{}
	form.Set("params", string(params))

	req, err := http.NewRequest(http.MethodPost, momentAddURL+"?"+query.Encode(), bytes.NewReader([]byte(form.Encode())))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", momentUserAgent)
	req.Header.Set("token", genMomentTokenHeader())
	req.Header.Set("random", genUUID())
	req.Header.Set("access_token", at)
	req.Header.Set("uid", strconv.FormatInt(token.UserID, 10))
	req.Header.Set("deviceType", "0")
	req.Header.Set("acPlatform", "IPHONE")
	req.Header.Set("appVersion", "6.79.1.635")
	req.Header.Set("productId", "2000")
	req.Header.Set("market", "appstore")
	req.Header.Set("resolution", "1284x2778")
	req.Header.Set("net", "--_5")
	req.Header.Set("mod", "iPhone13,4")
	req.Header.Set("gid", gid)
	req.Header.Set("udid", did)
	req.Header.Set("isChildPattern", "false")
	for _, cookie := range token.Cookies {
		req.AddCookie(&http.Cookie{Name: string(cookie.Key()), Value: string(cookie.Value())})
	}
	if token.DeviceID != "" {
		req.AddCookie(&http.Cookie{Name: "_did", Value: token.DeviceID})
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
