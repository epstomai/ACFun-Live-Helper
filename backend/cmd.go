package backend

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/orzogc/acfundanmu"
	"github.com/segmentio/encoding/json"
	"github.com/valyala/fasthttp"
	"github.com/valyala/fastjson"
)

// retryTransient retries handlers whose error response signals a transient
// upstream fasthttp connection-close. The upstream (AcFun via acfundanmu) keeps
// idle connections in a shared pool for up to 90s; when AcFun closes one of
// those idle conns the next request returns
// "the server closed connection before returning the first response byte".
// fasthttp evicts the failing conn from the pool after each error, so a few
// retries usually pick up a fresh connection.
func retryTransient(fn func(*acLive, *fastjson.Value, string) string) func(*acLive, *fastjson.Value, string) string {
	return func(ac *acLive, v *fastjson.Value, reqID string) string {
		const maxAttempts = 7
		var resp string
		for attempt := 0; attempt < maxAttempts; attempt++ {
			resp = fn(ac, v, reqID)
			if !isTransientErrorResp(resp) {
				return resp
			}
			if ac != nil && ac.conn != nil {
				ac.conn.debug("transient upstream error (attempt %d/%d): %s", attempt+1, maxAttempts, resp)
			}
			if attempt < maxAttempts-1 {
				time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
			}
		}
		return resp
	}
}

var transientErrorSignals = []string{
	"server closed connection before returning the first response byte",
	"connection was forcibly closed",
	"broken pipe",
	"reset by peer",
	"EOF",
	"timeout",
}

func isTransientErrorResp(resp string) bool {
	if !strings.Contains(resp, `"result":`) {
		return false
	}
	if strings.Contains(resp, `"result":1`) {
		return false
	}
	for _, signal := range transientErrorSignals {
		if strings.Contains(resp, signal) {
			return true
		}
	}
	return false
}

var cmdDispatch = map[int]func(*acLive, *fastjson.Value, string) string{
	getWatchingListType:     (*acLive).getWatchingList,
	getBillboardType:        (*acLive).getBillboard,
	getSummaryType:          (*acLive).getSummary,
	getLuckListType:         (*acLive).getLuckList,
	getPlaybackType:         (*acLive).getPlayback,
	getAllGiftListType:      (*acLive).getAllGiftList,
	getWalletBalanceType:    (*acLive).getWalletBalance,
	getUserLiveInfoType:     (*acLive).getUserLiveInfo,
	getAllLiveListType:      (*acLive).getAllLiveList,
	getLiveDataType:         (*acLive).getLiveData,
	getGiftListType:         (*acLive).getGiftList,
	getUserInfoType:         (*acLive).getUserInfo,
	getManagerListType:      (*acLive).getManagerList,
	addManagerType:          (*acLive).addManager,
	deleteManagerType:       (*acLive).deleteManager,
	getAllKickHistoryType:   (*acLive).getAllKickHistory,
	managerKickType:         (*acLive).managerKick,
	authorKickType:          (*acLive).authorKick,
	getMedalDetailType:      (*acLive).getMedalDetail,
	getMedalListType:        (*acLive).getMedalList,
	getMedalRankListType:    (*acLive).getMedalRankList,
	getUserMedalType:        (*acLive).getUserMedal,
	wearMedalType:           (*acLive).wearMedal,
	cancelWearMedalType:     (*acLive).cancelWearMedal,
	checkLiveAuthType:       (*acLive).checkLiveAuth,
	getLiveTypeListType:     retryTransient((*acLive).getLiveTypeList),
	getPushConfigType:       retryTransient((*acLive).getPushConfig),
	getLiveStatusType:       retryTransient((*acLive).getLiveStatus),
	getTranscodeInfoType:    retryTransient((*acLive).getTranscodeInfo),
	startLiveType:           (*acLive).startLive,
	stopLiveType:            (*acLive).stopLive,
	changeTitleAndCoverType: (*acLive).changeTitleAndCover,
	getLiveCutStatusType:    (*acLive).getLiveCutStatus,
	setLiveCutStatusType:    (*acLive).setLiveCutStatus,
	sendCommentType:         (*acLive).sendComment,
	addMomentType:           (*acLive).addMoment,
	getRewardRecordsType:    (*acLive).getRewardRecords,
}

// 处理登陆命令
func (conn *wsConn) login(acMap *sync.Map, account, password, reqID string) string {
	var newAC *acfundanmu.AcFunLive
	var err error
	conn.debug("Client requests login")
	if account == "" || password == "" {
		newAC, err = acfundanmu.NewAcFunLive(acfundanmu.SetDanmuClient(danmuClient()))
		if err != nil {
			conn.debug("login() error: cannot login as anonymous: %v", err)
			return fmt.Sprintf(respErrJSON, loginType, quote(reqID), reqHandleErr, quote(err.Error()))
		}
	} else {
		cookies, err := acfundanmu.Login(account, password)
		if err != nil {
			conn.debug("login() error: cannot login as AcFun user: %v", err)
			return fmt.Sprintf(respErrJSON, loginType, quote(reqID), reqHandleErr, quote(err.Error()))
		}
		newAC, err = acfundanmu.NewAcFunLive(acfundanmu.SetCookies(cookies), acfundanmu.SetDanmuClient(danmuClient()))
		if err != nil {
			conn.debug("login() error: %v", err)
			return fmt.Sprintf(respErrJSON, loginType, quote(reqID), reqHandleErr, quote(err.Error()))
		}
	}
	conn.debug("Client's login is successful, uid is %d", newAC.GetUserID())

	ac := new(acLive)
	ac.conn = conn
	ac.ac = newAC
	acMap.Store(0, ac)

	info := ac.ac.GetTokenInfo()
	data, err := json.Marshal(info)
	if err != nil {
		conn.debug("login() error: cannot marshal to json: %v", err)
		return fmt.Sprintf(respErrJSON, loginType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, loginType, quote(reqID), fmt.Sprintf(`{"tokenInfo":%s}`, string(data)))
}

// 处理扫码登陆命令
func (conn *wsConn) loginWithQRCode(acMap *sync.Map, reqID string) string {
	conn.debug("Client requests login with QR code")

	cookies, err := acfundanmu.LoginWithQRCode(func(qrCode acfundanmu.QRCode) {
		data, err := json.Marshal(qrCode)
		if err != nil {
			conn.send(fmt.Sprintf(respErrJSON, QRCodeLoginType, quote(reqID), reqHandleErr, quote(err.Error())))
		} else {
			conn.send(fmt.Sprintf(respJSON, QRCodeLoginType, quote(reqID), string(data)))
		}
	}, func() {
		conn.send(fmt.Sprintf(respNoDataJSON, QRCodeScannedType, quote(reqID)))
	})
	if err != nil {
		conn.debug("loginWithQRCode() error: %v", err)
		return fmt.Sprintf(respErrJSON, QRCodeLoginType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	if cookies == nil {
		conn.debug("Login with QR code is expired or cancelled by user")
		return fmt.Sprintf(respNoDataJSON, QRCodeLoginCancelType, quote(reqID))
	}

	newAC, err := acfundanmu.NewAcFunLive(acfundanmu.SetCookies(cookies), acfundanmu.SetDanmuClient(danmuClient()))
	if err != nil {
		conn.debug("loginWithQRCode() error: %v", err)
		return fmt.Sprintf(respErrJSON, QRCodeLoginType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	conn.debug("Client's login is successful, uid is %d", newAC.GetUserID())

	ac := new(acLive)
	ac.conn = conn
	ac.ac = newAC
	acMap.Store(0, ac)

	info := ac.ac.GetTokenInfo()
	data, err := json.Marshal(info)
	if err != nil {
		conn.debug("loginWithQRCode() error: cannot marshal to json: %v", err)
		return fmt.Sprintf(respErrJSON, QRCodeLoginType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, QRCodeLoginSuccessType, quote(reqID), fmt.Sprintf(`{"tokenInfo":%s}`, string(data)))
}

// 获取全部礼物的列表
func (ac *acLive) getAllGiftList(v *fastjson.Value, reqID string) string {
	gift, err := ac.ac.GetAllGiftList()
	if err != nil {
		ac.conn.debug("getAllGiftList() error: %v", err)
		return fmt.Sprintf(respErrJSON, getAllGiftListType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	list := make([]acfundanmu.GiftDetail, 0, len(gift))
	for _, g := range gift {
		list = append(list, g)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].GiftID < list[j].GiftID
	})
	data, err := json.Marshal(list)
	if err != nil {
		ac.conn.debug("getAllGiftList() error: cannot marshal to json: %+v", list)
		return fmt.Sprintf(respErrJSON, getAllGiftListType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getAllGiftListType, quote(reqID), string(data))
}

// 获取账户钱包数据
func (ac *acLive) getWalletBalance(v *fastjson.Value, reqID string) string {
	acCoin, banana, err := ac.ac.GetWalletBalance()
	if err != nil {
		ac.conn.debug("getWalletBalance() error: %v", err)
		return fmt.Sprintf(respErrJSON, getWalletBalanceType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getWalletBalanceType, quote(reqID), fmt.Sprintf(`{"acCoin":%d,"banana":%d}`, acCoin, banana))
}

// 上传图片
/*
func (ac *acLive) uploadImage(v *fastjson.Value, reqID string) string {
	imageFile := string(v.GetStringBytes("data", "imageFile"))
	if imageFile == "" {
		ac.conn.debug("uploadImage() error: No imageFile")
		return fmt.Sprintf(respErrJSON, uploadImageType, quote(reqID), invalidReqData, quote("Need imageFile"))
	}

	imageURL, err := ac.ac.UploadImage(imageFile)
	if err != nil {
		ac.conn.debug("uploadImage() error: %v", err)
		return fmt.Sprintf(respErrJSON, uploadImageType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, uploadImageType, quote(reqID), fmt.Sprintf(`{"imageURL":%s}`, quote(imageURL)))
}
*/

// 获取直播间礼物列表
func (ac *acLive) getGiftList(v *fastjson.Value, reqID string) string {
	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("getGiftList() error: No liveID")
		return fmt.Sprintf(respErrJSON, getGiftListType, quote(reqID), invalidReqData, quote("Need liveID"))
	}

	gift, err := ac.ac.GetGiftList(liveID)
	if err != nil {
		ac.conn.debug("getGiftList() error: %v", err)
		return fmt.Sprintf(respErrJSON, getGiftListType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	list := make([]acfundanmu.GiftDetail, 0, len(gift))
	for _, g := range gift {
		list = append(list, g)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].GiftID < list[j].GiftID
	})
	data, err := json.Marshal(list)
	if err != nil {
		ac.conn.debug("getGiftList() error: cannot marshal to json: %+v", list)
		return fmt.Sprintf(respErrJSON, getGiftListType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getGiftListType, quote(reqID), string(data))
}

func (ac *acLive) getLiveCutInfo(v *fastjson.Value, reqID string) string {
	liverUID := v.GetInt64("data", "liverUID")
	if liverUID <= 0 {
		ac.conn.debug("getLiveCutInfo() error: liverUID not exist or less than 1")
		return fmt.Sprintf(respErrJSON, getLiveCutInfoType, quote(reqID), invalidReqData, quote("liverUID not exist or less than 1"))
	}

	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("getLiveCutInfo() error: No liveID")
		return fmt.Sprintf(respErrJSON, getLiveCutInfoType, quote(reqID), invalidReqData, quote("Need liveID"))
	}

	info, err := ac.ac.GetLiveCutInfo(liverUID, liveID)
	if err != nil {
		ac.conn.debug("getLiveCutInfo() error: %v", err)
		return fmt.Sprintf(respErrJSON, getLiveCutInfoType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	data, err := json.Marshal(info)
	if err != nil {
		ac.conn.debug("getLiveCutInfo() error: cannot marshal to json: %+v", info)
		return fmt.Sprintf(respErrJSON, getLiveCutInfoType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getLiveCutInfoType, quote(reqID), string(data))
}

// 房管踢人
func (ac *acLive) managerKick(v *fastjson.Value, reqID string) string {
	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("managerKick() error: No liveID")
		return fmt.Sprintf(respErrJSON, managerKickType, quote(reqID), invalidReqData, quote("Need liveID"))
	}

	kickedUID := v.GetInt64("data", "kickedUID")
	if kickedUID <= 0 {
		ac.conn.debug("managerKick() error: kickedUID not exist or less than 1")
		return fmt.Sprintf(respErrJSON, managerKickType, quote(reqID), invalidReqData, quote("kickedUID not exist or less than 1"))
	}

	err := ac.ac.ManagerKick(liveID, kickedUID)
	if err != nil {
		ac.conn.debug("managerKick() error: %v", err)
		return fmt.Sprintf(respErrJSON, managerKickType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respNoDataJSON, managerKickType, quote(reqID))
}

// 主播踢人
func (ac *acLive) authorKick(v *fastjson.Value, reqID string) string {
	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("authorKick() error: No liveID")
		return fmt.Sprintf(respErrJSON, authorKickType, quote(reqID), invalidReqData, quote("Need liveID"))
	}

	kickedUID := v.GetInt64("data", "kickedUID")
	if kickedUID <= 0 {
		ac.conn.debug("authorKick() error: kickedUID not exist or less than 1")
		return fmt.Sprintf(respErrJSON, authorKickType, quote(reqID), invalidReqData, quote("kickedUID not exist or less than 1"))
	}

	err := ac.ac.AuthorKick(liveID, kickedUID)
	if err != nil {
		ac.conn.debug("authorKick() error: %v", err)
		return fmt.Sprintf(respErrJSON, authorKickType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respNoDataJSON, authorKickType, quote(reqID))
}

func (ac *acLive) getUserMedal(v *fastjson.Value, reqID string) string {
	userID := v.GetInt64("data", "userID")
	if userID <= 0 {
		ac.conn.debug("getUserMedal() error: userID not exist or less than 1")
		return fmt.Sprintf(respErrJSON, getUserMedalType, quote(reqID), invalidReqData, quote("userID not exist or less than 1"))
	}

	medal, err := acfundanmu.GetUserMedal(userID, ac.ac.GetDeviceID())
	if err != nil {
		ac.conn.debug("getUserMedal() error: %v", err)
		return fmt.Sprintf(respErrJSON, getUserMedalType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	data, err := json.Marshal(medal)
	if err != nil {
		ac.conn.debug("getUserMedal() error: cannot marshal to json: %+v", medal)
		return fmt.Sprintf(respErrJSON, getUserMedalType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getUserMedalType, quote(reqID), string(data))
}

// 检测是否有直播权限
func (ac *acLive) checkLiveAuth(v *fastjson.Value, reqID string) string {
	auth, err := ac.ac.CheckLiveAuth()
	if err != nil {
		ac.conn.debug("checkLiveAuth() error: %v", err)
		return fmt.Sprintf(respErrJSON, checkLiveAuthType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, checkLiveAuthType, quote(reqID), fmt.Sprintf(`{"liveAuth":%v}`, auth))
}

// 启动直播
func (ac *acLive) startLive(v *fastjson.Value, reqID string) string {
	title := string(v.GetStringBytes("data", "title"))
	if title == "" {
		ac.conn.debug("startLive() error: No title")
		return fmt.Sprintf(respErrJSON, startLiveType, quote(reqID), invalidReqData, quote("Need title"))
	}
	coverFile := string(v.GetStringBytes("data", "coverFile"))
	if coverFile == "" {
		ac.conn.debug("startLive() error: No coverFile")
		return fmt.Sprintf(respErrJSON, startLiveType, quote(reqID), invalidReqData, quote("Need coverFile"))
	}
	streamName := string(v.GetStringBytes("data", "streamName"))
	if streamName == "" {
		ac.conn.debug("startLive() error: No streamName")
		return fmt.Sprintf(respErrJSON, startLiveType, quote(reqID), invalidReqData, quote("Need streamName"))
	}
	portrait := v.GetBool("data", "portrait")
	panoramic := v.GetBool("data", "panoramic")
	categoryID := v.GetInt("data", "categoryID")
	subCategoryID := v.GetInt("data", "subCategoryID")

	liveID, err := ac.ac.StartLive(title, coverFile, streamName, portrait, panoramic,
		&acfundanmu.LiveType{
			CategoryID:    categoryID,
			SubCategoryID: subCategoryID,
		})
	if err != nil {
		ac.conn.debug("startLive() error: %v", err)
		return fmt.Sprintf(respErrJSON, startLiveType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, startLiveType, quote(reqID), fmt.Sprintf(`{"liveID":%s}`, quote(liveID)))
}

// 更改直播间标题和封面
func (ac *acLive) changeTitleAndCover(v *fastjson.Value, reqID string) string {
	title := string(v.GetStringBytes("data", "title"))
	coverFile := string(v.GetStringBytes("data", "coverFile"))
	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("changeTitleAndCover() error: No liveID")
		return fmt.Sprintf(respErrJSON, changeTitleAndCoverType, quote(reqID), invalidReqData, quote("Need liveID"))
	}

	err := ac.ac.ChangeTitleAndCover(title, coverFile, liveID)
	if err != nil {
		ac.conn.debug("changeTitleAndCover() error: %v", err)
		return fmt.Sprintf(respErrJSON, changeTitleAndCoverType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respNoDataJSON, changeTitleAndCoverType, quote(reqID))
}

// 获取主播是否允许观众剪辑直播录像
func (ac *acLive) getLiveCutStatus(v *fastjson.Value, reqID string) string {
	status, err := ac.ac.GetLiveCutStatus()
	if err != nil {
		ac.conn.debug("getLiveCutStatus() error: %v", err)
		return fmt.Sprintf(respErrJSON, getLiveCutStatusType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respJSON, getLiveCutStatusType, quote(reqID), fmt.Sprintf(`{"canCut":%v}`, status))
}

// 设置是否允许观众剪辑直播录像
func (ac *acLive) setLiveCutStatus(v *fastjson.Value, reqID string) string {
	bv := v.Get("data", "canCut")
	if bv == nil {
		ac.conn.debug("setLiveCutStatus() error: No canCut")
		return fmt.Sprintf(respErrJSON, setLiveCutStatusType, quote(reqID), invalidReqData, quote("Need canCut"))
	}
	canCut, err := bv.Bool()
	if err != nil {
		ac.conn.debug("setLiveCutStatus() error: %v", err)
		return fmt.Sprintf(respErrJSON, setLiveCutStatusType, quote(reqID), invalidReqData, quote(err.Error()))
	}
	err = ac.ac.SetLiveCutStatus(canCut)
	if err != nil {
		ac.conn.debug("setLiveCutStatus() error: %v", err)
		return fmt.Sprintf(respErrJSON, setLiveCutStatusType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	return fmt.Sprintf(respNoDataJSON, setLiveCutStatusType, quote(reqID))
}

// browserCommentURL is shaped after the browser request captured from
// live.acfun.cn when posting a live-room comment.
const browserCommentURL = "https://api.kuaishouzt.com/rest/zt/live/web/audience/action/comment?subBiz=mainApp&kpn=ACFUN_APP&kpf=PC_WEB&userId=%d&did=%s&acfun.midground.api_st=%s"
const browserVisitorLoginURL = "https://id.app.acfun.cn/rest/app/visitor/login"
const browserVisitorSID = "acfun.api.visitor"
const browserVisitorST = "acfun.api.visitor_st"
const browserCommentOrigin = "https://live.acfun.cn"
const browserCommentReferer = "https://live.acfun.cn/"
const browserCommentUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"

// 发送直播间弹幕
func (ac *acLive) sendComment(v *fastjson.Value, reqID string) string {
	liveID := string(v.GetStringBytes("data", "liveID"))
	if liveID == "" {
		ac.conn.debug("sendComment() error: No liveID")
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), invalidReqData, quote("Need liveID"))
	}
	liverUID := v.GetInt64("data", "liverUID")
	content := string(v.GetStringBytes("data", "content"))
	if content == "" {
		ac.conn.debug("sendComment() error: No content")
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), invalidReqData, quote("Need content"))
	}
	token := ac.ac.GetTokenInfo()
	if len(token.Cookies) == 0 {
		ac.conn.debug("sendComment() error: Need login")
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), needLogin, quote("Need login"))
	}
	if liverUID <= 0 {
		liverUID = ac.ac.GetLiverUID()
	}
	if liverUID <= 0 {
		liverUID = token.UserID
	}
	form := fasthttp.AcquireArgs()
	defer fasthttp.ReleaseArgs(form)
	form.Set("visitorId", fmt.Sprintf("%d", token.UserID))
	form.Set("liveId", liveID)
	form.Set("content", content)
	form.Set("color", "16777215")
	visitorToken, err := ac.getBrowserVisitorToken(token)
	if err != nil {
		ac.conn.debug("sendComment() error: cannot get visitor token: %v", err)
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	form.Set("vst", visitorToken)

	ac.conn.debug("sendComment() request: senderUID=%d liverUID=%d sessionLiverUID=%d sessionLiveID=%s targetLiveID=%s referer=%s", token.UserID, liverUID, ac.ac.GetLiverUID(), ac.ac.GetLiveID(), liveID, browserCommentReferer)
	body, err := ac.postBrowserComment(token, form)
	if err != nil {
		ac.conn.debug("sendComment() error: %v", err)
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}

	var p fastjson.Parser
	data, err := p.ParseBytes(body)
	if err != nil {
		ac.conn.debug("sendComment() error: cannot parse response %s", string(body))
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), reqHandleErr, quote(err.Error()))
	}
	if data.GetInt("result") != 1 {
		errMsg := string(data.GetStringBytes("error_msg"))
		if errMsg == "" {
			errMsg = string(body)
		}
		ac.conn.debug("sendComment() error: %s", errMsg)
		return fmt.Sprintf(respErrJSON, sendCommentType, quote(reqID), reqHandleErr, quote(errMsg))
	}

	ac.conn.debug("sendComment() accepted by AcFun: %s", string(body))
	return fmt.Sprintf(respNoDataJSON, sendCommentType, quote(reqID))
}

func (ac *acLive) postBrowserComment(token *acfundanmu.TokenInfo, form *fasthttp.Args) ([]byte, error) {
	const maxAttempts = 7
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		body, err := ac.postBrowserCommentOnce(token, form)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if !isTransientUpstreamError(err.Error()) {
			return nil, err
		}
		ac.conn.debug("sendComment() transient browser request error (attempt %d/%d): %v", attempt+1, maxAttempts, err)
		if attempt < maxAttempts-1 {
			time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
		}
	}
	return nil, lastErr
}

func (ac *acLive) getBrowserVisitorToken(token *acfundanmu.TokenInfo) (string, error) {
	if ac.visitorToken != "" && time.Since(ac.visitorTokenTime) < 30*time.Minute {
		return ac.visitorToken, nil
	}
	form := url.Values{}
	form.Set("sid", browserVisitorSID)
	req, err := http.NewRequest(http.MethodPost, browserVisitorLoginURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", browserCommentOrigin)
	req.Header.Set("Referer", browserCommentReferer)
	req.Header.Set("User-Agent", browserCommentUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
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
		return "", fmt.Errorf("cannot parse visitor token response %s", string(body))
	}
	if data.GetInt("result") != 0 {
		return "", fmt.Errorf("visitor token response %s", string(body))
	}
	visitorToken := string(data.GetStringBytes(browserVisitorST))
	if visitorToken == "" {
		return "", fmt.Errorf("visitor token missing in response %s", string(body))
	}
	ac.visitorToken = visitorToken
	ac.visitorTokenTime = time.Now()
	return visitorToken, nil
}

func (ac *acLive) postBrowserCommentOnce(token *acfundanmu.TokenInfo, form *fasthttp.Args) ([]byte, error) {
	apiURL := fmt.Sprintf(browserCommentURL, token.UserID, url.QueryEscape(token.DeviceID), url.QueryEscape(token.ServiceToken))

	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(form.QueryString()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", browserCommentOrigin)
	req.Header.Set("Referer", browserCommentReferer)
	req.Header.Set("User-Agent", browserCommentUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for _, cookie := range token.Cookies {
		req.AddCookie(&http.Cookie{
			Name:  string(cookie.Key()),
			Value: string(cookie.Value()),
		})
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

func (ac *acLive) broadcastSelfComment(liverUID int64, userID int64, nickname string, avatar string, content string) {
	if server_ch == nil {
		return
	}
	payload := map[string]any{
		"danmuInfo": map[string]any{
			"sendTime": time.Now().UnixMilli(),
			"userInfo": map[string]any{
				"userID":   userID,
				"nickname": nickname,
				"avatar":   avatar,
			},
		},
		"content": content,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		ac.conn.debug("sendComment() synthetic echo marshal error: %v", err)
		return
	}
	server_ch.Broadcast(&broadcastMsg{
		Message: fmt.Sprintf(danmuJSON, liverUID, commentType, string(data)),
	})
}
