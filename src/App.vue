<template>
  <div
    class="app-shell"
    :class="[`theme-${store.ui.theme}`, { 'sidebar-collapsed': store.ui.sidebarCollapsed }]"
    :style="appShellStyle"
  >
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-main">
          <h1>AcFun Live Helper</h1>
        </div>
        <button
          class="sidebar-toggle"
          :class="{ flash: sidebarToggleFlash, 'heart-mode': isExtremeNarrowSidebar }"
          :title="sidebarToggleTitle"
          @click="handleSidebarToggle"
        >
          <component :is="sidebarToggleIcon" :size="16" />
          <span v-if="isExtremeNarrowSidebar" class="sidebar-heart-layer" aria-hidden="true">
            <span
              v-for="heart in sidebarHearts"
              :key="heart.id"
              class="sidebar-heart-pop"
              :style="{ '--heart-x': `${heart.x}px`, '--heart-scale': heart.scale }"
            >♥</span>
          </span>
        </button>
      </div>

      <nav class="nav-list">
        <button
          v-for="item in tabs"
          :key="item.id"
          class="nav-item"
          :class="{ active: store.activeTab === item.id }"
          @click="store.activeTab = item.id"
        >
          <component :is="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="connection-pill" :class="{ online: store.connected }">
          <Server :size="14" />
          <span>{{ store.connected ? "已连接" : "未连接" }}</span>
        </div>
        <div v-if="store.live.isLive || store.room.isLive" class="live-pill">
          <Radio :size="14" />
          <span>开播中</span>
        </div>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div class="topbar-title">
          <h2>{{ currentTab.label }}</h2>
          <p>
            <template v-for="(part, index) in subtitleParts" :key="`${part.text}-${index}`">
              <span :class="{ 'acfun-text': part.highlight }">{{ part.text }}</span>
            </template>
          </p>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" :title="store.ui.theme === 'dark' ? '要有光！' : '狗眼①瞎'" @click="store.toggleTheme">
            <component :is="themeIcon" :size="17" />
          </button>
          <div v-if="store.isLoggedIn" class="profile-chip" @click="store.activeTab = 'account'">
            <div class="avatar avatar-sm">
              <img v-if="store.userProfile.avatar" :src="store.userProfile.avatar" :alt="store.userName" />
              <span v-else>{{ userInitial }}</span>
            </div>
            <div class="profile-chip-main">
              <strong>{{ store.userName || "已登录" }}</strong>
              <span>UID {{ store.userId }} · 粉丝 {{ store.userProfile.fansCount || "-" }}</span>
            </div>
          </div>
          <button class="icon-button" title="刷新" @click="refreshCurrent">
            <RefreshCw :size="17" />
          </button>
          <button v-if="store.isLoggedIn" class="icon-button danger" title="登出" @click="store.logout">
            <LogOut :size="17" />
          </button>
        </div>
      </header>

      <section v-if="toast || store.progress" class="toast" :class="{ pending: !toast && store.progress }" role="status">
        <span v-if="!toast && store.progress" class="toast-spinner" aria-hidden="true"></span>
        <span>{{ toast || store.progress }}</span>
      </section>

      <!-- 账号 -->
      <section v-if="store.activeTab === 'account'" class="account-grid">
        <div class="panel account-panel">
          <div class="panel-head">
            <h3>账号</h3>
            <span class="status-dot" :class="{ online: store.connected }"></span>
          </div>

          <div class="account-overview">
            <div class="avatar avatar-lg">
              <img v-if="store.userProfile.avatar" :src="store.userProfile.avatar" :alt="store.userName" />
              <span v-else>{{ userInitial }}</span>
            </div>
            <div class="account-main">
              <strong>{{ store.userName || "未登录" }}</strong>
              <span>UID {{ store.userId || "-" }}</span>
              <p>{{ store.userProfile.signature || store.userProfile.verifiedText || "登录成功后自动进入开播页。" }}</p>
            </div>
            <dl class="mini-stats">
              <div><dt>关注</dt><dd>{{ store.userProfile.followingCount || "-" }}</dd></div>
              <div><dt>粉丝</dt><dd>{{ store.userProfile.fansCount || "-" }}</dd></div>
              <div><dt>获赞</dt><dd>{{ store.userProfile.likeCount || "-" }}</dd></div>
            </dl>
          </div>

          <div v-if="!store.isLoggedIn" class="form-grid">
            <label>
              <span>账号</span>
              <input v-model="loginForm.account" autocomplete="username" />
            </label>
            <label>
              <span>密码</span>
              <input v-model="loginForm.password" type="password" autocomplete="current-password" @keyup.enter="doLogin" />
            </label>
          </div>

          <div class="button-row">
            <button v-if="!store.isLoggedIn" class="command primary" @click="doLogin">
              <User :size="16" /><span>账号登录</span>
            </button>
            <button v-if="!store.isLoggedIn" class="command" :disabled="qrLoginRunning" @click="startQrLogin">
              <QrCode :size="16" /><span>{{ qrLoginRunning ? "等待扫码" : "扫码登录" }}</span>
            </button>
            <button v-if="store.tokenInfo && !store.isLoggedIn" class="command" @click="run(() => store.restoreSession(), '会话已恢复')">
              <RotateCcw :size="16" /><span>恢复会话</span>
            </button>
            <button v-if="store.isLoggedIn" class="command danger" @click="store.logout">
              <LogOut :size="16" /><span>登出</span>
            </button>
          </div>

          <div v-if="store.qrLogin.status !== 'idle'" class="qr-login-card">
            <div class="qr-image-shell">
              <img v-if="qrImageSrc" :src="qrImageSrc" alt="AcFun 登录二维码" />
              <span v-else>等待二维码</span>
            </div>
            <div>
              <strong>{{ qrStatusText }}</strong>
              <p v-if="qrExpireText">{{ qrExpireText }}</p>
              <p>使用 <span class="acfun-text">AcFun</span> 手机客户端扫码确认登录。</p>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>后端连接</h3>
            <span>{{ store.connected ? "已连接" : "未连接" }}</span>
          </div>
          <label class="block-label">
            <span>Backend WebSocket</span>
            <div class="inline-input">
              <input v-model="store.backendUrl" placeholder="ws://localhost:15368/" @change="store.persist" />
              <button class="command" @click="run(() => store.connect(), '连接成功')">
                <PlugZap :size="16" /><span>连接</span>
              </button>
            </div>
          </label>
          <dl class="stats-grid">
            <div><dt>用户</dt><dd>{{ store.userName || "未登录" }}</dd></div>
            <div><dt>UID</dt><dd>{{ store.userId || "-" }}</dd></div>
            <div><dt>最近错误</dt><dd>{{ store.lastError || "-" }}</dd></div>
          </dl>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>设置</h3>
            <span>界面</span>
          </div>
          <label class="block-label">
            <span>UI 整体缩放</span>
            <div class="scale-control">
              <input
                v-model.number="uiScalePercent"
                type="range"
                min="50"
                max="150"
                step="5"
                @change="applyUiScale"
              />
              <input
                v-model.number="uiScalePercent"
                type="number"
                min="50"
                max="150"
                step="5"
                @change="applyUiScale"
              />
              <span>%</span>
              <button class="command" @click="resetUiScale">重置</button>
            </div>
          </label>
        </div>
      </section>

      <!-- 开播 -->
      <section v-if="store.activeTab === 'live'" class="live-grid">
        <div class="panel wide">
          <div class="panel-head">
            <h3>开播信息</h3>
            <span>{{ store.live.isLive ? "开播中" : "待开播" }} · LiveID {{ store.live.liveId || store.room.liveId || "-" }}</span>
          </div>
          <div class="live-summary">
            <div><span>状态</span><strong>{{ store.live.isLive ? "开播中" : "未开播" }}</strong></div>
            <div><span>在线</span><strong>{{ store.room.onlineCount }}</strong></div>
            <div><span>弹幕</span><strong>{{ store.room.danmakuList.length }}</strong></div>
            <div><span>OBS</span><strong>{{ obsStatusText }}</strong></div>
            <div><span>转码</span><strong>{{ topTranscodeText }}</strong></div>
          </div>
          <div class="form-grid three">
            <label>
              <span>直播标题</span>
              <input v-model="store.live.title" @change="store.persist" />
            </label>
            <label>
              <span>主分区</span>
              <select v-model.number="store.live.categoryId" @change="store.persist">
                <option v-for="item in store.live.categories" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
            <label>
              <span>子分区</span>
              <select v-model.number="store.live.subCategoryId" @change="store.persist">
                <option v-for="item in store.currentSubCategories" :key="item.subCategoryID" :value="item.subCategoryID">
                  {{ item.subCategoryName }}
                </option>
              </select>
            </label>
            <label class="full">
              <span>串流密钥</span>
              <div class="inline-input">
                <input :value="store.live.streamKey" :type="streamKeyVisible ? 'text' : 'password'" readonly />
                <button
                  class="icon-button"
                  :title="streamKeyVisible ? '隐藏' : '显示'"
                  @click="streamKeyVisible = !streamKeyVisible"
                >
                  <component :is="streamKeyVisible ? EyeOff : Eye" :size="16" />
                </button>
                <button class="icon-button" title="复制" @click="copy(store.live.streamKey)"><Clipboard :size="16" /></button>
              </div>
            </label>
            <label class="full">
              <span>推流地址</span>
              <div class="inline-input">
                <input :value="store.live.streamUrl" readonly />
                <button class="icon-button" title="复制" @click="copy(store.live.streamUrl)"><Clipboard :size="16" /></button>
              </div>
            </label>
          </div>

          <div class="button-row">
            <button
              v-if="!isLiveActive"
              class="command primary"
              @click="run(() => store.startLive(), '开播成功')"
            >
              <Play :size="16" /><span>手动开播</span>
            </button>
            <button
              v-else
              class="command danger"
              @click="run(() => store.stopLive(), '已关播')"
            >
              <Square :size="16" /><span>关播</span>
            </button>
            <button class="command" @click="run(() => store.changeTitleAndCover(), '已提交')">
              <ImageUp :size="16" /><span>更新标题/封面</span>
            </button>
            <button class="command" @click="run(() => store.loadLiveTypes())">
              <ListTree :size="16" /><span>刷新分类</span>
            </button>
            <button class="command" @click="run(() => store.loadPushConfig())">
              <KeyRound :size="16" /><span>刷新推流码</span>
            </button>
          </div>
        </div>

        <div class="panel cover-panel">
          <div class="panel-head">
            <h3>封面</h3>
          </div>
          <button
            type="button"
            class="cover-large-preview"
            :class="{ empty: !coverPreviewSrc }"
            :style="coverAspectStyle"
            :title="store.live.coverFile || '点击选择封面'"
            @click="openCoverEditor"
          >
            <img v-if="coverPreviewSrc" :src="coverPreviewSrc" :style="cropTransformStyle(store.live.coverFile)" alt="当前封面" />
            <span v-else>无封面</span>
            <span class="cover-large-preview-hint"><Images :size="16" />点击编辑封面</span>
            <small v-if="isGifCover" class="cover-row-badge">GIF</small>
          </button>
          <div class="cover-panel-actions">
            <button class="command" @click="openCover"><FolderOpen :size="16" /><span>上传</span></button>
            <button class="command" @click="openCoverEditor"><Images :size="16" /><span>编辑封面</span></button>
          </div>
        </div>

        <div class="panel obs-panel" :class="{ 'panel-online': store.obs.connected }">
          <div class="panel-head">
            <h3>OBS 联动</h3>
            <span>{{ obsStatusText }}</span>
          </div>
          <div class="form-grid">
            <label>
              <span>OBS WebSocket</span>
              <input v-model="store.obs.url" placeholder="ws://127.0.0.1:4455" @change="store.persist" />
            </label>
            <label>
              <span>OBS 密码</span>
              <input v-model="store.obs.password" type="password" @change="store.persist" />
            </label>
          </div>
          <div class="toggle-row">
            <label class="checkbox-label">
              <input v-model="store.obs.autoStartLive" type="checkbox" @change="store.persist" />
              <span>接收流后自动开播</span>
            </label>
            <label class="checkbox-label">
              <input v-model="store.obs.stopStreamingAfterClose" type="checkbox" @change="store.persist" />
              <span>关播时停 OBS</span>
            </label>
          </div>
          <div class="button-row compact-buttons">
            <button class="command" @click="run(() => store.testObsConnection(), 'OBS 已连接，推流码已同步')">
              <PlugZap :size="16" /><span>{{ store.obs.connected ? '检查' : '连接' }}</span>
            </button>
            <button class="command" :disabled="!store.obs.connected" @click="run(() => store.pushObsStreamSettings(), '已同步推流码')">
              <KeyRound :size="16" /><span>同步推流码</span>
            </button>
            <button
              class="command"
              :class="store.obs.streaming ? 'danger' : 'primary'"
              :disabled="!store.obs.connected || (obsAutoStartBusy && !store.obs.streaming)"
              @click="obsToggleStream"
            >
              <component :is="obsToggleIcon" :size="16" /><span>{{ obsToggleLabel }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- 直播间 -->
      <section v-if="store.activeTab === 'room'" class="room-grid">
        <div class="panel wide">
          <div class="panel-head">
            <h3>直播间</h3>
            <button class="text-button" :disabled="!store.userId" @click="openLiveRoom">
              <ExternalLink :size="14" /><span>打开网页直播间</span>
            </button>
          </div>
          <div class="metrics">
            <div><strong>{{ store.room.isLive ? "开播中" : "未开播" }}</strong><span>状态</span></div>
            <div><strong>{{ store.room.liveId || "-" }}</strong><span>LiveID</span></div>
            <div><strong>{{ store.room.onlineCount }}</strong><span>在线</span></div>
            <div><strong>{{ store.room.danmakuList.length }}</strong><span>弹幕</span></div>
            <div><strong>{{ store.room.watchingList.length }}</strong><span>观众</span></div>
            <div><strong>{{ store.room.managerList.length }}</strong><span>房管</span></div>
          </div>
          <div class="metrics room-engagement">
            <div><strong>{{ displayCount(store.room.likeCount) }}</strong><span>点赞</span></div>
            <div><strong>{{ displayCount(store.room.bananaCount) }}</strong><span>香蕉</span></div>
          </div>
          <div class="danmaku-compose">
            <input ref="commentInputRef" v-model="commentText" placeholder="发送弹幕" @keyup.enter="sendComment" />
            <select class="a-island-emote-select" value="" title="插入颜文字" @change="insertAIslandEmote($event.target.value, $event.target)">
              <option value="" disabled>( ﾟ∀。)</option>
              <option v-for="(item, index) in aIslandEmotes" :key="`${index}-${item}`" :value="item">{{ item }}</option>
            </select>
            <button class="command primary" @click="sendComment"><Send :size="16" /><span>发送</span></button>
            <button class="command" @click="run(() => store.loadRoom())"><RefreshCw :size="16" /><span>刷新</span></button>
            <button class="command" @click="run(() => store.startDanmu({ restart: true }))"><Radio :size="16" /><span>重连</span></button>
            <button class="command" @click="store.room.danmakuList = []"><Trash2 :size="16" /><span>清空</span></button>
          </div>
        </div>

        <div class="panel table-panel wide">
          <div class="panel-head">
            <h3>弹幕流</h3>
            <span>{{ store.room.danmakuList.length }} 条</span>
          </div>
          <div class="feed-list">
            <article v-for="item in store.room.danmakuList" :key="item.uniqueId" class="feed-item" :class="{ self: item.self }">
              <span class="feed-time">{{ formatTime(item.time) }}</span>
              <strong>{{ item.nickname }}</strong>
              <span class="feed-content">{{ item.content }}</span>
              <span v-if="item.isGift" class="tag">x{{ item.num }}</span>
              <button class="small-icon danger" title="踢出" @click="run(() => store.kickUser(item))"><Ban :size="14" /></button>
            </article>
            <div v-if="!store.room.danmakuList.length" class="empty-state">开播后这里会显示实时弹幕。</div>
          </div>
        </div>

        <div class="panel table-panel">
          <div class="panel-head">
            <h3>观众 ({{ store.room.watchingList.length }})</h3>
            <button class="text-button" @click="run(() => store.loadWatchingList())">刷新</button>
          </div>
          <div class="compact-list">
            <article v-for="item in store.room.watchingList" :key="item.userId" class="compact-item">
              <div>
                <strong>{{ item.nickname }}</strong>
                <span>{{ item.userId }}</span>
              </div>
              <div class="row-actions">
                <button class="small-icon" title="房管" @click="run(() => store.addManager(item))"><ShieldPlus :size="14" /></button>
                <button class="small-icon danger" title="踢出" @click="run(() => store.kickUser(item))"><Ban :size="14" /></button>
                <button class="small-icon" title="拉黑" @click="store.blockUser(item)"><UserX :size="14" /></button>
              </div>
            </article>
            <div v-if="!store.room.watchingList.length" class="empty-state compact-empty">暂无观众</div>
          </div>
        </div>

        <div class="panel table-panel">
          <div class="panel-head">
            <h3>贡献榜 ({{ store.room.billList.length }})</h3>
            <span>礼物贡献</span>
          </div>
          <div class="compact-list">
            <article v-for="(item, index) in store.room.billList" :key="item.userId || index" class="compact-item">
              <div class="compact-user">
                <span class="rank-badge">{{ index + 1 }}</span>
                <span>
                  <strong>{{ item.nickname || "匿名用户" }}</strong>
                  <span>{{ item.userId || "-" }}</span>
                </span>
              </div>
              <span class="tag">{{ item.displaySendAmount || "-" }}</span>
            </article>
            <div v-if="!store.room.billList.length" class="empty-state compact-empty">暂无贡献数据</div>
          </div>
        </div>

        <div class="panel table-panel">
          <div class="panel-head">
            <h3>房管 ({{ store.room.managerList.length }})</h3>
            <button class="text-button" @click="run(() => store.loadManagerList())">刷新</button>
          </div>
          <div class="compact-list">
            <article v-for="item in store.room.managerList" :key="item.userId" class="compact-item">
              <div class="compact-user">
                <span class="avatar avatar-sm">
                  <img v-if="item.avatar" :src="item.avatar" alt="" />
                  <span v-else>{{ (item.nickname || 'A').slice(0, 1).toUpperCase() }}</span>
                </span>
                <span>
                  <strong>{{ item.nickname }}</strong>
                  <span>{{ item.userId }}</span>
                </span>
              </div>
              <button class="small-icon danger" title="移除" @click="run(() => store.deleteManager(item))"><ShieldMinus :size="14" /></button>
            </article>
            <div v-if="!store.room.managerList.length" class="empty-state compact-empty">暂无房管</div>
          </div>
        </div>
      </section>

      <!-- OBS 弹幕源 -->
      <section v-if="store.activeTab === 'overlay'" class="overlay-grid">
        <div class="panel wide">
          <div class="panel-head">
            <h3>OBS 弹幕浏览器源</h3>
          </div>
          <label class="block-label">
            <span>浏览器来源 URL</span>
            <div class="inline-input">
              <input :value="danmakuOverlayUrl" readonly />
              <button class="icon-button" title="复制" @click="copy(danmakuOverlayUrl)"><Clipboard :size="16" /></button>
            </div>
          </label>
          <div class="overlay-control-grid">
            <label><span>宽度</span><input v-model.number="store.overlay.width" type="number" min="240" max="1920" @change="store.persist" /></label>
            <label><span>高度</span><input v-model.number="store.overlay.height" type="number" min="240" max="1080" @change="store.persist" /></label>
            <label><span>显示数</span><input v-model.number="store.overlay.maxItems" type="number" min="4" max="80" @change="store.persist" /></label>
            <label><span>字号</span><input v-model.number="store.overlay.fontSize" type="number" min="12" max="48" @change="store.persist" /></label>
            <label><span>圆角</span><input v-model.number="store.overlay.rounded" type="number" min="0" max="40" @change="store.persist" /></label>
            <label><span>间距</span><input v-model.number="store.overlay.gap" type="number" min="0" max="32" @change="store.persist" /></label>
            <label><span>动画</span>
              <select v-model="store.overlay.animation" @change="store.persist">
                <option value="slide">滑入</option>
                <option value="float">上浮</option>
                <option value="pop">弹出</option>
                <option value="fade">淡入</option>
              </select>
            </label>
            <label><span>简繁转换</span>
              <select v-model="store.overlay.convertChinese" @change="store.persist">
                <option value="none">不转换</option>
                <option value="s2t">转繁体</option>
                <option value="t2s">转简体</option>
              </select>
            </label>
          </div>
          <div class="overlay-control-grid cols-2">
            <label><span>用户名字体</span>
              <select v-model="store.overlay.nameFontFamily" @change="store.persist">
                <option v-for="font in systemFonts" :key="font" :value="font">{{ font }}</option>
              </select>
            </label>
            <label><span>内容字体</span>
              <select v-model="store.overlay.contentFontFamily" @change="store.persist">
                <option v-for="font in systemFonts" :key="font" :value="font">{{ font }}</option>
              </select>
            </label>
          </div>
          <div class="overlay-control-grid cols-3">
            <label><span>文字色</span>
              <HsvColorPicker v-model="store.overlay.textColor" @update:modelValue="store.persist" />
            </label>
            <label><span>昵称色</span>
              <HsvColorPicker v-model="store.overlay.nameColor" @update:modelValue="store.persist" />
            </label>
            <label><span>气泡色</span>
              <HsvColorPicker v-model="store.overlay.bubbleColor" alpha @update:modelValue="store.persist" />
            </label>
          </div>
          <div class="overlay-control-grid">
            <div class="toggle-row full">
              <label class="checkbox-label">
                <input v-model="store.overlay.bubbleEnabled" type="checkbox" @change="store.persist" />
                <span>气泡背景</span>
              </label>
              <label class="checkbox-label">
                <input v-model="store.overlay.showAvatar" type="checkbox" @change="store.persist" />
                <span>显示头像</span>
              </label>
            </div>
          </div>
          <div class="overlay-preview" :style="overlayPreviewStyle">
            <article
              v-for="item in previewItems"
              :key="item.id"
              class="overlay-preview-item"
              :class="[store.overlay.animation, { plain: !store.overlay.bubbleEnabled }]"
            >
              <div v-if="store.overlay.showAvatar" class="overlay-preview-avatar">{{ avatarInitial(item.nickname) }}</div>
              <div>
                <strong>{{ convertPreviewText(item.nickname) }}</strong>
                <span>{{ convertPreviewText(item.content) }}</span>
              </div>
            </article>
          </div>
          <div class="panel-actions compact overlay-preview-actions">
            <button class="command" @click="replayOverlayPreview"><Play :size="16" /><span>预览动画</span></button>
          </div>
        </div>
      </section>

      <!-- 数据 -->
      <section v-if="store.activeTab === 'stats'" class="stats-page-grid">
        <div class="panel">
          <div class="panel-head">
            <h3>本场直播</h3>
            <span>{{ store.summary.liveId ? "已生成" : "关播后显示" }}</span>
          </div>
          <dl v-if="store.summary.liveId" class="summary-list">
            <div><dt>LiveID</dt><dd>{{ store.summary.liveId }}</dd></div>
            <div><dt>时长</dt><dd>{{ store.summary.duration }}</dd></div>
            <div><dt>结束</dt><dd>{{ store.summary.endedAt || "-" }}</dd></div>
            <div><dt>观看</dt><dd>{{ store.summary.watchCount }}</dd></div>
            <div><dt>点赞</dt><dd>{{ store.summary.likeCount }}</dd></div>
            <div><dt>结束原因</dt><dd>{{ store.summary.endReason || "-" }}</dd></div>
            <div><dt>钻石</dt><dd>{{ store.summary.diamond }}</dd></div>
            <div><dt>礼物</dt><dd>{{ store.summary.gift }}</dd></div>
            <div><dt>香蕉</dt><dd>{{ store.summary.banana }}</dd></div>
          </dl>
          <div v-else class="empty-state compact-empty">关播后这里会显示本场直播数据统计。</div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>转码信息</h3>
            <span>{{ store.live.transcodes.length }} 路</span>
          </div>
          <div class="compact-list">
            <article v-for="item in store.live.transcodes" :key="item.template || item.resolution" class="compact-item">
              <div>
                <strong>{{ item.streamURL?.qualityName || item.streamURL?.qualityType || item.template }}</strong>
                <span>{{ item.resolution }} / {{ item.frameRate }} FPS</span>
              </div>
              <span class="tag">{{ item.streamURL?.bitrate || "-" }}</span>
            </article>
            <div v-if="!store.live.transcodes.length" class="empty-state compact-empty">开播后显示转码信息</div>
          </div>
          <div class="button-row compact-buttons">
            <button class="command" @click="run(() => store.loadTranscodeInfo())">
              <Activity :size="16" /><span>刷新转码</span>
            </button>
          </div>
        </div>

        <div class="panel wide">
          <div class="panel-head">
            <h3>直播历史</h3>
            <span>{{ store.liveHistory.length }} 场</span>
          </div>
          <div v-if="store.liveHistory.length" class="history-list">
            <article v-for="item in store.liveHistory" :key="item.liveId" class="history-item">
              <div>
                <strong>{{ item.title || item.liveId }}</strong>
                <span>{{ item.endedAt }} / {{ item.liveId }}</span>
              </div>
              <dl>
                <div><dt>时长</dt><dd>{{ item.duration }}</dd></div>
                <div><dt>观看</dt><dd>{{ item.watchCount }}</dd></div>
                <div><dt>点赞</dt><dd>{{ item.likeCount }}</dd></div>
                <div><dt>钻石</dt><dd>{{ item.diamond }}</dd></div>
                <div><dt>礼物</dt><dd>{{ item.gift }}</dd></div>
                <div><dt>香蕉</dt><dd>{{ item.banana }}</dd></div>
              </dl>
              <div class="history-actions">
                <button class="small-icon" title="查看曲线" @click="openHistoryChart(item)">
                  <LineChart :size="14" />
                </button>
                <button class="small-icon danger" title="删除记录" @click="store.removeLiveRecord(item.liveId)">
                  <Trash2 :size="14" />
                </button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state compact-empty">关播后会自动保存每场直播统计。</div>
        </div>
      </section>

      <!-- 日志 -->
      <section v-if="store.activeTab === 'logs'" class="panel">
        <div class="panel-head">
          <h3>日志 ({{ store.logs.length }})</h3>
          <div class="row-actions">
            <button class="command" :title="logPath || '尚未生成'" @click="openLogs">
              <FolderOpen :size="15" /><span>打开日志文件夹</span>
            </button>
            <button class="command" @click="copy(logPath)" :disabled="!logPath">
              <Clipboard :size="15" /><span>复制路径</span>
            </button>
            <button class="text-button" @click="store.logs = []">清空界面</button>
          </div>
        </div>
        <p v-if="logPath" class="log-path">{{ logPath }}</p>
        <div class="log-list">
          <article v-for="item in store.logs" :key="item.id">
            <time>{{ item.time }}</time>
            <span>{{ item.message }}</span>
          </article>
          <div v-if="!store.logs.length" class="empty-state compact-empty">暂无日志</div>
        </div>
      </section>

      <!-- 封面裁切弹窗 -->
      <Teleport to="body">
        <div v-if="cropModalOpen" class="modal-backdrop" @mousedown.self="closeCropModal" @keydown.esc="closeCropModal" tabindex="-1" ref="cropModalRef">
          <div class="modal-card cover-crop-modal">
            <header class="modal-head">
              <h3>裁切封面</h3>
              <button class="icon-button" title="关闭" @click="closeCropModal"><X :size="18" /></button>
            </header>
            <div
              class="cover-preview-frame modal-preview"
              :class="{ dragging: coverDragging, gif: isGifCover }"
              :style="coverAspectStyle"
              @mousedown="startCoverDrag"
            >
              <img
                v-if="coverPreviewSrc"
                ref="coverImageRef"
                class="cover-preview-image"
                :src="coverPreviewSrc"
                :style="coverPreviewImageStyle"
                alt="封面预览"
                draggable="false"
                @load="coverImageReady = true"
                @error="coverImageReady = false"
              />
              <span v-if="isGifCover" class="cover-format-badge">GIF</span>
              <div v-if="!coverPreviewSrc" class="cover-empty">未选择封面</div>
              <div v-else-if="!isGifCover" class="cover-drag-hint">拖动图片调整位置</div>
            </div>
            <div class="cover-modal-controls">
              <div class="cover-aspect-row">
                <span>比例</span>
                <div class="segmented">
                  <button
                    type="button"
                    :class="{ active: store.live.coverAspect === '16:10' }"
                    @click="setCoverAspect('16:10')"
                  >16:10</button>
                  <button
                    type="button"
                    :class="{ active: store.live.coverAspect === '16:9' }"
                    @click="setCoverAspect('16:9')"
                  >16:9</button>
                </div>
              </div>
              <label class="cover-zoom">
                <span>缩放 {{ Math.round(coverCrop.zoom * 100) }}%</span>
                <input v-model.number="coverCrop.zoom" type="range" min="1" max="3" step="0.05" :disabled="isGifCover || !coverPreviewSrc" />
              </label>
              <label class="block-label">
                <span>封面路径或 URL</span>
                <div class="inline-input">
                  <input v-model="store.live.coverFile" @change="handleCoverInput" placeholder="本地路径或 URL" />
                  <button class="icon-button" title="选择文件" @click="openCover"><FolderOpen :size="16" /></button>
                </div>
              </label>
              <div v-if="store.live.coverHistory.length" class="cover-history">
                <div
                  v-for="item in store.live.coverHistory"
                  :key="item"
                  class="cover-history-item"
                  :class="{ active: item === store.live.coverFile }"
                  :title="item"
                  role="button"
                  tabindex="0"
                  @click="selectCoverHistory(item)"
                  @keyup.enter="selectCoverHistory(item)"
                >
                  <span class="cover-history-thumb">
                    <img v-if="coverThumbSrc(item)" :src="coverThumbSrc(item)" :style="cropTransformStyle(item) || undefined" alt="" />
                  </span>
                  <span>{{ coverName(item) }}<small v-if="isGifFile(item)"> GIF</small></span>
                  <button
                    type="button"
                    class="cover-history-remove"
                    title="从历史中移除"
                    @click.stop="store.removeCoverHistory(item)"
                  >
                    <X :size="12" />
                  </button>
                </div>
              </div>
              <div class="modal-actions">
                <button class="command" @click="closeCropModal">取消</button>
                <button class="command primary" :disabled="!coverImageReady || isGifCover" @click="saveAndCloseCover">
                  <Scissors :size="16" /><span>保存</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <div v-if="historyChartRecord" class="modal-backdrop" @click.self="historyChartRecord = null">
        <div class="modal-card history-chart-modal">
          <div class="modal-head">
            <h3>{{ historyChartRecord.title || historyChartRecord.liveId }} 曲线</h3>
            <button class="small-icon" title="关闭" @click="historyChartRecord = null"><X :size="16" /></button>
          </div>
          <div v-if="historyChartSeries.points.length >= 2" class="history-chart">
            <svg
              viewBox="0 0 720 260"
              role="img"
              aria-label="直播观众数和弹幕数曲线"
              @mousemove="updateHistoryChartHover"
              @mouseleave="historyChartHover = null"
            >
              <g class="history-chart-grid">
                <line v-for="y in historyChartGridY" :key="y" x1="40" :y1="y" x2="700" :y2="y" />
              </g>
              <polyline class="history-chart-line online" :points="historyChartSeries.onlinePoints" />
              <polyline class="history-chart-line danmaku" :points="historyChartSeries.danmakuPoints" />
              <g class="history-chart-axis">
                <line x1="40" y1="220" x2="700" y2="220" />
                <line x1="40" y1="24" x2="40" y2="220" />
              </g>
              <g v-if="historyChartHover" class="history-chart-hover">
                <line :x1="historyChartHover.x" y1="24" :x2="historyChartHover.x" y2="220" />
                <circle :cx="historyChartHover.x" :cy="historyChartHover.onlineY" r="4" class="online" />
                <circle :cx="historyChartHover.x" :cy="historyChartHover.danmakuY" r="4" class="danmaku" />
                <foreignObject :x="historyChartHover.tooltipX" :y="historyChartHover.tooltipY" width="168" height="76">
                  <div class="history-chart-tooltip">
                    <strong>{{ historyChartHover.timeText }}</strong>
                    <span class="online">观众 {{ historyChartHover.onlineCount }}</span>
                    <span class="danmaku">{{ historyDanmakuChartText }} {{ historyChartHover.danmakuValue }}{{ historyDanmakuChartUnit }}</span>
                  </div>
                </foreignObject>
              </g>
            </svg>
            <div class="history-chart-legend">
              <span><i class="online"></i>观众数</span>
              <span><i class="danmaku"></i>{{ historyDanmakuChartText }}{{ historyDanmakuChartUnit }}</span>
              <span>采样点 {{ historyChartSeries.points.length }}</span>
              <button class="history-chart-toggle" @click="toggleHistoryDanmakuChartMode">
                切换为{{ historyDanmakuChartMode === "delta" ? "累计弹幕数" : "弹幕增量" }}
              </button>
            </div>
          </div>
          <div v-else class="empty-state">这场直播暂无曲线数据，之后关播保存的场次会记录曲线。</div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import {
  Activity,
  Ban,
  ChartBar,
  Clipboard,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Heart,
  ImageUp,
  KeyRound,
  LineChart,
  ListTree,
  LogOut,
  Moon,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  PlugZap,
  QrCode,
  Radio,
  RefreshCw,
  Images,
  RotateCcw,
  Scissors,
  ScrollText,
  Send,
  Server,
  ShieldMinus,
  ShieldPlus,
  Square,
  Sun,
  Trash2,
  User,
  Users,
  UserX,
  Video,
  X,
} from "@lucide/vue"
import { useLiveStore } from "@/stores/liveStore"
import HsvColorPicker from "@/components/HsvColorPicker.vue"
import {
  copyText,
  getBackendPort,
  getLogPath,
  getOverlayBaseUrl,
  getSystemFonts,
  openCoverFile,
  openExternalURL,
  openLogFolder,
  readCoverFile,
  saveCoverImage,
} from "@/services/nativeBridge"

const store = useLiveStore()
const toast = ref("")
const qrLoginRunning = ref(false)
const loginForm = reactive({
  account: "",
  password: "",
})
const commentText = ref("")
const commentInputRef = ref(null)
const coverPreviewSrc = ref("")
const overlayBaseUrl = ref("")
const logPath = ref("")
const systemFonts = ref(["Microsoft YaHei", "Noto Sans SC", "Segoe UI", "Arial", "sans-serif"])
const previewPlaceholder = { id: 0, nickname: "AcFun用户", content: "这是一条弹幕预览，样式会同步到 OBS 浏览器源。" }
const previewItems = ref([previewPlaceholder])
let previewItemSeq = 1
const previewPool = [
  { nickname: "AC娘亲卫队", content: "认真你就输啦，AC娘镇楼" },
  { nickname: "蕉皇驾到", content: "已投三根香蕉，主播加油" },
  { nickname: "鬼畜全明星", content: "鬼畜全明星永远的神" },
  { nickname: "鬼畜区路人", content: "这素材建议剪个金坷垃版本" },
  { nickname: "滑板鞋赛车手", content: "摩擦摩擦，魔鬼的步伐" },
  { nickname: "荼荼丸门徒", content: "求音MAD大佬来调教这段" },
  { nickname: "严选娘粉", content: "严选娘和TD娘同框可还行" },
  { nickname: "阿婵小护卫", content: "阿婵今天也是元气满满" },
  { nickname: "镇站之宝", content: "主播是新晋镇站之宝，233333" },
  { nickname: "白屏受害者", content: "AC娘是不是又大姨妈了" },
  { nickname: "二次元绅士", content: "我从未见过如此厚颜无耻之人" },
  { nickname: "雷电法王", content: "阿妹你看，上帝压狗" },
  { nickname: "弹幕护体", content: "弹幕护体，雪豹闭嘴！" },
  { nickname: "前方高能", content: "高能预警，先打个码再看" },
  { nickname: "老司机带带我", content: "233333 主播带带我飞" },
  { nickname: "硬核绅士", content: "内容很硬核，再送主播一根香蕉" },
  { nickname: "数码玩家", content: "视频清晰度爆表，资讯量真足" },
  { nickname: "网络冲浪手", content: "网络稳得一批，全程零卡顿" },
  { nickname: "码农路过", content: "建议主播换台计算机，性能更猛" },
  { nickname: "新软件迷", content: "求主播推荐一款好用的软件" },
  { nickname: "信息搬运工", content: "这条信息更新得太快了吧" },
  { nickname: "光速摸鱼", content: "激光秀拉满，眼睛要瞎啦" },
  { nickname: "数据党", content: "数据太顶，必须收藏起来反复看" },
  { nickname: "审核辛苦组", content: "审核大大辛苦了，求过审" },
  { nickname: "天下漫友", content: "天下漫友是一家，干杯！" },
  { nickname: "猴山老AC", content: "当年猴山的味道又回来了" },
  { nickname: "番剧爱好者", content: "看完番剧顺手摸进直播间" },
  { nickname: "弹幕大军", content: "然而并没有什么卵用，233" },
  { nickname: "永恒老粉", content: "我永远喜欢AC娘，永远的家" },
  { nickname: "投蕉路过", content: "路过投蕉，主播继续冲" },
  { nickname: "鸡盒肥肥", content: "单刷鸡盒" },
  { nickname: "休斯顿", content: "休斯顿，我们有麻烦了" },
  { nickname: "倒计时", content: "倒计时-发射成功" },
  { nickname: "发射员", content: "倒计时-发射失败-等等" },
  { nickname: "SAGE", content: "吃我SAGE啦" },
  { nickname: "MC石头", content: "认准唯一QQ" },
  { nickname: "嗨呀酱", content: "嗨呀我又来这个串了" },
  { nickname: "欢乐jb", content: "我好高兴，因为我是欢乐jb" },
  { nickname: "卧铺肥肥", content: "一上火车就大喊，嗨呀我又来坐卧铺了" },
  { nickname: "po主", content: "我每天来这个串看看po有没有更新的ᕕ( ᐛ )ᕗ" },
  { nickname: "阴阳酱", content: "(　^ω^)(　ˇωˇ)" },
  { nickname: "小殇君", content: "(｡◕∀◕｡)" },
  { nickname: "弱智酱", content: "( ﾟ∀。) 这怎么回事" },
  { nickname: "牛子", content: "(つд⊂)" },
  { nickname: "齐齐蛤尔", content: "(`ヮ´ )σ`∀´) ﾟ∀ﾟ)σ" },
  { nickname: "忧郁傻卵", content: "( ·_ゝ·)" },
  { nickname: "举高高", content: "(ノﾟ∀ﾟ)ノ 生日快乐" },
  { nickname: "電柱", content: "┃電柱┃д⊂)" },
  { nickname: "口水酱", content: "( ´ρ`)" },
  { nickname: "打脸酱", content: "⊂彡☆))д`)" },
  { nickname: "喂我酱", content: "σ( ᑒ )" },
  { nickname: "防剧透", content: "[h]这里是防剧透文字[/h]" },
]
const aIslandEmotes = [
  "|∀ﾟ",
  "(´ﾟДﾟ`)",
  "(;´Д`)",
  "(｀･ω･)",
  "(=ﾟωﾟ)=",
  "| ω・´)",
  "|-` )",
  "|д` )",
  "|ー` )",
  "|∀` )",
  "(つд⊂)",
  "(ﾟДﾟ≡ﾟДﾟ)",
  "(＾o＾)ﾉ",
  "(|||ﾟДﾟ)",
  "( ﾟ∀ﾟ)",
  "( ´∀`)",
  "(*´∀`)",
  "(*ﾟ∇ﾟ)",
  "(*ﾟーﾟ)",
  "(　ﾟ 3ﾟ)",
  "( ´ー`)",
  "( ・_ゝ・)",
  "( ´_ゝ`)",
  "(*´д`)",
  "(・ー・)",
  "(・∀・)",
  "(ゝ∀･)",
  "(〃∀〃)",
  "(*ﾟ∀ﾟ*)",
  "( ﾟ∀。)",
  "( `д´)",
  "(`ε´ )",
  "(`ヮ´ )",
  "σ`∀´)",
  " ﾟ∀ﾟ)σ",
  "ﾟ ∀ﾟ)ノ",
  "(╬ﾟдﾟ)",
  "(|||ﾟдﾟ)",
  "( ﾟдﾟ)",
  "Σ( ﾟдﾟ)",
  "( ;ﾟдﾟ)",
  "( ;´д`)",
  "(　д ) ﾟ ﾟ",
  "( ☉д⊙)",
  "(((　ﾟдﾟ)))",
  "( ` ・´)",
  "( ´д`)",
  "( -д-)",
  "(>д<)",
  "･ﾟ( ﾉд`ﾟ)",
  "( TдT)",
  "(￣∇￣)",
  "(￣3￣)",
  "(￣ｰ￣)",
  "(￣ . ￣)",
  "(￣皿￣)",
  "(￣艸￣)",
  "(￣︿￣)",
  "(￣︶￣)",
  "ヾ(´ωﾟ｀)",
  "(*´ω`*)",
  "(・ω・)",
  "( ´・ω)",
  "(｀・ω)",
  "(´・ω・`)",
  "(`・ω・´)",
  "( `_っ´)",
  "( `ー´)",
  "( ´_っ`)",
  "( ´ρ`)",
  "( ﾟωﾟ)",
  "(oﾟωﾟo)",
  "(　^ω^)",
  "(｡◕∀◕｡)",
  "/( ◕‿‿◕ )\\",
  "ヾ(´ε`ヾ)",
  "(ノﾟ∀ﾟ)ノ",
  "(σﾟдﾟ)σ",
  "(σﾟ∀ﾟ)σ",
  "|дﾟ )",
  "┃電柱┃",
  "ﾟ(つд`ﾟ)",
  "ﾟÅﾟ )　",
  "⊂彡☆))д`)",
  "⊂彡☆))д´)",
  "⊂彡☆))∀`)",
  "(´∀((☆ミつ",
  "･ﾟ( ﾉヮ´ )",
  "(ﾉ)`ω´(ヾ)",
  "ᕕ( ᐛ )ᕗ",
  "(　ˇωˇ)",
  "( ｣ﾟДﾟ)｣＜",
  "( ›´ω`‹ )",
  "(;´ヮ`)7",
  "(`ゥ´ )",
  "(`ᝫ´ )",
  "( ᑭ`д´)ᓀ))д´)ᑫ",
  "σ( ᑒ )",
  "(`ヮ´ )σ`∀´) ﾟ∀ﾟ)σ",
  "吁~~~~　　rnm，退钱！\n　　　/　　　/ \n(　ﾟ 3ﾟ) `ー´) `д´) `д´)",
  "[h] [/h]",
  "[n]",
  "[n,m]",
]
const previewConverter = ref((text) => text)
const streamKeyVisible = ref(false)
const uiScalePercent = ref(100)
const isExtremeNarrowSidebar = ref(false)
const sidebarToggleFlash = ref(false)
const sidebarHearts = ref([])
const coverImageReady = ref(false)
const coverImageRef = ref(null)
const coverCrop = reactive({
  x: 50,
  y: 50,
  zoom: 1,
})
const initialCrop = reactive({
  x: 50,
  y: 50,
  zoom: 1,
  aspect: "16:10",
})
const cropModalOpen = ref(false)
const cropModalRef = ref(null)
const coverDragging = ref(false)
const historyChartRecord = ref(null)
const historyChartHover = ref(null)
const historyDanmakuChartMode = ref("delta")

const tabs = [
  { id: "account", label: "账号", subtitle: "登录 AcFun 并连接 acfunlive-backend", icon: User },
  { id: "live", label: "开播", subtitle: "标题、封面、分区、推流码与 OBS 联动", icon: Video },
  { id: "room", label: "直播间", subtitle: "弹幕、观众、房管与黑名单", icon: Users },
  { id: "overlay", label: "弹幕源", subtitle: "OBS 浏览器源外观与预览", icon: MonitorPlay },
  { id: "stats", label: "数据", subtitle: "本场统计、转码信息与历史", icon: ChartBar },
  { id: "logs", label: "日志", subtitle: "本地操作记录", icon: ScrollText },
]

const currentTab = computed(() => tabs.find((item) => item.id === store.activeTab) || tabs[0])
const subtitleParts = computed(() => highlightAcfun(currentTab.value.subtitle))
const userInitial = computed(() => (store.userName || "A").trim().slice(0, 1).toUpperCase())
const themeIcon = computed(() => store.ui.theme === "dark" ? Sun : Moon)
const sidebarToggleIcon = computed(() => {
  if (isExtremeNarrowSidebar.value) {
    return Heart
  }
  return store.ui.sidebarCollapsed ? PanelLeftOpen : PanelLeftClose
})
const sidebarToggleTitle = computed(() => {
  if (isExtremeNarrowSidebar.value) {
    return "点赞"
  }
  return store.ui.sidebarCollapsed ? "展开侧栏" : "折叠侧栏"
})
const appShellStyle = computed(() => ({
  zoom: store.ui.uiScale,
  "--ui-scale-percent": uiScalePercent.value,
  "--ui-scale-fill": `${uiScalePercent.value - 50}%`,
}))
const isGifCover = computed(() => isGifFile(store.live.coverFile))
const coverAspectRatio = computed(() => store.live.coverAspect === "16:9" ? 16 / 9 : 16 / 10)
const coverAspectStyle = computed(() => ({ aspectRatio: String(coverAspectRatio.value) }))
const danmakuOverlayUrl = computed(() => makeDanmakuOverlayUrl())
const coverPreviewImageStyle = computed(() => ({
  objectPosition: `${coverCrop.x}% ${coverCrop.y}%`,
  transform: `scale(${coverCrop.zoom})`,
  transformOrigin: `${coverCrop.x}% ${coverCrop.y}%`,
}))
function cropTransformStyle(file) {
  const crop = file && store.live.coverCrops ? store.live.coverCrops[file] : null
  if (!crop) return null
  const x = Number(crop.x) || 50
  const y = Number(crop.y) || 50
  const zoom = Number(crop.zoom) || 1
  return {
    objectPosition: `${x}% ${y}%`,
    transform: `scale(${zoom})`,
    transformOrigin: `${x}% ${y}%`,
  }
}
const topTranscodeText = computed(() => {
  const list = store.live.transcodes
  if (!Array.isArray(list) || list.length === 0) {
    return "-"
  }
  const bitrate = (item) => Number(item?.streamURL?.bitrate) || 0
  const best = list.reduce((a, b) => (bitrate(b) > bitrate(a) ? b : a))
  const name = best?.streamURL?.qualityName || best?.streamURL?.qualityType || best?.template || ""
  const kbps = bitrate(best)
  const mbps = kbps >= 1000 ? `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)}M` : kbps ? `${kbps}k` : ""
  if (name && mbps && normalizeBitrateText(name).includes(normalizeBitrateText(mbps))) {
    return name
  }
  return [name, mbps].filter(Boolean).join(" ") || "-"
})
function normalizeBitrateText(text) {
  return String(text || "").replace(/(\d+)\.0(?=M|k)/gi, "$1").replace(/\s+/g, "").toLowerCase()
}
const isLiveActive = computed(() => store.live.isLive || store.room.isLive)
const obsAutoStartBusy = computed(() =>
  ["waiting", "starting"].includes(store.obs.autoStartStatus),
)
const obsToggleLabel = computed(() => {
  if (store.obs.streaming) return "停止推流"
  if (store.obs.autoStartStatus === "waiting") return "等待流"
  if (store.obs.autoStartStatus === "starting") return "开播中"
  return "OBS 推流"
})
const obsToggleIcon = computed(() => (store.obs.streaming ? Square : Radio))
const historyDanmakuChartText = computed(() => historyDanmakuChartMode.value === "delta" ? "弹幕增量" : "累计弹幕数")
const historyDanmakuChartUnit = computed(() => historyDanmakuChartMode.value === "delta" ? "/分钟" : "")
const historyChartGridY = [56, 96, 136, 176, 220]
const historyChartSeries = computed(() => {
  const points = Array.isArray(historyChartRecord.value?.timeline) ? historyChartRecord.value.timeline : []
  const normalized = points
    .map((item) => ({
      time: Number(item.time || 0),
      onlineCount: Number(item.onlineCount || 0),
      danmakuCount: Number(item.danmakuCount || 0),
    }))
    .filter((item) => item.time > 0)
    .sort((a, b) => a.time - b.time)
  if (normalized.length < 2) {
    return { points: normalized, onlinePoints: "", danmakuPoints: "" }
  }
  const withDelta = normalized.map((item, index) => {
    const previous = normalized[index - 1]
    if (!previous) {
      return { ...item, danmakuDelta: 0 }
    }
    const countDelta = Math.max(0, item.danmakuCount - previous.danmakuCount)
    const minutes = Math.max((item.time - previous.time) / 60000, 1 / 60)
    return { ...item, danmakuDelta: Math.round(countDelta / minutes) }
  })
  const firstTime = normalized[0].time
  const lastTime = normalized[normalized.length - 1].time
  const timeRange = Math.max(1, lastTime - firstTime)
  const maxOnline = Math.max(1, ...normalized.map((item) => item.onlineCount))
  const danmakuKey = historyDanmakuChartMode.value === "delta" ? "danmakuDelta" : "danmakuCount"
  const maxDanmaku = Math.max(1, ...withDelta.map((item) => item[danmakuKey]))
  const chartPoints = withDelta.map((item) => ({
    ...item,
    danmakuValue: item[danmakuKey],
    x: 40 + ((item.time - firstTime) / timeRange) * 660,
    onlineY: 220 - (item.onlineCount / maxOnline) * 196,
    danmakuY: 220 - (item[danmakuKey] / maxDanmaku) * 196,
  }))
  const toPolyline = (key) => chartPoints
    .map((item) => `${item.x.toFixed(1)},${item[key].toFixed(1)}`)
    .join(" ")
  return {
    points: chartPoints,
    onlinePoints: toPolyline("onlineY"),
    danmakuPoints: toPolyline("danmakuY"),
  }
})
function obsToggleStream() {
  if (store.obs.streaming) {
    run(() => store.stopObsStream(), "OBS 已停推")
  } else {
    run(
      () => store.startObsAndAutoLive(),
      (startedLive) => startedLive ? "开播成功" : "OBS 已开始推流",
    )
  }
}

function openHistoryChart(item) {
  historyChartRecord.value = item
  historyChartHover.value = null
}

function toggleHistoryDanmakuChartMode() {
  historyDanmakuChartMode.value = historyDanmakuChartMode.value === "delta" ? "total" : "delta"
  historyChartHover.value = null
}

function updateHistoryChartHover(event) {
  const points = historyChartSeries.value.points
  if (!points.length) {
    historyChartHover.value = null
    return
  }
  const rect = event.currentTarget.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 720
  const nearest = points.reduce((best, item) => Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best, points[0])
  historyChartHover.value = {
    ...nearest,
    tooltipX: Math.min(532, Math.max(44, nearest.x + 10)),
    tooltipY: Math.max(28, Math.min(172, Math.min(nearest.onlineY, nearest.danmakuY) - 38)),
    timeText: new Date(nearest.time).toLocaleTimeString(),
  }
}

function applyUiScale() {
  const nextScale = Math.min(150, Math.max(50, Number(uiScalePercent.value) || 100))
  uiScalePercent.value = nextScale
  store.setUiScale(nextScale / 100)
}

function resetUiScale() {
  uiScalePercent.value = 100
  store.setUiScale(1)
}

let sidebarToggleFlashTimer = 0
let sidebarHeartSeq = 0

function updateExtremeNarrowSidebar() {
  isExtremeNarrowSidebar.value = window.innerWidth <= 480
}

function handleSidebarToggle() {
  if (!isExtremeNarrowSidebar.value) {
    store.toggleSidebar()
    return
  }
  sidebarToggleFlash.value = false
  window.clearTimeout(sidebarToggleFlashTimer)
  const heart = {
    id: sidebarHeartSeq++,
    x: Math.round(Math.random() * 18 - 9),
    scale: (0.88 + Math.random() * 0.28).toFixed(2),
  }
  sidebarHearts.value = [...sidebarHearts.value.slice(-5), heart]
  window.requestAnimationFrame(() => {
    sidebarToggleFlash.value = true
    sidebarToggleFlashTimer = window.setTimeout(() => {
      sidebarToggleFlash.value = false
    }, 180)
  })
  window.setTimeout(() => {
    sidebarHearts.value = sidebarHearts.value.filter((item) => item.id !== heart.id)
  }, 760)
}

function replayOverlayPreview() {
  const sample = previewPool[Math.floor(Math.random() * previewPool.length)]
  const newItem = { id: previewItemSeq++, nickname: sample.nickname, content: sample.content }
  previewItems.value = [newItem, ...previewItems.value].slice(0, 3)
}

function avatarInitial(nickname) {
  const text = String(nickname || "A").trim()
  return (text.slice(0, 1) || "A").toUpperCase()
}

function convertPreviewText(text) {
  const value = String(text || "")
  if (!value) return ""
  try {
    return previewConverter.value(value)
  } catch (_) {
    return value
  }
}

async function loadPreviewConverter() {
  const mode = store.overlay.convertChinese
  if (!mode || mode === "none") {
    previewConverter.value = (text) => text
    return
  }
  try {
    if (!window.OpenCC) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script")
        script.src = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js"
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
    }
    const opts = mode === "s2t" ? { from: "cn", to: "twp" } : { from: "twp", to: "cn" }
    previewConverter.value = window.OpenCC.Converter(opts)
  } catch (_) {
    previewConverter.value = (text) => text
  }
}

watch(() => store.overlay.convertChinese, () => loadPreviewConverter(), { immediate: true })
watch(() => store.ui.uiScale, (value) => {
  uiScalePercent.value = Math.round((Number(value) || 1) * 100)
}, { immediate: true })
watch(() => store.ui.theme, (theme) => {
  document.documentElement.dataset.theme = theme
}, { immediate: true })

const obsStatusText = computed(() => {
  if (store.obs.autoStartStatus === "waiting") {
    return "等待流"
  }
  if (store.obs.autoStartStatus === "starting") {
    return "开播中"
  }
  if (store.obs.streaming) {
    return "推流中"
  }
  if (store.obs.connected && store.obs.lastStreamStopped) {
    return "已断流"
  }
  if (store.obs.connected) {
    return "已连接"
  }
  return store.obs.enabled ? "已启用" : "未启用"
})
const overlayPreviewStyle = computed(() => ({
  "--overlay-font-size": `${store.overlay.fontSize}px`,
  "--overlay-font-family": store.overlay.fontFamily,
  "--overlay-name-font-family": overlayFontFamily(store.overlay.nameFontFamily || store.overlay.fontFamily),
  "--overlay-name-font-weight": overlayFontWeight(store.overlay.nameFontFamily || store.overlay.fontFamily, 800),
  "--overlay-content-font-family": overlayFontFamily(store.overlay.contentFontFamily || store.overlay.fontFamily),
  "--overlay-content-font-weight": overlayFontWeight(store.overlay.contentFontFamily || store.overlay.fontFamily, 700),
  "--overlay-text-color": store.overlay.textColor,
  "--overlay-name-color": store.overlay.nameColor,
  "--overlay-bubble-color": store.overlay.bubbleColor,
  "--overlay-rounded": `${store.overlay.rounded}px`,
}))

function parseOverlayFont(font, defaultWeight = "inherit") {
  const value = String(font || "").trim()
  const weights = [
    ["ExtraLight", 200],
    ["UltraLight", 200],
    ["DemiLight", 300],
    ["SemiLight", 300],
    ["Light", 300],
    ["Regular", 400],
    ["Normal", 400],
    ["Medium", 500],
    ["DemiBold", 600],
    ["SemiBold", 600],
    ["Bold", 700],
    ["ExtraBold", 800],
    ["UltraBold", 800],
    ["Heavy", 900],
    ["Black", 900],
    ["EL", 200],
    ["L", 300],
    ["N", 400],
    ["M", 500],
    ["H", 900],
    ["Italic", 400],
    ["特细", 200],
    ["纤细", 200],
    ["细体", 300],
    ["细", 300],
    ["常规", 400],
    ["标准", 400],
    ["中等", 500],
    ["中黑", 500],
    ["半粗", 600],
    ["半黑", 600],
    ["粗体", 700],
    ["粗", 700],
    ["特粗", 800],
    ["特黑", 800],
    ["重", 900],
    ["重黑", 900],
  ]
  for (const [suffix, weight] of weights) {
    const pattern = new RegExp(`\\s+${escapeRegex(suffix)}(?:\\s+Italic)?$`, "i")
    if (pattern.test(value)) {
      const family = splitFontNames(value).map((name) => name.replace(pattern, "").trim() || name).join(" & ")
      return {
        family: fontFamilyCandidates(family, value),
        weight,
      }
    }
  }
  return {
    family: fontFamilyCandidates(value),
    weight: defaultWeight,
  }
}

function overlayFontFamily(font) {
  return parseOverlayFont(font).family
}

function overlayFontWeight(font, defaultWeight) {
  return parseOverlayFont(font, defaultWeight).weight
}

function quoteFontFamily(font) {
  const value = String(font || "").trim()
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(value)) return value
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
}

function fontFamilyCandidates(...fonts) {
  const candidates = []
  for (const font of fonts) {
    for (const name of splitFontNames(font)) {
      candidates.push(name)
      if (/思源宋体|思源宋體|Source Han Serif/i.test(name)) {
        candidates.push("思源宋体", "思源宋體", "Source Han Serif", "Source Han Serif K", "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "serif")
      } else if (/思源等宽|思源等寬|Source Han Mono|Noto Sans Mono CJK|Noto Sans Mono/i.test(name)) {
        candidates.push("思源等宽", "思源等寬", "Source Han Mono", "Source Han Mono K", "Source Han Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono SC", "monospace")
      } else if (/思源黑体|思源黑體|Source Han Sans/i.test(name)) {
        candidates.push("思源黑体", "思源黑體", "Source Han Sans", "Source Han Sans K", "Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "sans-serif")
      }
    }
  }
  return Array.from(new Set(candidates)).map(quoteFontFamily).join(", ")
}

function splitFontNames(font) {
  return String(font || "").split(/\s*&\s*/).map((name) => name.trim()).filter(Boolean)
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const qrImageSrc = computed(() => store.qrLogin.imageData ? `data:image/png;base64,${store.qrLogin.imageData}` : "")
const qrStatusText = computed(() => {
  if (store.qrLogin.status === "waiting") {
    return "正在获取二维码"
  }
  if (store.qrLogin.status === "qrcode") {
    return "请扫码登录"
  }
  if (store.qrLogin.status === "scanned") {
    return "已扫码，请在手机上确认"
  }
  if (store.qrLogin.status === "success") {
    return "二维码登录成功"
  }
  if (store.qrLogin.status === "error") {
    return "二维码登录失败"
  }
  return ""
})
const qrExpireText = computed(() => {
  if (!store.qrLogin.expireTime) {
    return ""
  }
  return `二维码有效期至 ${new Date(store.qrLogin.expireTime).toLocaleTimeString()}`
})

let refreshTimer = 0
let coverPreviewRequest = 0

onMounted(async () => {
  updateExtremeNarrowSidebar()
  window.addEventListener("resize", updateExtremeNarrowSidebar)
  await initializeNativeRuntime()
  store.restoreObsConnection().catch(() => {})
  await store.restoreSession()
  refreshTimer = window.setInterval(() => {
    if (store.isLoggedIn) {
      store.loadRoom()
      store.loadManagerList().catch(() => {})
      store.loadTranscodeInfo().catch(() => {})
    }
  }, 8000)
})

onUnmounted(() => {
  store.rememberObsConnectionForNextLaunch()
  window.clearInterval(refreshTimer)
  window.clearTimeout(sidebarToggleFlashTimer)
  window.removeEventListener("resize", updateExtremeNarrowSidebar)
})

async function initializeNativeRuntime() {
  const [backendPortResult, overlayUrlResult, logPathResult] = await Promise.allSettled([
    getBackendPort(),
    getOverlayBaseUrl(),
    getLogPath(),
  ])
  getSystemFonts().then((fonts) => {
    if (Array.isArray(fonts) && fonts.length) {
      systemFonts.value = fonts
      if (!fonts.includes(store.overlay.fontFamily)) {
        store.overlay.fontFamily = fonts.includes("Microsoft YaHei") ? "Microsoft YaHei" : fonts[0]
        store.persist()
      }
    }
  }).catch(() => {})

  if (backendPortResult.status === "fulfilled" && Number(backendPortResult.value)) {
    const backendUrl = `ws://127.0.0.1:${Number(backendPortResult.value)}/`
    if (shouldUseEmbeddedBackend(store.backendUrl) && store.backendUrl !== backendUrl) {
      store.backendUrl = backendUrl
      store.persist()
      store.log(`已切换到内置后端：${backendUrl}`)
    }
  }

  if (overlayUrlResult.status === "fulfilled") {
    overlayBaseUrl.value = overlayUrlResult.value || ""
  } else {
    store.log(`Overlay URL 初始化失败: ${overlayUrlResult.reason?.message || overlayUrlResult.reason}`)
  }

  if (logPathResult.status === "fulfilled") {
    logPath.value = logPathResult.value || ""
  }
}

function shouldUseEmbeddedBackend(url) {
  try {
    const { hostname } = new URL(url)
    return ["", "localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)
  } catch {
    return true
  }
}

watch(() => store.live.coverFile, (file) => {
  updateCoverPreview(file)
}, { immediate: true })

async function run(task, successMessage = "") {
  try {
    const result = await task()
    if (successMessage) {
      showToast(typeof successMessage === "function" ? successMessage(result) : successMessage)
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    store.lastError = message
    store.log(message)
    showToast(message)
  }
}

function showToast(message) {
  toast.value = message
  window.setTimeout(() => {
    if (toast.value === message) {
      toast.value = ""
    }
  }, 3200)
}

function refreshCurrent() {
  if (store.activeTab === "account") {
    run(() => store.connect(), "连接成功")
  } else if (store.activeTab === "room") {
    run(async () => {
      await store.loadRoom()
      await store.loadWatchingList()
      await store.loadManagerList()
    })
  } else if (store.activeTab === "live") {
    run(async () => {
      await store.loadLiveStatus()
      await store.loadLiveTypes()
      await store.loadPushConfig()
      await store.loadTranscodeInfo()
    })
  } else if (store.activeTab === "stats") {
    run(async () => {
      await store.loadTranscodeInfo()
    })
  }
}

function doLogin() {
  run(() => store.login(loginForm.account, loginForm.password), "登录成功")
}

async function openCover() {
  const file = await openCoverFile()
  if (file) {
    store.setCoverFile(file)
  }
}

function openLiveRoom() {
  if (!store.userId) {
    showToast("当前没有主播 UID")
    return
  }
  const url = `https://live.acfun.cn/live/${store.userId}`
  run(() => openExternalURL(url), "已打开网页直播间")
}

function handleCoverInput() {
  store.setCoverFile(store.live.coverFile)
}

function selectCoverHistory(file) {
  store.setCoverFile(file)
}

function setCoverAspect(value) {
  if (value !== "16:9" && value !== "16:10") {
    return
  }
  store.live.coverAspect = value
  store.persist()
}

function openCoverEditor() {
  if (!store.live.coverFile && !coverPreviewSrc.value) {
    openCover()
    return
  }
  const saved = store.live.coverCrops && store.live.coverCrops[store.live.coverFile]
  if (saved) {
    coverCrop.x = Number(saved.x) || 50
    coverCrop.y = Number(saved.y) || 50
    coverCrop.zoom = Number(saved.zoom) || 1
    if (saved.aspect && saved.aspect !== store.live.coverAspect) {
      store.live.coverAspect = saved.aspect
      store.persist()
    }
  } else {
    coverCrop.x = 50
    coverCrop.y = 50
    coverCrop.zoom = 1
  }
  initialCrop.x = coverCrop.x
  initialCrop.y = coverCrop.y
  initialCrop.zoom = coverCrop.zoom
  initialCrop.aspect = store.live.coverAspect
  cropModalOpen.value = true
}

function closeCropModal() {
  cropModalOpen.value = false
  coverDragging.value = false
}

async function saveAndCloseCover() {
  const ok = await saveCroppedCover()
  if (ok) {
    closeCropModal()
  }
}

function startCoverDrag(event) {
  if (!coverPreviewSrc.value || isGifCover.value || event.button !== 0) {
    return
  }
  event.preventDefault()
  const frame = event.currentTarget
  const rect = frame.getBoundingClientRect()
  if (!rect.width || !rect.height) {
    return
  }
  const startClientX = event.clientX
  const startClientY = event.clientY
  const startX = coverCrop.x
  const startY = coverCrop.y
  coverDragging.value = true

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startClientX
    const dy = moveEvent.clientY - startClientY
    coverCrop.x = clamp(startX - (dx / rect.width) * 100, 0, 100)
    coverCrop.y = clamp(startY - (dy / rect.height) * 100, 0, 100)
  }
  function onUp() {
    coverDragging.value = false
    window.removeEventListener("mousemove", onMove)
    window.removeEventListener("mouseup", onUp)
  }
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onUp)
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

async function updateCoverPreview(file) {
  const requestId = ++coverPreviewRequest
  coverImageReady.value = false
  coverPreviewSrc.value = ""
  const source = await coverPreviewSource(file)
  if (requestId === coverPreviewRequest) {
    coverPreviewSrc.value = source
  }
}

async function coverPreviewSource(file) {
  const text = String(file || "").trim()
  if (!text) {
    return ""
  }
  if (/^(https?:|data:|blob:)/i.test(text)) {
    return text
  }
  try {
    const dataUrl = await readCoverFile(text)
    if (dataUrl) {
      return dataUrl
    }
  } catch (error) {
    store.log(`封面预览读取失败：${error.message || error}`)
  }
  return filePathToUrl(text)
}

const coverThumbCache = reactive({})

async function ensureCoverThumb(file) {
  if (!file || coverThumbCache[file] !== undefined) {
    return
  }
  coverThumbCache[file] = ""
  if (/^(https?:|data:|blob:)/i.test(file)) {
    coverThumbCache[file] = file
    return
  }
  try {
    const dataUrl = await readCoverFile(file)
    coverThumbCache[file] = dataUrl || ""
  } catch {
    coverThumbCache[file] = ""
  }
}

function coverThumbSrc(file) {
  const cached = coverThumbCache[file]
  if (cached === undefined) {
    ensureCoverThumb(file)
    return ""
  }
  return cached || ""
}

function isGifFile(file) {
  return /\.gif(?:$|[?#])/i.test(String(file || ""))
}

function filePathToUrl(file) {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "")
  if (!normalized) {
    return ""
  }
  return `file:///${normalized.split("/").map((part) => encodeURIComponent(part)).join("/")}`
}

function coverName(file) {
  const text = String(file || "")
  const clean = text.split(/[\\/]/).filter(Boolean).pop() || text
  return clean.length > 24 ? `${clean.slice(0, 10)}...${clean.slice(-10)}` : clean
}

function isCropDefault() {
  return coverCrop.x === 50 && coverCrop.y === 50 && coverCrop.zoom === 1
}

function isCropUnchanged() {
  return (
    coverCrop.x === initialCrop.x &&
    coverCrop.y === initialCrop.y &&
    coverCrop.zoom === initialCrop.zoom &&
    store.live.coverAspect === initialCrop.aspect
  )
}

async function saveCroppedCover() {
  let ok = false
  await run(async () => {
    if (isGifCover.value) {
      throw new Error("GIF 封面将按原图上传")
    }
    const file = store.live.coverFile
    if (!file) {
      throw new Error("未选择封面")
    }
    if (isCropUnchanged()) {
      // user didn't move anything since opening — no-op
    } else if (isCropDefault() && store.live.coverAspect === "16:10") {
      store.clearCoverCrop(file)
    } else {
      store.setCoverCrop(file, {
        x: coverCrop.x,
        y: coverCrop.y,
        zoom: coverCrop.zoom,
        aspect: store.live.coverAspect,
      })
    }
    ok = true
  }, "封面已保存")
  return ok
}

async function sendComment() {
  await run(async () => {
    await store.sendComment(commentText.value)
    commentText.value = ""
  }, "弹幕已发送")
}

async function insertAIslandEmote(value, selectEl) {
  const emote = String(value || "")
  if (!emote) return
  const input = commentInputRef.value
  if (!input) {
    commentText.value += emote
    if (selectEl) selectEl.value = ""
    return
  }
  const start = input.selectionStart ?? commentText.value.length
  const end = input.selectionEnd ?? start
  commentText.value = `${commentText.value.slice(0, start)}${emote}${commentText.value.slice(end)}`
  await nextTick()
  input.focus()
  input.setSelectionRange(start + emote.length, start + emote.length)
  if (selectEl) selectEl.value = ""
}

async function startQrLogin() {
  if (qrLoginRunning.value) {
    return
  }
  qrLoginRunning.value = true
  try {
    await run(() => store.loginWithQRCode(), "二维码登录成功")
  } finally {
    qrLoginRunning.value = false
  }
}

async function copy(text) {
  if (!text) {
    return
  }
  await copyText(text)
  showToast("已复制")
}

async function openLogs() {
  try {
    await openLogFolder()
  } catch (error) {
    store.log(`打开日志文件夹失败: ${error.message || error}`)
  }
}

function makeDanmakuOverlayUrl() {
  const base = new URL(overlayBaseUrl.value || "danmaku-overlay.html", window.location.href)
  const params = new URLSearchParams()
  params.set("backendUrl", store.backendUrl)
  params.set("liverUID", store.userId || "")
  params.set("token", encodeBase64Url(store.tokenInfo || {}))
  params.set("style", encodeBase64Url(store.overlay))
  base.search = params.toString()
  return base.href
}

function encodeBase64Url(value) {
  const text = JSON.stringify(value || {})
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function formatTime(value) {
  const date = new Date(Number(value || Date.now()) * 1000)
  return date.toLocaleTimeString()
}

function displayCount(value) {
  return value === undefined || value === null || value === "" ? "-" : value
}

function highlightAcfun(text) {
  return String(text || "")
    .split(/(?<![A-Za-z])(AcFun|ACFun)(?![A-Za-z])/g)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      highlight: /^(AcFun|ACFun)$/.test(part),
    }))
}
</script>
