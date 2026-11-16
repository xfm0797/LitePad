//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
)

// fatalDialog 在无控制台的 GUI 程序中显示启动失败原因。
// 使用 -H windowsgui 链接后 stdout/stderr 不可见，必须走系统弹窗。
func fatalDialog(title, text string) {
	t, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	b, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	const mbIconError = 0x10
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(b)), uintptr(unsafe.Pointer(t)), mbIconError)
}
