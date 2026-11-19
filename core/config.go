package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Config 是持久化到用户目录的应用配置（JSON）。
type Config struct {
	Theme        string           `json:"theme"`          // "light" | "dark"
	FontFamily   string           `json:"fontFamily"`     // 等宽字体名
	FontSize     int              `json:"fontSize"`       // 字号（px）
	Wrap         bool             `json:"wrap"`           // 自动换行
	TabSize      int              `json:"tabSize"`        // 缩进宽度
	ShowWhite    bool             `json:"showWhitespace"` // 显示空白字符
	RecentFiles  []string         `json:"recentFiles"`    // 最近文件（最新在前，去重，最多 10 条）
	ContextMenu  ContextMenuPrefs `json:"contextMenu"`    // 右键菜单显示哪些分组
	Integrations IntegrationPrefs `json:"integrations"`   // 系统集成（文件关联 / 资源管理器菜单）
	Geometry     WindowGeometry   `json:"geometry,omitempty"`
}

// WindowGeometry 记录上次关闭时的窗口位置与尺寸，下次启动时尽量还原。
type WindowGeometry struct {
	X       int  `json:"x"`       // 左上角 X
	Y       int  `json:"y"`       // 左上角 Y
	Width   int  `json:"width"`   // 宽（px）
	Height  int  `json:"height"`  // 高（px）
	Visible bool `json:"visible"` // true 表示该几何有效，false 时应忽略（例如用户是在另一显示器上关的）
}

// ContextMenuPrefs 控制编辑器右键菜单的分组显示。
// 全部为 true 时是完整菜单；用户可按需精简。
type ContextMenuPrefs struct {
	Clipboard    bool `json:"clipboard"`    // 撤销/剪切/复制/粘贴/全选
	Lines        bool `json:"lines"`        // 行操作（复制行、删除行、排序、去重…）
	Transform    bool `json:"transform"`    // 大小写、Tab 转换、插入时间
	Navigate     bool `json:"navigate"`     // 查找、替换、转到行、书签
	View         bool `json:"view"`         // 换行、空白字符、预览、缩放
	File         bool `json:"file"`         // 保存、另存为、路径、资源管理器
	ShowShortcut bool `json:"showShortcut"` // 是否在菜单右侧显示快捷键
}

// IntegrationPrefs 记录用户希望的系统集成状态。
// 真正的生效状态以 Windows 注册表为准，这里用于首选项回显。
type IntegrationPrefs struct {
	Formats      []string `json:"formats"`      // 已关联的扩展名（含点，如 ".txt"）
	ExplorerMenu bool     `json:"explorerMenu"` // 资源管理器右键菜单项
	SetDefault   bool     `json:"setDefault"`   // 是否同时设为默认打开方式
}

// Session 用于重启后恢复上次打开的标签页。
type Session struct {
	Paths      []string `json:"paths"`                // 打开的文件路径
	Active     int      `json:"active,omitempty"`     // 旧版本保存的活动标签索引（仅用于兼容）
	ActivePath string   `json:"activePath,omitempty"` // 活动标签的文件路径
}

// ConfigStore 负责配置与 会话的磁盘读写。
type ConfigStore struct {
	dir string
}

// NewConfigStore 返回位于用户配置目录的存储器。
// Windows 下为 %APPDATA%\LitePad。
func NewConfigStore() (*ConfigStore, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, "LitePad")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &ConfigStore{dir: dir}, nil
}

func (s *ConfigStore) configFile() string { return filepath.Join(s.dir, "config.json") }
func (s *ConfigStore) sessionFile() string {
	return filepath.Join(s.dir, "session.json")
}

// DefaultContextMenu 返回默认全开的右键菜单配置。
func DefaultContextMenu() ContextMenuPrefs {
	return ContextMenuPrefs{
		Clipboard:    true,
		Lines:        true,
		Transform:    true,
		Navigate:     true,
		View:         true,
		File:         true,
		ShowShortcut: true,
	}
}

// DefaultConfig 返回内置默认配置。
func DefaultConfig() Config {
	return Config{
		Theme:        "light",
		FontFamily:   "Cascadia Mono, Consolas, monospace",
		FontSize:     14,
		Wrap:         false,
		TabSize:      4,
		ShowWhite:    false,
		RecentFiles:  []string{},
		ContextMenu:  DefaultContextMenu(),
		Integrations: IntegrationPrefs{Formats: []string{}},
	}
}

// Normalize 修正越界或非法字段，并保证切片非 nil。
// 配置可能来自旧版本文件或被手工编辑，直接使用会导致界面异常。
func (c *Config) Normalize() {
	def := DefaultConfig()
	if c.Theme != "dark" {
		c.Theme = "light"
	}
	if strings.TrimSpace(c.FontFamily) == "" {
		c.FontFamily = def.FontFamily
	}
	if c.FontSize < 6 || c.FontSize > 96 {
		c.FontSize = def.FontSize
	}
	if c.TabSize < 1 || c.TabSize > 16 {
		c.TabSize = def.TabSize
	}
	if c.RecentFiles == nil {
		c.RecentFiles = []string{}
	}
	if c.Integrations.Formats == nil {
		c.Integrations.Formats = []string{}
	}
}

// LoadConfig 读取配置；文件不存在或损坏时返回默认配置。
func (s *ConfigStore) LoadConfig() (Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(s.configFile())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, err
	}
	// 记录原始 key，用于区分“用户显式关闭”与“旧配置文件缺少字段”
	var probe map[string]json.RawMessage
	_ = json.Unmarshal(data, &probe)
	if err := json.Unmarshal(data, &cfg); err != nil {
		return DefaultConfig(), err
	}
	// 旧版本配置文件没有 contextMenu 字段：补默认值，避免菜单被误清空
	if _, ok := probe["contextMenu"]; !ok {
		cfg.ContextMenu = DefaultContextMenu()
	}
	cfg.Normalize()
	return cfg, nil
}

// SaveConfig 将配置写入磁盘（先写临时文件再原子替换，避免断电/崩溃留下半截 JSON）。
func (s *ConfigStore) SaveConfig(cfg Config) error {
	cfg.Normalize()
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.configFile(), data, 0o644)
}

// PushRecent 将 path 插入最近文件列表头部（去重，最多保留 10 条）。
func PushRecent(list []string, path string) []string {
	out := make([]string, 0, len(list)+1)
	out = append(out, path)
	for _, p := range list {
		if p != path {
			out = append(out, p)
		}
	}
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

// SaveSession 保存会话。
func (s *ConfigStore) SaveSession(sess Session) error {
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.sessionFile(), data, 0o644)
}

// LoadSession 读取会话；不存在时返回空会话。
func (s *ConfigStore) LoadSession() (Session, error) {
	var sess Session
	data, err := os.ReadFile(s.sessionFile())
	if err != nil {
		return Session{}, err // os.ErrNotExist 由调用方忽略
	}
	err = json.Unmarshal(data, &sess)
	return sess, err
}

// writeFileAtomic 先写入同目录临时文件再原子替换目标文件。
// 直接覆盖写入时若进程崩溃，会留下截断的 JSON，导致配置/会话全部丢失。
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		if tmp != "" {
			_ = os.Remove(tmp) // 成功 rename 后 tmp 置空，不会误删目标
		}
	}()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	tmp = ""
	return nil
}
