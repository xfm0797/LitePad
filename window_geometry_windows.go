//go:build windows

package main

import (
	"unsafe"
)

// 本文件按屏幕可用工作区（已扣除任务栏）计算主窗口的初始尺寸与居中位置。

const (
	preferredWindowWidth  = 1200
	preferredWindowHeight = 800
	minWindowWidth        = 640
	minWindowHeight       = 480
	windowMargin          = 80 // 窗口与工作区边缘的合计留白
	spiGetWorkAreaFlag    = 0x0030
)

type winRect struct {
	Left, Top, Right, Bottom int32
}

var procSystemInfo = user32.NewProc("SystemParametersInfoW")

// workArea 返回主显示器工作区（不含任务栏）的左上角与宽高。
func workArea() (x, y, w, h int) {
	var r winRect
	procSystemInfo.Call(spiGetWorkAreaFlag, 0, uintptr(unsafe.Pointer(&r)), 0)
	if r.Right <= r.Left || r.Bottom <= r.Top {
		return 0, 0, preferredWindowWidth, preferredWindowHeight
	}
	return int(r.Left), int(r.Top), int(r.Right - r.Left), int(r.Bottom - r.Top)
}

// initialWindowSize 依据工作区给出不超出屏幕的初始窗口尺寸。
func initialWindowSize() (int, int) {
	_, _, ww, wh := workArea()
	w, h := preferredWindowWidth, preferredWindowHeight
	if maxW := ww - windowMargin; w > maxW {
		w = maxW
	}
	if maxH := wh - windowMargin; h > maxH {
		h = maxH
	}
	if w < minWindowWidth {
		w = minWindowWidth
	}
	if h < minWindowHeight {
		h = minWindowHeight
	}
	if w > ww {
		w = ww
	}
	if h > wh {
		h = wh
	}
	return w, h
}

// centerInWorkArea 把指定尺寸的窗口在工作区内居中（不越过工作区左上角）。
func centerInWorkArea(w, h int) (int, int) {
	wx, wy, ww, wh := workArea()
	x := wx + (ww-w)/2
	y := wy + (wh-h)/2
	if x < wx {
		x = wx
	}
	if y < wy {
		y = wy
	}
	return x, y
}
