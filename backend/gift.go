package backend

import (
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/orzogc/acfundanmu"
	"github.com/valyala/fastjson"
)

// 礼物打赏记录接口（apph5-direct，仅 Cookie 鉴权，分页 pcursor）
const (
	rewardGiveURL    = "https://api-ipv6.app.acfun.cn/rest/apph5-direct/pay/reward/giveRecords"
	rewardReceiveURL = "https://api-ipv6.app.acfun.cn/rest/apph5-direct/pay/reward/receiveRecords"
)

// getRewardRecords 拉取一页礼物记录。data: { kind: "give"|"receive", pcursor: "0" }
// 返回上游原始 JSON（含 result/pcursor/records）作为 data，前端负责翻页与聚合。
func (ac *acLive) getRewardRecords(v *fastjson.Value, reqID string) string {
	kind := string(v.GetStringBytes("data", "kind"))
	pcursor := string(v.GetStringBytes("data", "pcursor"))
	if pcursor == "" {
		pcursor = "0"
	}
	base := rewardGiveURL
	if kind == "receive" {
		base = rewardReceiveURL
	}

	token := ac.ac.GetTokenInfo()
	if len(token.Cookies) == 0 {
		ac.conn.debug("getRewardRecords() error: need login")
		return fmt.Sprintf(respErrJSON, getRewardRecordsType, quote(reqID), needLogin, quote("Need login"))
	}

	body, err := ac.fetchRewardPage(token, base, pcursor)
	if err != nil {
		ac.conn.debug("getRewardRecords() error: %v", err)
		return fmt.Sprintf(respErrJSON, getRewardRecordsType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	var p fastjson.Parser
	data, err := p.ParseBytes(body)
	if err != nil {
		ac.conn.debug("getRewardRecords() error: cannot parse %s", string(body))
		return fmt.Sprintf(respErrJSON, getRewardRecordsType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	if data.GetInt("result") != 0 {
		errMsg := string(data.GetStringBytes("error_msg"))
		if errMsg == "" {
			errMsg = string(body)
		}
		return fmt.Sprintf(respErrJSON, getRewardRecordsType, quote(reqID), reqHandleErr, quote(errMsg))
	}

	// 直接把上游 JSON（含 pcursor/records）作为 data 透传给前端
	return fmt.Sprintf(respJSON, getRewardRecordsType, quote(reqID), string(body))
}

func (ac *acLive) fetchRewardPage(token *acfundanmu.TokenInfo, base, pcursor string) ([]byte, error) {
	q := url.Values{}
	q.Set("pcursor", pcursor)
	req, err := http.NewRequest(http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", browserCommentUA)
	req.Header.Set("Referer", momentReferer)
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
