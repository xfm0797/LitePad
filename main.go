package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// wailsConfig 嵌入工程配置，作为版本号等元信息的唯一来源（关于页读取）。
//
//go:embed wails.json
var wailsConfig []byte

func main() {
	// 已有实例时把启动文件转发过去并退出；转发失败则退回旧行为（再开一个窗口）。
	single, primary := acquireSingleInstance()
	if !primary && forwardToPrimary(startupFiles()) {
		return
	}

	app := NewApp()
	app.single = single
	if single != nil {
		defer single.Close()
	}

	winW, winH := initialWindowSize()

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
		// windowsgui 构建无控制台，必须弹窗告知失败原因（如 WebView2 未安装）。
		fatalDialog("LitePad 启动失败", err.Error())
	}
}
