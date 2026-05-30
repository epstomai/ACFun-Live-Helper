<template>
  <div 
    v-if="floatDanmakuActive" 
    class="float-danmaku-container" 
    :class="[
      `theme-${store.ui.theme}`,
      {
        'is-dragging-window': isDraggingWindow,
        'is-fully-transparent': floatOpacity === 0,
        'is-transparent-readable': store.ui.theme === 'light' && floatOpacity < 60,
        'is-click-through': isClickThrough,
      },
    ]"
    :style="{ 
      backgroundColor: floatOpacity === 0
        ? 'transparent'
        : store.ui.theme === 'light' 
          ? `rgba(255, 250, 250, ${floatOpacity / 100})` 
          : `rgba(18, 12, 16, ${floatOpacity / 100})`,
      zoom: floatScale,
      '--float-scale': floatScale,
    }"
    :data-hotkey-label="clickThroughHotkey.label"
  >
    <div class="float-header-hotspot" style="--wails-draggable: drag;" @mousedown="handleWindowDrag"></div>
    <!-- 悬浮窗头部操作栏（通过 Wails 官方双重保险拖拽机制） -->
    <header class="float-header" style="--wails-draggable: drag;" @mousedown="handleWindowDrag">
      <div class="float-header-left" style="pointer-events: none;">
        <Sparkles :size="13" class="float-pin-icon" />
        <span class="float-title">弹幕窗</span>
        <span class="float-online-badge">
          <span class="online-dot animated-breath"></span>
          {{ store.room.onlineCount }} 在线
        </span>
      </div>
      <div class="float-header-right" style="--wails-draggable: no-drag;">
        <!-- 一键置顶/取消置顶 -->
        <button 
          class="float-action-btn" 
          :class="{ active: isAlwaysOnTop }" 
          :title="isAlwaysOnTop ? '取消置顶' : '窗口置顶'"
          @click="toggleFloatAlwaysOnTop"
        >
          <Pin :size="13" />
        </button>
        <!-- 鼠标穿透模式：用于无边框全屏游戏中防止鼠标被弹幕窗截胡 -->
        <button
          class="float-action-btn"
          :class="{ active: isClickThrough }"
          :title="isClickThrough ? `退出穿透（当前热键 ${clickThroughHotkey.label}）` : '进入鼠标穿透 — 用于无边框全屏游戏'"
          @click="toggleClickThrough"
        >
          <Ghost :size="13" />
        </button>
        <button 
          class="float-action-btn" 
          :class="{ active: floatSettingsMode !== 0 }" 
          :title="floatSettingsMode === 0 ? '显示不透明度设置' : floatSettingsMode === 1 ? '切换至穿透热键设置' : '关闭设置'"
          @click="cycleFloatSettingsMode"
        >
          <SlidersHorizontal v-if="floatSettingsMode <= 1" :size="13" />
          <Ghost v-else :size="13" />
        </button>
        <!-- 一键折叠/展开回复框 -->
        <button 
          class="float-action-btn" 
          :class="{ active: showFloatReply }" 
          :title="showFloatReply ? '隐藏回复框' : '显示回复框'"
          @click="showFloatReply = !showFloatReply"
        >
          <MessageSquare :size="13" />
        </button>
        <!-- 一键关闭窗口 -->
        <button class="float-action-btn close-window" title="关闭悬浮窗" @click="exitFloatDanmakuMode">
          <X :size="13" />
        </button>
      </div>
    </header>

    <!-- 极高辨识度的滚动弹幕区 -->
    <main class="float-body">
      <div class="float-feed-list">
        <div v-for="item in store.room.danmakuList" :key="item.uniqueId" class="float-feed-item" :class="{ self: item.self, gift: item.isGift }">
          <span class="float-feed-nickname">{{ item.nickname }}</span>
          <span class="float-feed-content">{{ item.content }}</span>
          <span v-if="item.isGift" class="float-feed-gift">x{{ item.num }}</span>
        </div>
        <div v-if="!store.room.danmakuList.length" class="float-empty-state">
          等待弹幕中...
        </div>
      </div>
    </main>

    <!-- 底部回复栏 (可一键收起) -->
    <footer v-if="showFloatReply || floatSettingsMode !== 0" class="float-footer">
      <!-- 不透明度科技感滑杆 -->
      <div v-if="floatSettingsMode === 1" class="float-opacity-control">
        <span class="opacity-label">透明度</span>
        <input 
          v-model.number="floatOpacity" 
          type="range" 
          min="0" 
          max="100" 
          step="1" 
          class="opacity-slider"
          :style="{ '--opacity-fill': `${floatOpacity}%` }"
        />
        <span class="opacity-value">{{ floatOpacity }}%</span>
      </div>
      <!-- 穿透热键自定义：极其精简，字体样式与透明度行严格统一 -->
      <div v-if="floatSettingsMode === 2" class="float-hotkey-control">
        <span>穿透热键</span>
        <button
          class="float-hotkey-compact-btn"
          :class="{ capturing: hotkeyCapturing }"
          :title="hotkeyCapturing ? '按下组合键，Esc 取消' : '点击修改鼠标穿透全局热键'"
          @click="startHotkeyCapture"
          @blur="cancelHotkeyCapture"
        >
          <span v-if="hotkeyCapturing">请按下组合键... (Esc 取消)</span>
          <span v-else>{{ clickThroughHotkey.label }}</span>
        </button>
      </div>
      <div v-if="showFloatReply" class="float-reply-box">
        <input 
          v-model="floatCommentText" 
          type="text" 
          placeholder="回复弹幕..." 
          @keyup.enter="sendFloatComment" 
        />
        <button class="float-send-btn" @click="sendFloatComment">
          <Send :size="12" />
        </button>
      </div>
    </footer>
  </div>

  <div
    v-else
    class="app-shell"
    :class="[`theme-${store.ui.theme}`, { 'sidebar-collapsed': store.ui.sidebarCollapsed }]"
    :style="appShellStyle"
  >
    <header class="window-titlebar" style="--wails-draggable: drag;" @mousedown="handleWindowDrag">
      <div class="window-titlebar-brand" style="pointer-events: none;">
        <Sparkles :size="14" />
        <span>AcFun Live Helper</span>
      </div>
      <div class="window-titlebar-controls" style="--wails-draggable: no-drag;">
        <button class="window-control-btn" title="最小化" @click="minimiseWindow">
          <Minus :size="13" />
        </button>
        <button class="window-control-btn" title="最大化 / 还原" @click="toggleMaximiseWindow">
          <Maximize2 :size="12" />
        </button>
        <button class="window-control-btn close" title="关闭" @click="quitWindow">
          <X :size="14" />
        </button>
      </div>
    </header>
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
        <button class="sidebar-float-btn" @click="enterFloatDanmakuMode" title="开启桌面弹幕窗口">
          <Layers :size="13" />
          <span>弹幕窗</span>
        </button>
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
          <button class="icon-button" :title="store.ui.theme === 'dark' ? '要有光！' : '狗眼①瞎(つд⊂)'" @click="store.toggleTheme">
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
        <div class="account-main-column">
          <div class="panel account-panel relative-panel">
            <div class="panel-head">
              <h3>账号</h3>
              <span class="status-dot" :class="{ online: store.isLoggedIn }"></span>
            </div>

            <Transition name="transition-fade-slide" mode="out-in">
              <!-- 已登录视图 -->
              <div v-if="store.isLoggedIn" key="logged-in" class="account-inner-view">
                <div class="account-overview">
                  <div class="avatar avatar-lg">
                    <img v-if="store.userProfile.avatar" :src="store.userProfile.avatar" :alt="store.userName" />
                    <span v-else>{{ userInitial }}</span>
                  </div>
                  <div class="account-main">
                    <strong>{{ store.userName }}</strong>
                    <span>UID {{ store.userId }}</span>
                    <p>{{ store.userProfile.signature || store.userProfile.verifiedText || "已成功登录猴山。" }}</p>
                  </div>
                  <dl class="mini-stats">
                    <div><dt>关注</dt><dd>{{ store.userProfile.followingCount || "-" }}</dd></div>
                    <div><dt>粉丝</dt><dd>{{ store.userProfile.fansCount || "-" }}</dd></div>
                    <div><dt>获赞</dt><dd>{{ store.userProfile.likeCount || "-" }}</dd></div>
                  </dl>
                </div>

                <!-- 录像剪辑权限：开播前 / 关播后可改，直播中只读（A 站后端限制） -->
                <div class="live-cut-row account-live-cut-row">
                  <span class="live-cut-label">录像剪辑权限</span>
                  <label
                    class="checkbox-label live-cut-toggle"
                    :title="store.live.isLive ? '直播中无法修改，关播后再调整' : '勾选后，本次开播的录像允许观众下载剪辑'"
                  >
                    <input
                      type="checkbox"
                      :checked="store.live.liveCutInfo.status"
                      :disabled="liveCutBusy || store.live.isLive"
                      @change="onToggleLiveCut"
                    />
                    <span>允许观众剪辑录像</span>
                    <span v-if="store.live.isLive" class="live-cut-hint">（直播中只读）</span>
                    <span v-else class="live-cut-hint">（仅在未开播时可修改）</span>
                  </label>
                </div>

                <div class="button-row">
                  <button class="command danger" @click="store.logout">
                    <LogOut :size="16" /><span>登出账号</span>
                  </button>
                </div>
              </div>

              <!-- 未登录视图 -->
              <div v-else key="logged-out" class="account-inner-view">
                <div class="account-overview">
                  <div class="avatar avatar-lg">
                    <div class="avatar-placeholder-icon">
                      <User :size="24" />
                    </div>
                  </div>
                  <div class="account-main">
                    <strong>未登录</strong>
                    <span>UID -</span>
                  </div>
                  <dl class="mini-stats">
                    <div><dt>关注</dt><dd>-</dd></div>
                    <div><dt>粉丝</dt><dd>-</dd></div>
                    <div><dt>获赞</dt><dd>-</dd></div>
                  </dl>
                </div>

                <div class="form-grid login-form-stacked">
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
                  <button class="command primary" @click="doLogin">
                    <User :size="16" /><span>账号登录</span>
                  </button>
                  <button class="command" :disabled="qrLoginRunning" @click="startQrLogin">
                    <QrCode :size="16" /><span>{{ qrLoginRunning ? "等待扫码" : "扫码登录" }}</span>
                  </button>
                  <button v-if="store.tokenInfo" class="command" @click="run(() => store.restoreSession(), '会话已恢复')">
                    <RotateCcw :size="16" /><span>恢复会话</span>
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
            </Transition>

            <!-- 高级模糊 Loading 遮罩层 -->
            <Transition name="fade">
              <div v-if="store.progress" class="panel-loading-overlay">
                <div class="loader-spinner"></div>
                <div class="loader-text">{{ store.progress }}</div>
              </div>
            </Transition>
          </div>

          <!-- 今日开播成就卡片 -->
          <div v-if="store.isLoggedIn" class="panel achievements-panel animate-fade-in">
            <div class="panel-head">
              <h3>今日开播成就</h3>
              <span class="achievements-subtitle">Today's Live Stats</span>
            </div>

            <div class="achievements-grid">
              <div class="achievement-card duration-card">
                <div class="achievement-icon-wrapper">
                  <Hourglass :size="20" class="achievement-icon animated-hourglass" />
                </div>
                <div class="achievement-info">
                  <span class="achievement-title">累计时长</span>
                  <span class="achievement-value font-mono">{{ store.formattedLiveDuration }}</span>
                </div>
              </div>

              <div class="achievement-card fans-card">
                <div class="achievement-icon-wrapper">
                  <Sparkles :size="20" class="achievement-icon" />
                </div>
                <div class="achievement-info">
                  <span class="achievement-title">新增粉丝</span>
                  <span class="achievement-value">{{ displayCount(store.room.todayFansAdded) }}</span>
                </div>
              </div>

              <div class="achievement-card banana-card">
                <div class="achievement-icon-wrapper">
                  <Smile :size="20" class="achievement-icon" />
                </div>
                <div class="achievement-info">
                  <span class="achievement-title">收到香蕉</span>
                  <span class="achievement-value">{{ displayCount(store.room.bananaCount) }}</span>
                </div>
              </div>

              <div class="achievement-card diamond-card">
                <div class="achievement-icon-wrapper">
                  <Gem :size="20" class="achievement-icon" />
                </div>
                <div class="achievement-info">
                  <span class="achievement-title">收到钻石</span>
                  <span class="achievement-value">{{ displayCount(store.room.diamondCount) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 守护团列表 -->
          <div
            v-if="store.isLoggedIn"
            class="panel guardian-club-panel animate-fade-in"
            :class="{ 'is-collapsed': !store.ui.guardianClubVisible }"
          >
            <div class="panel-head">
              <div class="guardian-head-main">
                <ShieldCheck :size="18" class="guardian-head-icon" />
                <h3>
                  守护团<span v-if="store.guardianClub.clubName" class="guardian-club-name"> · {{ store.guardianClub.clubName }}</span>
                </h3>
              </div>
              <div class="guardian-head-meta">
                <span v-if="store.guardianClub.medalCount" class="guardian-count">共 <strong>{{ store.guardianClub.medalCount.toLocaleString() }}</strong> 人</span>
                <button
                  class="icon-button"
                  title="刷新守护团列表"
                  :disabled="store.guardianClub.loading || !store.ui.guardianClubVisible"
                  @click="refreshGuardianList"
                >
                  <RefreshCw :size="15" :class="{ 'spin-anim': store.guardianClub.loading }" />
                </button>
                <button
                  class="icon-button"
                  :title="store.ui.guardianClubVisible ? '隐藏守护团列表' : '显示守护团列表'"
                  @click="store.toggleGuardianClubVisible()"
                >
                  <component :is="store.ui.guardianClubVisible ? Eye : EyeOff" :size="15" />
                </button>
              </div>
            </div>

            <div v-if="store.ui.guardianClubVisible && store.guardianClub.rankList.length" class="guardian-list">
              <div
                v-for="g in store.guardianClub.rankList"
                :key="g.userId || g.rank"
                class="guardian-row"
                :class="rankRowClass(g.rank)"
              >
                <div class="guardian-rank" :class="rankBadgeClass(g.rank)">
                  <Crown v-if="g.rank <= 3" :size="13" />
                  <span v-else>{{ g.rank }}</span>
                </div>
                <div class="avatar avatar-sm guardian-avatar">
                  <img v-if="g.avatar" :src="g.avatar" :alt="g.nickname" />
                  <span v-else>{{ guardianInitial(g.nickname) }}</span>
                </div>
                <div class="guardian-info">
                  <span class="guardian-name">{{ g.nickname || "匿名用户" }}</span>
                  <span class="guardian-uid">UID {{ g.userId || "-" }}</span>
                </div>
                <div class="medal-wrapper guardian-medal" :class="medalWrapperLevelClass(g.medalLevel)">
                  <div class="medal">
                    <div class="medal-level"></div>
                    <div class="medal-name">{{ store.guardianClub.clubName || g.clubName || "粉丝" }}</div>
                  </div>
                </div>
                <div class="guardian-intimacy">
                  <Heart :size="11" />
                  <span>{{ (g.intimacy || 0).toLocaleString() }}</span>
                </div>
              </div>
            </div>

            <div v-else-if="store.ui.guardianClubVisible" class="guardian-empty">
              <div class="guardian-empty-icon"><Crown :size="26" /></div>
              <strong>暂无守护团成员</strong>
              <p>主播尚未开通守护团，或当前还没有粉丝加入。</p>
            </div>
          </div>
        </div>

        <div class="account-side-column">
          <div class="panel">
            <div class="panel-head">
              <h3>后端连接</h3>
            </div>
            <label class="block-label">
              <span>Backend WebSocket</span>
              <div class="inline-input">
                <input v-model="store.backendUrl" placeholder="ws://localhost:15368/" @change="store.persist" />
                <button class="command" :disabled="store.connected" @click="run(() => store.connect(), '连接成功')">
                  <component :is="store.connected ? CheckCircle : PlugZap" :size="16" />
                  <span>{{ store.connected ? "已连接" : "连接" }}</span>
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

          <!-- 开播体检看板 -->
          <div class="panel diagnostic-card" :class="{ loading: diagnosticLoading }">
            <div class="panel-head">
              <h3>⚡ 开播体检</h3>
              <button 
                class="icon-button re-diagnostic-btn" 
                :class="{ 'spin-once': diagnosticLoading }"
                title="重新体检" 
                @click="triggerReDiagnostic"
              >
                <RefreshCw :size="15" />
              </button>
            </div>

            <div class="diagnostic-list">
              <!-- 网络延时 -->
              <div class="diagnostic-item">
                <div class="diagnostic-item-left">
                  <div class="diagnostic-icon-wrapper network">
                    <Wifi :size="16" />
                  </div>
                  <div class="diagnostic-info">
                    <span class="diagnostic-label">网络延时</span>
                    <span class="diagnostic-value font-mono">{{ networkLatency === -1 ? '连接失败' : `${networkLatency}ms` }}</span>
                  </div>
                </div>
                <div class="diagnostic-item-right">
                  <span class="diagnostic-status" :class="networkStatus.status">
                    <span class="diagnostic-status-dot animated-breath"></span>
                    {{ networkStatus.text }}
                  </span>
                </div>
              </div>

              <!-- OBS 联动 -->
              <div class="diagnostic-item">
                <div class="diagnostic-item-left">
                  <div class="diagnostic-icon-wrapper obs">
                    <Video :size="16" />
                  </div>
                  <div class="diagnostic-info">
                    <span class="diagnostic-label">OBS 联动</span>
                    <span class="diagnostic-value">{{ store.obs.enabled ? (store.obs.connected ? '已联动' : '未连接') : '未启用' }}</span>
                  </div>
                </div>
                <div class="diagnostic-item-right">
                  <span class="diagnostic-status" :class="obsStatus.status">
                    <span class="diagnostic-status-dot animated-breath"></span>
                    {{ obsStatus.text }}
                  </span>
                  <button 
                    v-if="!store.obs.enabled" 
                    class="quick-fix-btn" 
                    @click="store.activeTab = 'live'"
                  >
                    去开启
                  </button>
                  <button 
                    v-else-if="!store.obs.connected" 
                    class="quick-fix-btn" 
                    @click="store.activeTab = 'live'"
                  >
                    去连接
                  </button>
                </div>
              </div>

              <!-- 系统资源 -->
              <div class="diagnostic-item">
                <div class="diagnostic-item-left">
                  <div class="diagnostic-icon-wrapper resources">
                    <Activity :size="16" />
                  </div>
                  <div class="diagnostic-info">
                    <span class="diagnostic-label">系统资源</span>
                    <span class="diagnostic-value">CPU / 内存</span>
                  </div>
                </div>
                <div class="diagnostic-item-right">
                  <span class="diagnostic-status" :class="resourcesStatus.status">
                    <span class="diagnostic-status-dot animated-breath"></span>
                    {{ resourcesStatus.text }}
                  </span>
                </div>
              </div>
            </div>

            <div class="diagnostic-summary">
              <span v-if="networkStatus.status === 'success' && resourcesStatus.status === 'success' && (obsStatus.status === 'success' || obsStatus.status === 'info' || obsStatus.status === 'warning')" class="success-tip text-green">
                <CheckCircle :size="14" /> 状态极佳，准备妥当！开播吧！
              </span>
              <span v-else-if="networkStatus.status === 'danger' || resourcesStatus.status === 'danger' || obsStatus.status === 'danger'" class="warning-tip text-red">
                <XCircle :size="14" /> 检测到部分项异常，可能会影响开播。
              </span>
              <span v-else-if="resourcesStatus.status === 'warning'" class="warning-tip text-orange">
                <AlertTriangle :size="14" /> 系统资源占用偏高，建议关闭高占用程序或降低推流参数。
              </span>
              <span v-else-if="networkStatus.status === 'warning'" class="warning-tip text-orange">
                <AlertTriangle :size="14" /> 网络延时一般，建议检查网络状态。
              </span>
              <span v-else class="warning-tip text-orange">
                <AlertTriangle :size="14" /> 有警告项，请根据上方状态调整后再开播。
              </span>
            </div>
          </div>
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

          <!-- 直播录像剪辑：直播中显示一行
               - 状态徽标对应 GET_LIVE_CUT_STATUS（是否允许观众剪辑本次录像），仅展示
                 想修改请到「账号」页（A 站后端不允许直播中改）
               - 右侧按钮对应 GET_LIVE_CUT_INFO 返回的 url / redirectURL，仅在拿到时可点击 -->
          <div v-if="store.live.isLive" class="live-cut-row">
            <span class="live-cut-label">本场录像</span>
            <span
              class="live-cut-status"
              :class="{ on: store.live.liveCutInfo.status, off: !store.live.liveCutInfo.status }"
              title="直播中无法修改剪辑权限，请到「账号」页在未开播时调整"
            >
              <span class="dot"></span>
              {{ store.live.liveCutInfo.status ? "允许观众剪辑" : "仅主播可剪辑" }}
            </span>
            <button
              class="text-button"
              :disabled="!store.live.liveCutInfo.redirectURL && !store.live.liveCutInfo.url"
              @click="openLiveCut"
            >
              <Scissors :size="14" /><span>打开剪辑页</span>
            </button>
            <button
              class="text-button"
              :disabled="!store.live.liveCutInfo.url"
              @click="copy(store.live.liveCutInfo.url)"
            >
              <Clipboard :size="14" /><span>复制原始链接</span>
            </button>
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
            <button v-if="store.obs.connected" class="command" @click="run(() => store.disconnectObs(), 'OBS 已断开')">
              <Unplug :size="16" /><span>断开</span>
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
            <div><strong>{{ displayCount(store.room.diamondCount) }}</strong><span>钻石</span></div>
            <div><strong>{{ displayCount(store.room.bananaCount) }}</strong><span>香蕉</span></div>
          </div>
          <div class="danmaku-compose">
            <div class="danmaku-input-row">
              <input ref="commentInputRef" v-model="commentText" placeholder="发送弹幕" @keyup.enter="sendComment" />
              <select class="a-island-emote-select" value="" title="插入颜文字" @change="insertAIslandEmote($event.target.value, $event.target)">
                <option value="" disabled>( ﾟ∀。)</option>
                <option v-for="(item, index) in aIslandEmotes" :key="`${index}-${item}`" :value="item">{{ item }}</option>
              </select>
              <button class="command primary" @click="sendComment"><Send :size="16" /><span>发送</span></button>
            </div>
            <div class="danmaku-actions-row">
              <button class="command" @click="run(() => store.loadRoom())"><RefreshCw :size="16" /><span>刷新</span></button>
              <button class="command" @click="run(() => store.startDanmu({ restart: true }))"><Radio :size="16" /><span>重连</span></button>
              <button class="command" @click="store.room.danmakuList = []"><Trash2 :size="16" /><span>清空</span></button>
            </div>
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
            <div class="row-actions">
              <button class="text-button" @click="run(() => store.loadManagerList())">刷新</button>
              <button class="text-button" @click="showAddManagerInput = !showAddManagerInput">
                <ShieldPlus :size="14" style="margin-right: 2px; vertical-align: middle;" />添加
              </button>
            </div>
          </div>
          <Transition name="fade-slide">
            <div v-if="showAddManagerInput" class="inline-add-manager" style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); background: var(--bg-hover);">
              <div class="inline-input">
                <input v-model="addManagerUid" type="text" placeholder="输入房管 UID" @keyup.enter="doAddManagerByUid" style="height: 32px; font-size: 13px;" />
                <button class="command primary" :disabled="!addManagerUid" @click="doAddManagerByUid" style="height: 32px; padding: 0 12px; font-size: 13px;">
                  <ShieldPlus :size="14" /><span>添加</span>
                </button>
              </div>
            </div>
          </Transition>
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
          <div class="overlay-section-row">
            <section class="overlay-section">
              <h4 class="overlay-section-title">画布</h4>
              <div class="overlay-control-grid">
                <label><span>宽度</span><input v-model.number="store.overlay.width" type="number" min="240" max="1920" @change="store.persist" /></label>
                <label><span>高度</span><input v-model.number="store.overlay.height" type="number" min="240" max="1080" @change="store.persist" /></label>
                <label><span>显示数</span><input v-model.number="store.overlay.maxItems" type="number" min="4" max="80" @change="store.persist" /></label>
                <label><span>整体缩放 %</span>
                  <input
                    type="number"
                    min="50"
                    max="200"
                    step="5"
                    :value="Math.round(store.overlay.scale * 100)"
                    @change="onOverlayScaleChange"
                  />
                </label>
              </div>
            </section>

            <section class="overlay-section">
              <h4 class="overlay-section-title">气泡</h4>
              <div class="overlay-control-grid">
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
            </section>
          </div>

          <div class="overlay-section-row">
            <section class="overlay-section">
              <h4 class="overlay-section-title">文本</h4>
              <div class="overlay-control-grid cols-2">
                <label><span>用户名字体</span>
                  <SearchableSelect
                    v-model="store.overlay.nameFontFamily"
                    :options="systemFonts"
                    placeholder="选择字体"
                    search-placeholder="搜索字体"
                    @change="store.persist"
                  />
                </label>
                <label><span>内容字体</span>
                  <SearchableSelect
                    v-model="store.overlay.contentFontFamily"
                    :options="systemFonts"
                    placeholder="选择字体"
                    search-placeholder="搜索字体"
                    @change="store.persist"
                  />
                </label>
              </div>
              <div class="overlay-control-grid">
                <label><span>简繁转换</span>
                  <select v-model="store.overlay.convertChinese" @change="store.persist">
                    <option value="none">不转换</option>
                    <option value="s2t">转繁体</option>
                    <option value="t2s">转简体</option>
                  </select>
                </label>
              </div>
            </section>

            <section class="overlay-section">
              <h4 class="overlay-section-title">颜色</h4>
              <div class="overlay-control-grid cols-3">
                <label><span>文字色</span>
                  <HsvColorPicker v-model="store.overlay.textColor" alpha @update:modelValue="store.persist" />
                </label>
                <label><span>昵称色</span>
                  <HsvColorPicker v-model="store.overlay.nameColor" alpha @update:modelValue="store.persist" />
                </label>
                <label><span>气泡色</span>
                  <HsvColorPicker v-model="store.overlay.bubbleColor" alpha @update:modelValue="store.persist" />
                </label>
              </div>
            </section>
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

        <div class="panel tts-panel" :class="{ 'panel-online': ttsSettings.enabled }">
          <div class="panel-head">
            <h3>语音播报 (TTS)</h3>
            <span>{{ ttsSettings.enabled ? '已开启' : '已关闭' }}</span>
          </div>
          <div class="toggle-row" style="margin-top: 10px;">
            <label class="checkbox-label">
              <input v-model="ttsSettings.enabled" type="checkbox" @change="!ttsSettings.enabled && stopAll()" />
              <span>启用全局播报</span>
            </label>
          </div>

          <!-- === 菜单 1：语言代码选择 === -->
          <div v-if="ttsSettings.enabled" class="form-grid" style="margin-top: 10px; margin-bottom: 5px;">
            <label style="grid-column: span 2;">
              <span>1. 语言代码选择 (lang)</span>
              <select v-model="ttsSettings.selectedLang" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-hover); color: inherit; font-size: 14px; margin-top: 5px; font-family: monospace; outline: none;">
                <option v-for="lang in uniqueLangs" :key="lang" :value="lang" style="background: var(--bg-hover); color: inherit;">
                  {{ lang }}
                </option>
                <option v-if="uniqueLangs.length === 0" value="" style="background: var(--bg-hover); color: inherit;">
                  未检测到系统中文代码
                </option>
              </select>
            </label>
          </div>

          <!-- === 菜单 2：具体声音选择 === -->
          <div v-if="ttsSettings.enabled" class="form-grid" style="margin-top: 5px; margin-bottom: 10px;">
            <label style="grid-column: span 2;">
              <span>2. 音色选择 (Voice)</span>
              <select v-model="ttsSettings.selectedVoiceName" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-hover); color: inherit; font-size: 14px; margin-top: 5px; outline: none;">
                <option v-for="voice in filteredVoices" :key="voice.name" :value="voice.name" style="background: var(--bg-hover); color: inherit;">
                  {{ voice.name }}
                </option>
                <option v-if="filteredVoices.length === 0" value="" style="background: var(--bg-hover); color: inherit;">
                  当前代码下无可用音色
                </option>
              </select>
            </label>
          </div>

          <div v-if="ttsSettings.enabled" class="toggle-row" style="border-top: 1px solid #f0f0f0; padding-top: 10px; margin-top: 10px;">
            <label class="checkbox-label" title="播报普通观众的文字弹幕">
              <input v-model="ttsSettings.readDanmaku" type="checkbox" />
              <span>播报弹幕</span>
            </label>
            <label class="checkbox-label" title="播报送礼、投香蕉信息">
              <input v-model="ttsSettings.readGift" type="checkbox" />
              <span>播报送礼</span>
            </label>
            <label class="checkbox-label" title="播报关注主播的信息">
              <input v-model="ttsSettings.readFollow" type="checkbox" />
              <span>播报关注</span>
            </label>
            <label class="checkbox-label" title="播报进入直播间（人多时不建议开启）">
              <input v-model="ttsSettings.readJoinRoom" type="checkbox" />
              <span>播报进入</span>
            </label>
          </div>

          <div v-if="ttsSettings.enabled" class="form-grid" style="margin-top: 10px;">
            <label>
              <span>语速 ({{ ttsSettings.rate }})</span>
              <input v-model.number="ttsSettings.rate" type="range" min="0.5" max="2.5" step="0.1" />
            </label>
            <label>
              <span>音量 ({{ ttsSettings.volume }})</span>
              <input v-model.number="ttsSettings.volume" type="range" min="0" max="1" step="0.1" />
            </label>
            <label>
              <span>音调 ({{ ttsSettings.pitch }})</span>
              <input v-model.number="ttsSettings.pitch" type="range" min="0.1" max="2.0" step="0.1" />
            </label>
          </div>

          <div v-if="ttsSettings.enabled" class="cover-panel-actions" style="margin-top: 10px; display: flex; gap: 10px;">
            <button class="command" @click="speak('Test, test! 收到我的信号了吗？哼啊啊啊啊啊')" style="background: #28a745; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">
              <span>语音测试</span>
            </button>
            <button class="command" @click="stopAll" style="background: #dc3545; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">
              <span>一键静音</span>
            </button>
          </div>
        </div>

      </section>

      <!-- 数据 -->
      <section v-if="store.activeTab === 'stats'" class="stats-page-grid">
        <div class="panel">
          <div class="panel-head">
            <h3>本场直播</h3>
            <span>{{ store.summary.endedAt ? "已生成" : "关播后显示" }}</span>
          </div>
          <!-- 显示条件用 endedAt：startLive 阶段就有 summary.liveId，但只有关播后才会有 endedAt，
               避免在直播中显示一份只有 LiveID + 00:00:00 的"伪总结"。 -->
          <dl v-if="store.summary.endedAt" class="summary-list">
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
                <button
                  class="small-icon"
                  :title="item.playback?.url || item.playback?.backupURL ? '打开回放' : '查询并打开回放'"
                  :disabled="playbackBusy[item.liveId]"
                  @click="openPlayback(item)"
                >
                  <PlayCircle :size="14" />
                </button>
                <button
                  class="small-icon"
                  :title="downloadBusy[item.liveId] ? '正在下载…' : '下载本场录播'"
                  :disabled="downloadBusy[item.liveId] || playbackBusy[item.liveId]"
                  @click="downloadPlayback(item)"
                >
                  <Download :size="14" />
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
                    @click.stop="removeCoverHistory(item)"
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
              <defs>
                <!-- 观众数渐变面积填充 -->
                <linearGradient id="onlineAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.00" />
                </linearGradient>
                <!-- 弹幕数渐变面积填充 -->
                <linearGradient id="danmakuAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--success)" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="var(--success)" stop-opacity="0.00" />
                </linearGradient>
              </defs>

              <g class="history-chart-grid">
                <line v-for="y in historyChartGridY" :key="y" x1="40" :y1="y" x2="700" :y2="y" />
              </g>

              <!-- 渐变底面填充 -->
              <path class="history-chart-area online" :d="historyChartSeries.onlineArea" fill="url(#onlineAreaGrad)" />
              <path class="history-chart-area danmaku" :d="historyChartSeries.danmakuArea" fill="url(#danmakuAreaGrad)" />

              <!-- 贝塞尔三次平滑曲线 -->
              <path class="history-chart-path online" :d="historyChartSeries.onlinePath" />
              <path class="history-chart-path danmaku" :d="historyChartSeries.danmakuPath" />

              <g class="history-chart-axis">
                <line x1="40" y1="220" x2="700" y2="220" />
                <line x1="40" y1="24" x2="40" y2="220" />
              </g>
              <g v-if="historyChartHover" class="history-chart-hover">
                <line :x1="historyChartHover.x" y1="24" :x2="historyChartHover.x" y2="220" />
                <circle :cx="historyChartHover.x" :cy="historyChartHover.onlineY" r="5" class="online" />
                <circle :cx="historyChartHover.x" :cy="historyChartHover.danmakuY" r="5" class="danmaku" />
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
              <span class="online"><i class="online"></i>观众数</span>
              <span class="danmaku"><i class="danmaku"></i>{{ historyDanmakuChartText }}{{ historyDanmakuChartUnit }}</span>
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

  <!-- 缩放比例 HUD（Teleport 到 body 避免被悬浮容器的 zoom 二次缩放；放在末尾不打断 v-if/v-else 相邻） -->
  <Teleport to="body">
    <transition name="float-scale-hud-fade">
      <div
        v-if="floatDanmakuActive && showFloatScaleHud"
        :class="['float-scale-hud', `theme-${store.ui.theme}`]"
      >
        {{ Math.round(floatScale * 100) }}%
      </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { ttsSettings, stopAll, uniqueLangs, filteredVoices, speak } from "@/services/tts";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import {
  Activity,
  Ban,
  ChartBar,
  Clipboard,
  Download,
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
  Maximize2,
  Minus,
  Moon,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  PlayCircle,
  PlugZap,
  Unplug,
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
  Hourglass,
  Sparkles,
  Smile,
  Gem,
  Crown,
  ShieldCheck,
  Wifi,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Pin,
  Ghost,
  Layers,
  MessageSquare,
  SlidersHorizontal,
} from "@lucide/vue"
import { useLiveStore } from "@/stores/liveStore"
import HsvColorPicker from "@/components/HsvColorPicker.vue"
import SearchableSelect from "@/components/SearchableSelect.vue"
import { previewPool, aIslandEmotes } from "@/assets/previewData.js"
import {
  copyText,
  getBackendPort,
  getLogPath,
  getOverlayBaseUrl,
  broadcastOverlayStyle,
  downloadPlaybackToFile,
  getSystemFonts,
  openCoverFile,
  openExternalURL,
  openLogFolder,
  readCoverFile,
  saveCoverImage,
  getSystemStats,
  getNetworkDelay,
  setAlwaysOnTop,
  setWindowSize,
  isMiniMode,
  launchMiniWindow,
  setSharedTheme,
  getSharedTheme,
  setSharedFloatState,
  getSharedFloatState,
  setMouseClickThrough,
  setMouseClickThroughHotkey,
  onClickThroughToggle,
} from "@/services/nativeBridge"

const store = useLiveStore()

// === 悬浮置顶弹幕窗状态与操作 ===
const FLOAT_OPACITY_STORAGE_KEY = "aclivehelper.floatDanmaku.opacity"
const FLOAT_SCALE_STORAGE_KEY = "aclivehelper.floatDanmaku.scale"
const FLOAT_BASE_WIDTH = 360
const FLOAT_BASE_HEIGHT = 580
const FLOAT_MIN_SCALE = 0.7
const FLOAT_MAX_SCALE = 2.0
const FLOAT_SCALE_STEP = 0.1
const floatDanmakuActive = ref(false)
const showFloatReply = ref(true)
const floatSettingsMode = ref(1) // 0: 隐藏, 1: 不透明度设置, 2: 穿透热键设置
function cycleFloatSettingsMode() {
  if (floatSettingsMode.value === 0) {
    floatSettingsMode.value = 1
  } else if (floatSettingsMode.value === 1) {
    floatSettingsMode.value = 2
  } else {
    floatSettingsMode.value = 0
  }
}
const floatCommentText = ref("")
const savedFloatOpacity = Number(localStorage.getItem(FLOAT_OPACITY_STORAGE_KEY))
const floatOpacity = ref(Number.isFinite(savedFloatOpacity) ? Math.min(100, Math.max(0, savedFloatOpacity)) : 72)
// 一次性迁移：早期版本 immediate watch 把 Number(null)=0 clamp 到 0.7 写入存储，导致默认值被污染
const FLOAT_SCALE_MIGRATION_KEY = "aclivehelper.floatDanmaku.scale.migrated"
if (!localStorage.getItem(FLOAT_SCALE_MIGRATION_KEY)) {
  if (localStorage.getItem(FLOAT_SCALE_STORAGE_KEY) === "0.7") {
    localStorage.removeItem(FLOAT_SCALE_STORAGE_KEY)
  }
  localStorage.setItem(FLOAT_SCALE_MIGRATION_KEY, "1")
}
const savedFloatScale = parseFloat(localStorage.getItem(FLOAT_SCALE_STORAGE_KEY) ?? "")
const floatScale = ref(
  Number.isFinite(savedFloatScale)
    ? Math.min(FLOAT_MAX_SCALE, Math.max(FLOAT_MIN_SCALE, savedFloatScale))
    : 1,
)
const isAlwaysOnTop = ref(true)
const isMiniWindowProcess = ref(false)
const isDraggingWindow = ref(false)
const floatDanmuStarted = ref(false)

watch(floatOpacity, (value) => {
  const opacity = Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Number(value))) : 72
  if (opacity !== value) {
    floatOpacity.value = opacity
    return
  }
  localStorage.setItem(FLOAT_OPACITY_STORAGE_KEY, String(opacity))
}, { immediate: true })

function setFloatScale(value) {
  const raw = Number(value)
  const safe = Number.isFinite(raw) ? raw : 1
  const next = Math.round(Math.min(FLOAT_MAX_SCALE, Math.max(FLOAT_MIN_SCALE, safe)) * 100) / 100
  floatScale.value = next
}

let floatScaleResizeRaf = 0
const showFloatScaleHud = ref(false)
let floatScaleHudTimer = 0
watch(floatScale, (value) => {
  localStorage.setItem(FLOAT_SCALE_STORAGE_KEY, String(value))
  if (floatDanmakuActive.value) {
    showFloatScaleHud.value = true
    if (floatScaleHudTimer) clearTimeout(floatScaleHudTimer)
    floatScaleHudTimer = window.setTimeout(() => {
      showFloatScaleHud.value = false
    }, 1200)
  }
  if (!floatDanmakuActive.value || !isMiniWindowProcess.value) return
  if (floatScaleResizeRaf) cancelAnimationFrame(floatScaleResizeRaf)
  floatScaleResizeRaf = requestAnimationFrame(() => {
    floatScaleResizeRaf = 0
    setWindowSize(
      Math.round(FLOAT_BASE_WIDTH * floatScale.value),
      Math.round(FLOAT_BASE_HEIGHT * floatScale.value),
    ).catch(() => {})
  })
})

function handleFloatWheel(e) {
  if (!floatDanmakuActive.value) return
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const direction = e.deltaY < 0 ? 1 : -1
  setFloatScale(floatScale.value + direction * FLOAT_SCALE_STEP)
}

function handleFloatScaleShortcut(e) {
  if (!floatDanmakuActive.value) return
  if (!e.ctrlKey && !e.metaKey) return
  if (e.key === "0") {
    e.preventDefault()
    setFloatScale(1)
  } else if (e.key === "=" || e.key === "+") {
    e.preventDefault()
    setFloatScale(floatScale.value + FLOAT_SCALE_STEP)
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault()
    setFloatScale(floatScale.value - FLOAT_SCALE_STEP)
  }
}

// Ctrl + 鼠标中键拖拽：无极缩放（每像素 0.005，上滑放大下滑缩小）
const FLOAT_DRAG_SCALE_SENSITIVITY = 0.005
let floatDragScaleState = null

function handleFloatMouseDown(e) {
  if (!floatDanmakuActive.value) return
  if (e.button !== 1) return
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  e.stopPropagation()
  floatDragScaleState = { startY: e.clientY, startScale: floatScale.value }
  document.body.style.cursor = "ns-resize"
}

function handleFloatMouseMove(e) {
  if (!floatDragScaleState) return
  e.preventDefault()
  const dy = floatDragScaleState.startY - e.clientY
  setFloatScale(floatDragScaleState.startScale + dy * FLOAT_DRAG_SCALE_SENSITIVITY)
}

function handleFloatMouseUp(e) {
  if (!floatDragScaleState) return
  if (e && e.button !== 1 && e.type !== "mouseleave" && e.type !== "blur") return
  floatDragScaleState = null
  document.body.style.cursor = ""
}

async function toggleFloatAlwaysOnTop() {
  try {
    const nextState = !isAlwaysOnTop.value
    await setAlwaysOnTop(nextState)
    isAlwaysOnTop.value = nextState
    showToast(nextState ? "窗口已置顶" : "已取消置顶")
  } catch (err) {
    console.error("切换置顶失败:", err)
  }
}

// 鼠标穿透模式（用于无边框全屏游戏中避免鼠标被弹幕窗截胡）
const FLOAT_CLICK_THROUGH_KEY = "aclivehelper.floatDanmaku.clickThrough"
const FLOAT_HOTKEY_KEY = "aclivehelper.floatDanmaku.clickThroughHotkey"
// Windows MOD_* 位掩码：与后端 modAlt/modCtrl/modShift/modWin 对应
const HK_MOD_ALT = 1
const HK_MOD_CTRL = 2
const HK_MOD_SHIFT = 4
const HK_MOD_WIN = 8
// 默认 Ctrl+Alt+Shift+G
const DEFAULT_HOTKEY = { mods: HK_MOD_CTRL | HK_MOD_ALT | HK_MOD_SHIFT, vk: 0x47, label: "Ctrl+Alt+Shift+G" }

const isClickThrough = ref(false)
const clickThroughHotkey = ref(loadHotkey())
const hotkeyCapturing = ref(false)

function loadHotkey() {
  try {
    const raw = localStorage.getItem(FLOAT_HOTKEY_KEY)
    if (!raw) return { ...DEFAULT_HOTKEY }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.mods === "number" && typeof parsed.vk === "number" && parsed.vk > 0) {
      return { mods: parsed.mods, vk: parsed.vk, label: hotkeyLabel(parsed.mods, parsed.vk) }
    }
  } catch {}
  return { ...DEFAULT_HOTKEY }
}
function hotkeyLabel(mods, vk) {
  const parts = []
  if (mods & HK_MOD_CTRL) parts.push("Ctrl")
  if (mods & HK_MOD_ALT) parts.push("Alt")
  if (mods & HK_MOD_SHIFT) parts.push("Shift")
  if (mods & HK_MOD_WIN) parts.push("Win")
  parts.push(vkToLabel(vk))
  return parts.join("+")
}
function vkToLabel(vk) {
  if (vk >= 0x41 && vk <= 0x5A) return String.fromCharCode(vk)              // A-Z
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk)              // 0-9
  if (vk >= 0x70 && vk <= 0x7B) return "F" + (vk - 0x70 + 1)                // F1-F12
  return "?"
}
// 把 KeyboardEvent.code 映射成 Windows VK code；不支持时返回 0
function codeToVK(code) {
  if (typeof code !== "string") return 0
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3)                    // KeyG -> 0x47
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5)                  // Digit1 -> 0x31
  const m = code.match(/^F([1-9]|1[0-2])$/)
  if (m) return 0x70 + parseInt(m[1], 10) - 1                               // F1-F12
  return 0
}

async function setClickThroughMode(enable) {
  const next = Boolean(enable)
  try {
    await setMouseClickThrough(next)
    isClickThrough.value = next
    localStorage.setItem(FLOAT_CLICK_THROUGH_KEY, next ? "1" : "0")
    showToast(next ? `已进入穿透模式 — ${clickThroughHotkey.value.label} 退出` : "已退出穿透模式")
  } catch (err) {
    console.error("切换鼠标穿透失败:", err)
    showToast("切换穿透失败")
  }
}
function toggleClickThrough() {
  setClickThroughMode(!isClickThrough.value)
}

// 启动捕获模式：在按钮聚焦后下一次按下"组合键"被捕获并保存
function startHotkeyCapture() {
  hotkeyCapturing.value = true
}
function cancelHotkeyCapture() {
  hotkeyCapturing.value = false
}
async function handleHotkeyCapture(e) {
  if (!hotkeyCapturing.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === "Escape") {
    cancelHotkeyCapture()
    showToast("已取消修改")
    return
  }
  const vk = codeToVK(e.code)
  if (vk === 0) return // 仅修饰键或不支持的键，等下一次按下
  let mods = 0
  if (e.ctrlKey) mods |= HK_MOD_CTRL
  if (e.altKey) mods |= HK_MOD_ALT
  if (e.shiftKey) mods |= HK_MOD_SHIFT
  if (e.metaKey) mods |= HK_MOD_WIN
  if (mods === 0) {
    showToast("请至少加一个修饰键（Ctrl / Alt / Shift / Win）")
    return
  }
  try {
    await setMouseClickThroughHotkey(mods, vk)
    const label = hotkeyLabel(mods, vk)
    clickThroughHotkey.value = { mods, vk, label }
    localStorage.setItem(FLOAT_HOTKEY_KEY, JSON.stringify({ mods, vk }))
    showToast(`穿透热键已设为 ${label}`)
  } catch (err) {
    console.error("设置热键失败:", err)
    showToast("设置热键失败，可能与系统/其他程序冲突")
  } finally {
    hotkeyCapturing.value = false
  }
}

watch(floatDanmakuActive, (val) => {
  if (val) {
    document.documentElement.classList.add("is-float-window")
  } else {
    document.documentElement.classList.remove("is-float-window")
  }
}, { immediate: true })

async function enterFloatDanmakuMode() {
  try {
    await launchMiniWindow()
    showToast("已拉起独立的置顶悬浮弹幕窗！")
  } catch (err) {
    console.error("启动悬浮窗口进程失败:", err)
    showToast("拉起悬浮窗失败")
  }
}

async function exitFloatDanmakuMode() {
  try {
    const mini = await isMiniMode()
    if (mini) {
      window.runtime.Quit()
    } else {
      floatDanmakuActive.value = false
      await setAlwaysOnTop(false)
      await setWindowSize(1024, 720)
    }
  } catch (err) {
    console.error("退出悬浮窗失败:", err)
  }
}

async function sendFloatComment() {
  const comment = floatCommentText.value.trim()
  if (!comment) return
  await syncFloatRuntimeState()
  await run(async () => {
    await store.ensureBackendToken()
    await store.sendComment(comment)
    floatCommentText.value = ""
  }, "弹幕已发送")
}

function buildFloatRuntimeState() {
  return {
    backendUrl: store.backendUrl,
    tokenInfo: store.tokenInfo,
    userId: store.userId,
    userName: store.userName,
    userProfile: store.userProfile,
    liveId: store.room.liveId || store.live.liveId,
    roomIsLive: store.room.isLive,
    liveIsLive: store.live.isLive,
    onlineCount: store.room.onlineCount,
    danmakuList: store.room.danmakuList.slice(0, 300),
    updatedAt: Date.now(),
  }
}

function applyFloatRuntimeState(state) {
  if (!state || typeof state !== "object") {
    return
  }
  if (state.backendUrl) {
    store.backendUrl = state.backendUrl
  }
  if (state.tokenInfo) {
    store.tokenInfo = state.tokenInfo
  }
  if (state.userId) {
    store.userId = String(state.userId)
  }
  if (state.userName) {
    store.userName = state.userName
  }
  if (state.userProfile && typeof state.userProfile === "object") {
    store.userProfile = state.userProfile
  }
  if (state.liveId) {
    store.room.liveId = state.liveId
    store.live.liveId = state.liveId
  }
  store.room.isLive = Boolean(state.roomIsLive || state.liveIsLive || state.liveId)
  store.live.isLive = Boolean(state.liveIsLive || state.roomIsLive || state.liveId)
  if (Number.isFinite(Number(state.onlineCount))) {
    store.room.onlineCount = Number(state.onlineCount)
  }
  if (Array.isArray(state.danmakuList)) {
    store.room.danmakuList = state.danmakuList
  }
}

async function publishFloatRuntimeState() {
  if (isMiniWindowProcess.value) {
    return
  }
  try {
    await setSharedFloatState(JSON.stringify(buildFloatRuntimeState()))
  } catch {
  }
}

async function syncFloatRuntimeState() {
  if (!isMiniWindowProcess.value) {
    return
  }
  try {
    const payload = await getSharedFloatState()
    if (!payload) {
      return
    }
    applyFloatRuntimeState(JSON.parse(payload))
    await ensureFloatDanmuStarted()
  } catch {
  }
}

async function ensureFloatDanmuStarted() {
  if (!isMiniWindowProcess.value || floatDanmuStarted.value || !store.userId || !store.tokenInfo) {
    return
  }
  try {
    await store.ensureBackendToken()
    await store.startDanmu()
    floatDanmuStarted.value = true
  } catch (error) {
    console.error("悬浮窗弹幕监听启动失败:", error)
  }
}

function handleWindowDrag(event) {
  if (event.target.closest('button') || event.target.closest('.float-header-right')) return
  if (window.runtime && window.runtime.WindowDrag) {
    isDraggingWindow.value = true
    const stopDragging = () => {
      window.setTimeout(() => {
        isDraggingWindow.value = false
      }, 220)
      window.removeEventListener("mouseup", stopDragging)
    }
    window.addEventListener("mouseup", stopDragging, { once: true })
    window.runtime.WindowDrag()
  }
}

function minimiseWindow() {
  if (window.runtime && window.runtime.WindowMinimise) {
    window.runtime.WindowMinimise()
  }
}

function toggleMaximiseWindow() {
  if (window.runtime && window.runtime.WindowToggleMaximise) {
    window.runtime.WindowToggleMaximise()
  }
}

function quitWindow() {
  if (window.runtime && window.runtime.Quit) {
    window.runtime.Quit()
  }
}

// === 开播体检响应式状态 ===
const diagnosticLoading = ref(false)
const diagnosticRunCount = ref(0)
const systemCpu = ref(0)
const systemMemory = ref(0)
const networkLatency = ref(-1)

// 计算延迟评级
const networkStatus = computed(() => {
  if (networkLatency.value === -1) {
    return { status: "danger", text: "测试失败" }
  }
  if (networkLatency.value < 50) {
    return { status: "success", text: `${networkLatency.value}ms (极佳)` }
  }
  if (networkLatency.value < 120) {
    return { status: "warning", text: `${networkLatency.value}ms (一般)` }
  }
  return { status: "danger", text: `${networkLatency.value}ms (卡顿)` }
})

// 计算系统资源评级
const resourcesStatus = computed(() => {
  const cpu = systemCpu.value
  const mem = systemMemory.value
  if (cpu >= 90 || mem >= 90) {
    return { status: "danger", text: `极高风险 (CPU ${Math.round(cpu)}% · 内存 ${Math.round(mem)}%)` }
  }
  if (cpu >= 70 || mem >= 80) {
    return { status: "warning", text: `偏高 (CPU ${Math.round(cpu)}% · 内存 ${Math.round(mem)}%)` }
  }
  return { status: "success", text: `充足 (CPU ${Math.round(cpu)}% · 内存 ${Math.round(mem)}%)` }
})

// 计算 OBS 联动评级
// OBS 不是开播的必备项（用户可以用其他推流工具），所以即使启用了 OBS 但未连接，
// 也只算 warning（提醒）而非 danger（红色严重错误）。
const obsStatus = computed(() => {
  if (!store.obs.enabled) {
    return { status: "info", text: "未启用" }
  }
  if (!store.obs.connected) {
    return { status: "warning", text: "未连接" }
  }
  if (store.obs.streaming) {
    return { status: "success", text: "推流中" }
  }
  return { status: "warning", text: "已连接，未推流" }
})

// 更新体检数据
async function updateDiagnosticData() {
  try {
    const stats = await getSystemStats()
    if (stats) {
      systemCpu.value = stats.cpu || 0
      systemMemory.value = stats.memory || 0
    }
  } catch (err) {
    console.error("更新系统资源失败:", err)
  }

  try {
    const delay = await getNetworkDelay()
    if (delay !== undefined) {
      networkLatency.value = delay
    }
  } catch (err) {
    console.error("更新网络延时失败:", err)
  }
}

// 重新检测 (600ms 加载动画模拟深度检测)
async function triggerReDiagnostic() {
  if (diagnosticLoading.value) return
  diagnosticLoading.value = true
  diagnosticRunCount.value++
  await updateDiagnosticData()
  await new Promise(resolve => setTimeout(resolve, 600))
  diagnosticLoading.value = false
  showToast("开播前软硬件安全体检完成！")
}

const toast = ref("")
const qrLoginRunning = ref(false)
const loginForm = reactive({
  account: "",
  password: "",
})
const commentText = ref("")
const commentInputRef = ref(null)
const showAddManagerInput = ref(false)
const addManagerUid = ref("")
const coverPreviewSrc = ref("")
const overlayBaseUrl = ref("")
const logPath = ref("")
const systemFonts = ref(["Microsoft YaHei", "Noto Sans SC", "Segoe UI", "Arial", "sans-serif"])
const previewPlaceholder = { id: 0, nickname: "AcFun用户", content: "这是一条弹幕预览，样式会同步到 OBS 浏览器源。" }
const previewItems = ref([previewPlaceholder])
let previewItemSeq = 1
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
  { id: "overlay", label: "弹幕源", subtitle: "OBS 浏览器源与 TTS 弹幕播报", icon: MonitorPlay },
  { id: "stats", label: "数据", subtitle: "本场统计、转码信息与历史", icon: ChartBar },
  { id: "logs", label: "日志", subtitle: "本地操作记录", icon: ScrollText },
]

const currentTab = computed(() => tabs.find((item) => item.id === store.activeTab) || tabs[0])
const currentSubtitle = computed(() => {
  if (currentTab.value.id === "account" && store.isLoggedIn) {
    return "AcFun 账号信息与 acfunlive-backend 连接"
  }
  return currentTab.value.subtitle
})
const subtitleParts = computed(() => highlightAcfun(currentSubtitle.value))
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
  "--ui-scale": store.ui.uiScale,
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
    return { points: normalized, onlinePoints: "", danmakuPoints: "", onlinePath: "", danmakuPath: "", onlineArea: "", danmakuArea: "" }
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

  // 贝塞尔平滑路径插值算法
  const getBezierPath = (keyY) => {
    if (chartPoints.length < 2) return ""
    let d = `M ${chartPoints[0].x.toFixed(1)} ${chartPoints[0][keyY].toFixed(1)}`
    for (let i = 0; i < chartPoints.length - 1; i++) {
      const p0 = chartPoints[i]
      const p1 = chartPoints[i + 1]
      const cpX1 = p0.x + (p1.x - p0.x) / 3
      const cpY1 = p0[keyY]
      const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3
      const cpY2 = p1[keyY]
      d += ` C ${cpX1.toFixed(1)} ${cpY1.toFixed(1)}, ${cpX2.toFixed(1)} ${cpY2.toFixed(1)}, ${p1.x.toFixed(1)} ${p1[keyY].toFixed(1)}`
    }
    return d
  }

  const onlinePath = getBezierPath("onlineY")
  const danmakuPath = getBezierPath("danmakuY")

  // 生成自适应底部 y=220 的渐变填充闭合面积
  const getAreaPathSpec = (points, lineD, keyY) => {
    if (points.length < 2 || !lineD) return ""
    const first = points[0]
    const last = points[points.length - 1]
    return `M ${first.x.toFixed(1)} 220 L ${first.x.toFixed(1)} ${first[keyY].toFixed(1)} ${lineD.substring(1)} L ${last.x.toFixed(1)} 220 Z`
  }

  const onlineArea = getAreaPathSpec(chartPoints, onlinePath, "onlineY")
  const danmakuArea = getAreaPathSpec(chartPoints, danmakuPath, "danmakuY")

  const toPolyline = (key) => chartPoints
    .map((item) => `${item.x.toFixed(1)},${item[key].toFixed(1)}`)
    .join(" ")

  return {
    points: chartPoints,
    onlinePoints: toPolyline("onlineY"),
    danmakuPoints: toPolyline("danmakuY"),
    onlinePath,
    danmakuPath,
    onlineArea,
    danmakuArea,
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

// 已经发起 GET_PLAYBACK 请求的 liveId（用于禁用按钮防重复点击）
const playbackBusy = reactive({})

async function openPlayback(item) {
  if (!item || !item.liveId) {
    return
  }
  let playback = item.playback
  // 没有缓存就先去后端拉一次（关播后 liveID 仍可查询）
  if (!playback?.url && !playback?.backupURL) {
    if (playbackBusy[item.liveId]) {
      return
    }
    playbackBusy[item.liveId] = true
    try {
      playback = await store.fetchPlayback(item.liveId)
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      showToast(`回放获取失败：${message}`)
      return
    } finally {
      delete playbackBusy[item.liveId]
    }
  }
  const target = playback?.url || playback?.backupURL
  if (!target) {
    showToast("该场没有回放可用")
    return
  }
  run(() => openExternalURL(target), "已打开录播链接")
}

function openLiveCut() {
  const target = store.live.liveCutInfo.redirectURL || store.live.liveCutInfo.url
  if (!target) {
    return
  }
  run(() => openExternalURL(target), "已打开剪辑页面")
}

// 下载本场录播：先复用/拉取 playback URL，再调 Wails 后端的保存对话框 + 流式下载。
const downloadBusy = reactive({})

function suggestPlaybackFileName(item) {
  const base = String(item.title || item.liveId || "playback").replace(/[\\/:*?"<>|]+/g, "_").trim()
  // 录播多为 mp4，加扩展名让保存对话框过滤器命中
  return `${base || "playback"}.mp4`
}

async function downloadPlayback(item) {
  if (!item || !item.liveId) {
    return
  }
  if (downloadBusy[item.liveId]) {
    return
  }
  downloadBusy[item.liveId] = true
  try {
    let playback = item.playback
    if (!playback?.url && !playback?.backupURL) {
      try {
        playback = await store.fetchPlayback(item.liveId)
      } catch (error) {
        showToast(`录播获取失败：${error?.message || error}`)
        return
      }
    }
    const target = playback?.url || playback?.backupURL
    if (!target) {
      showToast("该场没有可下载的录播")
      return
    }
    showToast("已开始下载录播，文件较大请耐心等待")
    try {
      const savedPath = await downloadPlaybackToFile(target, suggestPlaybackFileName(item))
      if (savedPath) {
        showToast(`录播已保存到：${savedPath}`)
        store.log(`录播已保存到：${savedPath}`)
      }
      // savedPath 为空表示用户取消保存对话框，不弹错误
    } catch (error) {
      const message = error?.message || String(error)
      store.log(`录播下载失败：${message}`)
      showToast(`录播下载失败：${message}`)
    }
  } finally {
    delete downloadBusy[item.liveId]
  }
}

// 录像剪辑权限开关：避免并发点击 & 失败时手动把 input 还原到 store 当前值。
const liveCutBusy = ref(false)
async function onToggleLiveCut(event) {
  if (liveCutBusy.value) {
    event.target.checked = store.live.liveCutInfo.status
    return
  }
  const checked = event.target.checked
  liveCutBusy.value = true
  try {
    await store.setLiveCutCanCut(checked)
    showToast(checked ? "已允许观众剪辑本次录像" : "已设为仅主播可剪辑")
  } catch (error) {
    event.target.checked = store.live.liveCutInfo.status
    showToast(`录像剪辑权限设置失败：${error?.message || error}`)
  } finally {
    liveCutBusy.value = false
  }
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

function onOverlayScaleChange(event) {
  const raw = Number(event.target.value)
  const clamped = Math.min(200, Math.max(50, Number.isFinite(raw) ? raw : 100))
  store.overlay.scale = clamped / 100
  event.target.value = clamped
  store.persist()
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

// 把 overlay 样式实时推到 OBS 浏览器源（同源 SSE），避免每次改字号都要复制 URL 重连。
let overlayBroadcastTimer = 0
function pushOverlayStyle() {
  try {
    broadcastOverlayStyle(JSON.stringify(store.overlay))
  } catch (_) {}
}
watch(() => store.overlay, () => {
  window.clearTimeout(overlayBroadcastTimer)
  overlayBroadcastTimer = window.setTimeout(pushOverlayStyle, 80)
}, { deep: true, immediate: true })
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
  // 让主程序内的 overlay-preview 面板与 OBS 浏览器源同步整体缩放
  zoom: store.overlay.scale || 1,
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
let tickerTimer = 0
let diagnosticTimer = 0
let floatThemeTimer = 0
let floatRuntimeTimer = 0
let coverPreviewRequest = 0

watch(() => store.ui.theme, (theme) => {
  if (!isMiniWindowProcess.value) {
    setSharedTheme(theme).catch(() => {})
  }
})

onMounted(async () => {
  updateExtremeNarrowSidebar()
  window.addEventListener("resize", updateExtremeNarrowSidebar)
  window.addEventListener("wheel", handleFloatWheel, { passive: false })
  window.addEventListener("keydown", handleFloatScaleShortcut)
  window.addEventListener("mousedown", handleFloatMouseDown, true)
  window.addEventListener("mousemove", handleFloatMouseMove)
  window.addEventListener("mouseup", handleFloatMouseUp)
  window.addEventListener("blur", handleFloatMouseUp)
  document.addEventListener("mouseleave", handleFloatMouseUp)
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
  tickerTimer = window.setInterval(() => {
    store.room.ticker++
  }, 1000)

  // 启动开播体检定时器
  updateDiagnosticData()
  diagnosticTimer = window.setInterval(updateDiagnosticData, 3000)

  // 检测是否是悬浮窗精简进程，若是则自动切入悬浮弹幕页面
  const mini = await isMiniMode()
  isMiniWindowProcess.value = mini
  if (mini) {
    floatDanmakuActive.value = true
    // 按上次保存的缩放比例同步原生窗口尺寸
    if (floatScale.value !== 1) {
      setWindowSize(
        Math.round(FLOAT_BASE_WIDTH * floatScale.value),
        Math.round(FLOAT_BASE_HEIGHT * floatScale.value),
      ).catch(() => {})
    }
    await syncFloatRuntimeState()
    await ensureFloatDanmuStarted()
    await syncFloatTheme()
    floatThemeTimer = window.setInterval(syncFloatTheme, 500)
    floatRuntimeTimer = window.setInterval(syncFloatRuntimeState, 1000)

    // 监听全局热键切换鼠标穿透
    onClickThroughToggle(toggleClickThrough)
    // 把保存的热键同步给后端（确保前后端一致；默认值幂等也无妨）
    setMouseClickThroughHotkey(
      clickThroughHotkey.value.mods,
      clickThroughHotkey.value.vk,
    ).catch(() => {})
    // 全局 keydown 监听用于"按下捕获热键"，capture 阶段优先抢截
    window.addEventListener("keydown", handleHotkeyCapture, true)
    // 恢复上次的穿透偏好（仅当用户主动开启过才恢复，避免冷启动突然进入穿透）
    if (localStorage.getItem(FLOAT_CLICK_THROUGH_KEY) === "1") {
      setClickThroughMode(true)
    }
  } else {
    setSharedTheme(store.ui.theme).catch(() => {})
    await publishFloatRuntimeState()
    floatRuntimeTimer = window.setInterval(publishFloatRuntimeState, 1000)
  }
})

onUnmounted(() => {
  store.rememberObsConnectionForNextLaunch()
  window.clearInterval(refreshTimer)
  window.clearInterval(tickerTimer)
  window.clearInterval(diagnosticTimer)
  window.clearInterval(floatThemeTimer)
  window.clearInterval(floatRuntimeTimer)
  window.clearTimeout(sidebarToggleFlashTimer)
  window.removeEventListener("resize", updateExtremeNarrowSidebar)
  window.removeEventListener("wheel", handleFloatWheel)
  window.removeEventListener("keydown", handleFloatScaleShortcut)
  window.removeEventListener("mousedown", handleFloatMouseDown, true)
  window.removeEventListener("mousemove", handleFloatMouseMove)
  window.removeEventListener("mouseup", handleFloatMouseUp)
  window.removeEventListener("blur", handleFloatMouseUp)
  document.removeEventListener("mouseleave", handleFloatMouseUp)
  window.removeEventListener("keydown", handleHotkeyCapture, true)
})

async function syncFloatTheme() {
  try {
    const theme = await getSharedTheme()
    if ((theme === "dark" || theme === "light") && theme !== store.ui.theme) {
      store.setTheme(theme)
    }
  } catch {
  }
}

async function initializeNativeRuntime() {
  const [backendPortResult, overlayUrlResult, logPathResult] = await Promise.allSettled([
    getBackendPort(),
    getOverlayBaseUrl(),
    getLogPath(),
  ])
  getSystemFonts().then((fonts) => {
    if (Array.isArray(fonts) && fonts.length) {
      systemFonts.value = fonts
      const fallback = fonts.includes("Microsoft YaHei") ? "Microsoft YaHei" : fonts[0]
      let dirty = false
      if (!fonts.includes(store.overlay.fontFamily)) {
        store.overlay.fontFamily = fallback
        dirty = true
      }
      if (!fonts.includes(store.overlay.nameFontFamily)) {
        store.overlay.nameFontFamily = store.overlay.fontFamily
        dirty = true
      }
      if (!fonts.includes(store.overlay.contentFontFamily)) {
        store.overlay.contentFontFamily = store.overlay.fontFamily
        dirty = true
      }
      if (dirty) {
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

function removeCoverHistory(file) {
  const target = String(file || "").trim()
  const current = String(store.live.coverFile || "").trim()
  const isCurrentCover = target && current === target
  const isLastCover = store.live.coverHistory.length === 1 && store.live.coverHistory[0] === file

  store.removeCoverHistory(file)
  delete coverThumbCache[file]

  if (isCurrentCover || isLastCover) {
    store.setCoverFile("")
    coverPreviewRequest++
    coverPreviewSrc.value = ""
    coverImageReady.value = false
  }
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

function doAddManagerByUid() {
  const uid = String(addManagerUid.value || "").trim()
  if (!uid) {
    showToast("请输入房管 UID")
    return
  }
  if (!/^\d+$/.test(uid)) {
    showToast("UID 必须是纯数字")
    return
  }
  run(async () => {
    await store.addManagerByUid(Number(uid))
    addManagerUid.value = ""
    showAddManagerInput.value = false
  }, "添加房管成功")
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

function rankRowClass(rank) {
  if (rank === 1) return "rank-row-top rank-row-gold"
  if (rank === 2) return "rank-row-top rank-row-silver"
  if (rank === 3) return "rank-row-top rank-row-bronze"
  return ""
}

function rankBadgeClass(rank) {
  if (rank === 1) return "rank-badge-gold"
  if (rank === 2) return "rank-badge-silver"
  if (rank === 3) return "rank-badge-bronze"
  return "rank-badge-default"
}

function medalWrapperLevelClass(level) {
  // AcFun 官方 sprite 覆盖 1~20 级，超过 20 复用 lv-20 顶级渐变
  const lvl = Math.max(1, Math.min(20, Number(level) || 1))
  return `medal-lv-${lvl}`
}

function guardianInitial(nickname) {
  const name = String(nickname || "?").trim()
  return name ? name.charAt(0).toUpperCase() : "?"
}

async function refreshGuardianList() {
  if (!store.isLoggedIn) {
    showToast("请先登录后再刷新")
    return
  }
  try {
    await store.loadGuardianList()
    showToast("守护团列表已刷新")
  } catch (error) {
    showToast(error && error.message ? error.message : "刷新失败")
  }
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
