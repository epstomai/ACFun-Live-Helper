# ACFun-Live-Helper

AcFun 直播助手。基于 Wails v2 (Go) + Vue 3 + Vite + Pinia 构建，内置 `acfunlive-backend`。

## 支持的功能
* 房间观众管理
* 拉黑观众
* 房管管理
* 弹幕透明置顶显示
* 弹幕发送
* 弹幕发送置顶窗
* 直播开关播
* 开播时封面和标题修改
* GIF 封面
* 弹幕播报
* 弹幕互动
* OBS 推流码修改
* 投喂列表
* 下播后的直播详情

## 编译

依赖：Go ≥ 1.21、Node ≥ 18、[Wails v2](https://wails.io/) CLI、Windows 构建机推荐使用 PowerShell。

```powershell
npm install
go mod tidy
wails dev                       # 开发模式（前端 HMR + Go 热重启）
wails build                     # 生产构建（当前平台）
wails build -platform windows/amd64
```

也提供 npm 别名：

```powershell
npm run wails:dev
npm run wails:build
npm run wails:build:win
```

Windows 一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

产物位于 `build\bin\ACFun Live Helper.exe`。

## 后端测试

```powershell
npm run test:backend-client
```

## 下载
1. [Releases](https://github.com/epstomai/ACFun-Live-Helper/releases)

