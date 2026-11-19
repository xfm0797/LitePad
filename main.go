package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"litepad/core"
)

//go:embed all:frontend/dist
var assets embed.FS

// wailsConfig 嵌入工程配置，作为版本号等元信息的唯一来源（关于页读取）。
//
//go:embed wails.json
var wailsConfig []byte

func main() {
	// 1) 初始化日志，最早建立以便 panic recover、启动失败都能写入。
	log, logErr := core.InitLogger()
	if logErr != nil {
		// 日志都建不成，退回控制台：非 windowsgui 下至少能看到。
		fatalDialog("LitePad 日志初始化失败", logErr.Error())
	}
	if log != nil {
		defer log.Close()
	}

	// 2) 兜底 panic recover：写日志后退出，让 crash 栈可追溯。
	defer func() {
		if r := recover(); r != nil {
			core.LogPanic(r)
			os.Exit(1)
		}
	}()

	core.Info("LitePad main starting, pid=%d", os.Getpid())

	// 3) 单实例判定：二次启动把文件转发过去然后退出。
	single, primary := acquireSingleInstance()
	if !primary && forwardToPrimary(startupFiles()) {
		core.Info("forwarded to existing instance, exiting")
		return
	}

	app := NewApp()
	app.single = single
	if single != nil {
		defer single.Close()
		core.Info("single-instance primary acquired")
	}

	winW, winH := initialWindowSize()
	core.Info("initial window size: %dx%d", winW, winH)

	err := wails.Run(&options.App{
		Title:         "LitePad",
		Width:         winW,
		Height:        winH,
		MinWidth:      minWindowWidth,
		MinHeight:     minWindowHeight,
		StartHidden:   true, // 在 startup 中按工作区居中后再显示，避免出现在屏幕外
		Assets:        assets,
		Bind:          []interface{}{app},
		OnStartup:     app.startup,
		OnShutdown:    app.shutdown,
		OnBeforeClose: app.beforeClose,
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
	})
	if err != nil {
		core.Error("wails.Run exited with error: %v", err)
		fatalDialog("LitePad 启动失败", err.Error())
	}
	core.Info("wails.Run returned normally")
}
