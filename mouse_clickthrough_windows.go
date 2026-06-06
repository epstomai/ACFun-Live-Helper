//go:build windows

package main

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 鼠标穿透 + 全局热键（仅悬浮 mini 进程使用）
//
// 背景：无边框全屏游戏中，鼠标移到弹幕窗会触发 Windows 的「光标交给桌面」判定，
// 导致游戏失去鼠标控制。解决办法：把窗口设为 click-through（鼠标事件穿透），
// 鼠标在弹幕窗范围内时直接落到下面的游戏窗口。
//
// 切换方式：
//   - 前端 mini header 上的「幽灵」按钮（仅在交互模式下可点）
//   - 全局热键 Ctrl+Alt+Shift+G（穿透模式下窗口不响应点击，必须用全局热键退出）

const (
	// gwlExStyle 在 Win32 API 上是有符号 LONG（-20），需通过 uint32 再扩展到 uintptr，
	// 直接 uintptr(int32(-20)) 会被 Go 编译器拒绝（常量负数转 uintptr 溢出）。
	gwlExStyle      = uint32(0xFFFFFFEC) // = int32(-20)
	wsExLayered     = 0x00080000
	wsExTransparent = 0x00000020

	wmHotkey           = 0x0312
	wmQuit             = 0x0012
	wmUserUpdateHotkey = 0x0400 + 1 // WM_USER + 1: 通知 hotkey 线程重新注册
	modAlt             = 0x0001
	modCtrl            = 0x0002
	modShift           = 0x0004
	modNoRepeat        = 0x4000

	vkG = 0x47 // 'G'，默认 Ctrl+Alt+Shift+G
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindowLongPtrW        = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	procRegisterHotKey           = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey         = user32.NewProc("UnregisterHotKey")
	procGetMessageW              = user32.NewProc("GetMessageW")
	procPostThreadMessageW       = user32.NewProc("PostThreadMessageW")

	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procGetCurrentThreadId = kernel32.NewProc("GetCurrentThreadId")

	hotkeyMu       sync.Mutex
	hotkeyThreadID uint32
)

type winMsg struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	pt       struct{ x, y int32 }
	lPrivate uint32
}

// findOwnVisibleHWND 枚举所有顶层窗口，返回第一个属于本进程且 visible 的 HWND。
// mini 进程只有一个 wails webview 窗口，所以这个查找是稳定的。
func findOwnVisibleHWND() windows.HWND {
	var found windows.HWND
	pid := windows.GetCurrentProcessId()
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var wpid uint32
		_, _, _ = procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&wpid)))
		if wpid == pid {
			vis, _, _ := procIsWindowVisible.Call(hwnd)
			if vis != 0 {
				found = windows.HWND(hwnd)
				return 0 // 0 = stop enumeration
			}
		}
		return 1
	})
	_, _, _ = procEnumWindows.Call(cb, 0)
	return found
}

// applyMouseClickThrough 在指定窗口上 toggle WS_EX_TRANSPARENT 标志。
// 启用后窗口不响应任何鼠标事件（点击 / hover / wheel 全部穿透到下层），
// 关闭后恢复正常交互。WS_EX_LAYERED 始终保留（wails translucent 窗口本身就需要）。
func applyMouseClickThrough(hwnd windows.HWND, enable bool) error {
	if hwnd == 0 {
		return errors.New("hwnd is 0")
	}
	style, _, _ := procGetWindowLongPtrW.Call(uintptr(hwnd), uintptr(gwlExStyle))
	var newStyle uintptr
	if enable {
		newStyle = style | wsExLayered | wsExTransparent
	} else {
		newStyle = (style | wsExLayered) &^ wsExTransparent
	}
	if newStyle == style {
		return nil
	}
	ret, _, err := procSetWindowLongPtrW.Call(uintptr(hwnd), uintptr(gwlExStyle), newStyle)
	if ret == 0 && err != nil && err != syscall.Errno(0) {
		return err
	}
	return nil
}

// startGlobalHotkey 在独立的 OS 线程中注册全局热键，
// 收到 WM_HOTKEY 时调用 onTrigger（运行在该线程内）。
// 收到 WM_USER+1 时按 wParam=mods、lParam=vk 重新注册热键，支持运行时动态切换。
//
// 注意：RegisterHotKey 与 GetMessage 必须在同一个 OS 线程，因此用 LockOSThread。
// 整个 mini 进程生命周期内只调用一次，无需反注册（进程退出会自动清理）。
func startGlobalHotkey(initialMods, initialVK uintptr, onTrigger func()) {
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		// 记录线程 ID，便于其他 goroutine 通过 PostThreadMessage 发送重注册消息
		tid, _, _ := procGetCurrentThreadId.Call()
		hotkeyMu.Lock()
		hotkeyThreadID = uint32(tid)
		hotkeyMu.Unlock()

		const id = 1
		curMods := initialMods | uintptr(modNoRepeat)
		curVK := initialVK
		_, _, _ = procRegisterHotKey.Call(0, id, curMods, curVK)
		defer procUnregisterHotKey.Call(0, id)

		var m winMsg
		for {
			ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(ret) <= 0 {
				return
			}
			switch m.message {
			case wmHotkey:
				if m.wParam == id && onTrigger != nil {
					onTrigger()
				}
			case wmUserUpdateHotkey:
				_, _, _ = procUnregisterHotKey.Call(0, id)
				curMods = m.wParam | uintptr(modNoRepeat)
				curVK = m.lParam
				_, _, _ = procRegisterHotKey.Call(0, id, curMods, curVK)
			}
		}
	}()
}

// updateGlobalHotkey 通知 hotkey 监听线程重注册热键。安全地跨线程调用。
// 若热键线程尚未启动则忽略。
func updateGlobalHotkey(mods, vk uintptr) error {
	hotkeyMu.Lock()
	tid := hotkeyThreadID
	hotkeyMu.Unlock()
	if tid == 0 {
		return errors.New("hotkey thread not running")
	}
	ok, _, err := procPostThreadMessageW.Call(uintptr(tid), wmUserUpdateHotkey, mods, vk)
	if ok == 0 {
		if err != nil && err != syscall.Errno(0) {
			return err
		}
		return errors.New("PostThreadMessage failed")
	}
	return nil
}
