//go:build !windows

package main

// 非 Windows 平台没有 SystemParametersInfo 可用，退回固定默认窗口尺寸与位置。

const (
	preferredWindowWidth  = 1200
	preferredWindowHeight = 800
	minWindowWidth        = 640
	minWindowHeight       = 480
)

// workArea 返回一个不越界的虚拟工作区原点。
func workArea() (x, y, w, h int) {
	return 0, 0, 1920, 1080
}

// initialWindowSize 在 Linux/macOS 上直接返回首选尺寸。
func initialWindowSize() (int, int) {
	return preferredWindowWidth, preferredWindowHeight
}

// centerInWorkArea 在 Linux/macOS 上返回 (0, 0)，让系统窗口管理器自行处理位置。
func centerInWorkArea(w, h int) (int, int) {
	return 0, 0
}

// geometryFitsWorkArea 非 Windows 平台视为总是有效（屏幕边界检测留给窗口管理器）。
func geometryFitsWorkArea(x, y, w, h int) bool {
	return true
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
