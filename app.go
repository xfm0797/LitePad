package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"litepad/core"
)

// FilePayload 是传递给前端的一次文件读取结果。
type FilePayload struct {
	Path     string `json:"path"`     // 绝对路径
	Name     string `json:"name"`     // 文件名（标签标题）
	Content  string `json:"content"`  // UTF-8 文本内容
	Encoding string `json:"encoding"` // 识别出的编码
	EOL      string `json:"eol"`      // 换行符类型（LF / CRLF）
	Language string `json:"language"` // 语法高亮语言标识
	Size     int64  `json:"size"`     // 文件字节数（用 int64，避免 32 位构建下大文件溢出）
}

// App 是 Wails 绑定层：仅做参数转换与对话框调度，
// 文件读写、编码、配置逻辑全部位于 core 包。
// 绑定方法会被前端从多个 goroutine 调用，可变状态一律加锁或使用原子量。
type App struct {
	ctx     context.Context
	store   *core.ConfigStore
	watcher *core.Watcher

	cfgMu sync.RWMutex
	cfg   core.Config

	unsaved      atomic.Bool // 存在未保存标签时由前端置位，用于关闭拦截
	filesMu      sync.Mutex  // 保护 pendingFiles
	pendingFiles []string    // 启动参数中携带的文件（文件关联双击打开）
}

// NewApp 构造 App 并加载持久化配置。
func NewApp() *App {
	a := &App{}
	a.store, _ = core.NewConfigStore()
	if a.store != nil {
		a.cfg, _ = a.store.LoadConfig()
	} else {
		a.cfg = core.DefaultConfig()
	}
	a.pendingFiles = startupFiles()
	return a
}

// startupFiles 从命令行参数中提取可打开的文件路径。
// 关联注册写入的命令行为 `"LitePad.exe" "%1"`，因此双击文件时 argv[1] 即目标路径。
func startupFiles() []string {
	out := []string{}
	for _, arg := range os.Args[1:] {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue // 跳过开关参数（如 -psn 等）
		}
		abs, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		if st, err := os.Stat(abs); err != nil || st.IsDir() {
			continue
		}
		out = append(out, abs)
	}
	return out
}

// startup 由 Wails 生命周期回调调用。
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 窗口创建时按工作区居中，随后再显示（main.go 中 StartHidden=true）。
	winW, winH := initialWindowSize()
	winX, winY := centerInWorkArea(winW, winH)
	runtime.WindowSetPosition(ctx, winX, winY)
	defer runtime.WindowShow(ctx)
	// 注册文件拖放：拖入文件后向前端广播事件
	runtime.OnFileDrop(ctx, func(x, y int, paths []string) {
		runtime.EventsEmit(ctx, "files:dropped", paths)
	})
	// 启动外部文件修改监视
	a.watcher = core.NewWatcher()
	if a.watcher != nil {
		go a.watchLoop()
	}
}

// watchLoop 将外部文件变更转发给前端，监视器关闭后退出（不泄漏协程）。
func (a *App) watchLoop() {
	for {
		select {
		case ev := <-a.watcher.Events:
			runtime.EventsEmit(a.ctx, "file:external-change", ev)
		case <-a.watcher.Done():
			return
		}
	}
}

// shutdown 在应用退出时释放资源。
func (a *App) shutdown(ctx context.Context) {
	if a.watcher != nil {
		a.watcher.Close()
	}
}

// beforeClose 在窗口关闭前拦截：有未保存内容时通知前端确认。
// Wails v2 约定返回 true 表示阻止本次关闭。
func (a *App) beforeClose(ctx context.Context) bool {
	if a.unsaved.Load() {
		runtime.EventsEmit(ctx, "app:confirm-exit")
		return true
	}
	return false
}

// SyncWatchers 将监视列表与当前打开的文件对齐（前端在标签变化时调用）。
func (a *App) SyncWatchers(paths []string) {
	if a.watcher != nil {
		a.watcher.Sync(paths)
	}
}

// ToggleFullscreen 切换窗口全屏（full=true 表示当前处于全屏，需要退出）。
func (a *App) ToggleFullscreen(full bool) {
	if full {
		runtime.WindowUnfullscreen(a.ctx)
	} else {
		runtime.WindowFullscreen(a.ctx)
	}
}

// OpenExternal 用系统默认浏览器打开链接（仅允许 http/https）。
func (a *App) OpenExternal(rawURL string) error {
	u := strings.TrimSpace(rawURL)
	if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
		return errors.New("仅支持打开 http/https 链接")
	}
	runtime.BrowserOpenURL(a.ctx, u)
	return nil
}

// AppInfo 是关于页展示的应用元信息（版本唯一来源为 wails.json）。
type AppInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Copyright string `json:"copyright"`
}

// GetAppInfo 读取嵌入的 wails.json 生成应用元信息，版本号不在代码里重复书写。
func (a *App) GetAppInfo() AppInfo {
	info := AppInfo{Name: "LitePad", Version: "未知"}
	var meta struct {
		Info struct {
			ProductName    string `json:"productName"`
			ProductVersion string `json:"productVersion"`
			Copyright      string `json:"copyright"`
		} `json:"info"`
	}
	if err := json.Unmarshal(wailsConfig, &meta); err != nil {
		return info
	}
	if meta.Info.ProductName != "" {
		info.Name = meta.Info.ProductName
	}
	if meta.Info.ProductVersion != "" {
		info.Version = meta.Info.ProductVersion
	}
	info.Copyright = meta.Info.Copyright
	return info
}

// RevealInExplorer 在系统文件管理器中定位文件。
func (a *App) RevealInExplorer(path string) error {
	switch goruntime.GOOS {
	case "windows":
		return exec.Command("explorer", "/select,", path).Start()
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// RenameFile 重命名（或移动）文件；目标已存在时报错。
func (a *App) RenameFile(oldPath, newPath string) error {
	if oldPath == newPath {
		return nil
	}
	if _, err := os.Stat(newPath); err == nil {
		return errors.New("目标文件已存在：" + newPath)
	}
	return os.Rename(oldPath, newPath)
}

// SetReadOnlyAttr 切换文件系统只读属性（Windows 下保留其他属性位）。
func (a *App) SetReadOnlyAttr(path string, readonly bool) error {
	return core.SetReadOnly(path, readonly)
}

// OpenFileDialog 弹出系统打开文件对话框。
// 用户取消时返回 (nil, nil)。
func (a *App) OpenFileDialog() (*FilePayload, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本与源代码 (*.txt;*.go;*.py;*.js;*.json;*.md;...)", Pattern: "*.txt;*.go;*.py;*.js;*.mjs;*.cjs;*.ts;*.jsx;*.tsx;*.json;*.md;*.markdown;*.html;*.htm;*.xml;*.css;*.yaml;*.yml;*.sql;*.c;*.h;*.cpp;*.hpp;*.log;*.ini;*.toml;*.cfg;*.bat;*.ps1;*.sh"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	return a.OpenPath(path)
}

// OpenPath 读取指定路径的文件（供最近文件/会话恢复/拖放复用）。
func (a *App) OpenPath(path string) (*FilePayload, error) {
	content, enc, eol, err := core.ReadTextFile(path)
	if err != nil {
		return nil, err
	}
	// 用磁盘字节数而非字符数：中文文件按字符计会显著低估，影响大文件降级判断
	size := int64(len(content))
	if st, statErr := os.Stat(path); statErr == nil {
		size = st.Size()
	}
	return &FilePayload{
		Path:     path,
		Name:     filepath.Base(path),
		Content:  content,
		Encoding: enc,
		EOL:      eol,
		Language: core.DetectLanguage(path),
		Size:     size,
	}, nil
}

// SaveFileDialog 弹出另存为对话框，返回用户选择的路径（取消返回空串）。
func (a *App) SaveFileDialog(defaultName string) (string, error) {
	if defaultName == "" {
		defaultName = "未命名.txt"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存文件",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
			{DisplayName: "文本文件 (*.txt)", Pattern: "*.txt"},
		},
	})
}

// WriteFile 以指定编码与换行符写盘（前端传 UTF-8 内容）。
func (a *App) WriteFile(path string, content string, encoding string, eol string) error {
	return core.WriteTextFile(path, content, encoding, eol)
}

// GetConfig 返回当前配置（副本，避免前端拿到内部状态引用）。
func (a *App) GetConfig() core.Config {
	a.cfgMu.RLock()
	defer a.cfgMu.RUnlock()
	return a.cfg
}

// SaveConfig 保存前端回传的偏好设置（主题、字体、换行开关等）。
//
// 合并语义：最近文件与系统集成记录由主进程维护，前端持有的副本可能因
// 并发操作（如刚打开文件又立刻缩放字体）而滞后，直接用前端副本覆盖会
// 丢掉这些数据，因此这两项始终以服务端为准。
func (a *App) SaveConfig(cfg core.Config) error {
	cfg.Normalize()
	a.cfgMu.Lock()
	cfg.RecentFiles = a.cfg.RecentFiles
	cfg.Integrations = a.cfg.Integrations
	a.cfg = cfg
	a.cfgMu.Unlock()
	if a.store == nil {
		return nil
	}
	return a.store.SaveConfig(cfg)
}

// SetWindowTitle 更新窗口标题（随活动标签与未保存状态变化）。
func (a *App) SetWindowTitle(title string) {
	if a.ctx == nil {
		return
	}
	runtime.WindowSetTitle(a.ctx, title)
}

// AddRecent 将路径加入最近文件列表并持久化，返回更新后的配置。
func (a *App) AddRecent(path string) (core.Config, error) {
	a.cfgMu.Lock()
	a.cfg.RecentFiles = core.PushRecent(a.cfg.RecentFiles, path)
	updated := a.cfg
	a.cfgMu.Unlock()
	if a.store != nil {
		if err := a.store.SaveConfig(updated); err != nil {
			return updated, err
		}
	}
	return updated, nil
}

// SaveSession 持久化当前会话（打开的文件与活动标签）。
func (a *App) SaveSession(paths []string, active int) error {
	if a.store == nil {
		return nil
	}
	return a.store.SaveSession(core.Session{Paths: paths, Active: active})
}

// LoadSession 读取会话；无会话文件时返回空列表。
func (a *App) LoadSession() (core.Session, error) {
	if a.store == nil {
		return core.Session{}, nil
	}
	return a.store.LoadSession()
}

// SetUnsaved 由前端同步「是否存在未保存标签」的状态。
func (a *App) SetUnsaved(unsaved bool) { a.unsaved.Store(unsaved) }

// Quit 强制退出应用（用于未保存确认后的继续退出）。
func (a *App) Quit() { runtime.Quit(a.ctx) }

// StartupFiles 返回启动命令行中携带的文件（双击关联文件打开）。
// 前端在启动时取出后应立即调用 ClearStartupFiles，避免重复打开。
func (a *App) StartupFiles() []string {
	a.filesMu.Lock()
	defer a.filesMu.Unlock()
	if len(a.pendingFiles) == 0 {
		return []string{}
	}
	out := make([]string, len(a.pendingFiles))
	copy(out, a.pendingFiles)
	return out
}

// ClearStartupFiles 清空一次性启动文件列表。
func (a *App) ClearStartupFiles() {
	a.filesMu.Lock()
	a.pendingFiles = nil
	a.filesMu.Unlock()
}

// AssocFormats 返回设置页可勾选的关联格式清单。
func (a *App) AssocFormats() []string { return core.AssocFormats() }

// GetAssocStatus 读取注册表中的真实集成状态。
func (a *App) GetAssocStatus() core.AssocStatus {
	exe, err := os.Executable()
	if err != nil {
		exe = ""
	}
	return core.ReadAssocStatus(exe)
}

// ApplyAssoc 应用文件关联与资源管理器右键菜单，并记录到配置。
func (a *App) ApplyAssoc(formats []string, explorerMenu bool, setDefault bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	clean := make([]string, 0, len(formats))
	seen := map[string]bool{}
	for _, f := range formats {
		f = strings.ToLower(strings.TrimSpace(f))
		if f == "" || seen[f] {
			continue
		}
		if !strings.HasPrefix(f, ".") {
			f = "." + f
		}
		seen[f] = true
		clean = append(clean, f)
	}
	if err := core.ApplyAssoc(exe, clean, explorerMenu, setDefault); err != nil {
		return err
	}
	a.cfgMu.Lock()
	a.cfg.Integrations = core.IntegrationPrefs{Formats: clean, ExplorerMenu: explorerMenu, SetDefault: setDefault}
	updated := a.cfg
	a.cfgMu.Unlock()
	if a.store != nil {
		_ = a.store.SaveConfig(updated)
	}
	return nil
}

// ClearAssoc 移除全部 LitePad 关联与右键菜单。
func (a *App) ClearAssoc() error {
	if err := core.ClearAssoc(); err != nil {
		return err
	}
	a.cfgMu.Lock()
	a.cfg.Integrations = core.IntegrationPrefs{Formats: []string{}, ExplorerMenu: false, SetDefault: false}
	updated := a.cfg
	a.cfgMu.Unlock()
	if a.store != nil {
		_ = a.store.SaveConfig(updated)
	}
	return nil
}

// OpenInNewWindow 用当前可执行文件再启动一个进程打开指定路径（供“在新窗口打开”）。
func (a *App) OpenInNewWindow(path string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return exec.Command(exe, path).Start()
}
