package core

// AssocStatus 描述当前系统集成状态（以 Windows 注册表为准）。
type AssocStatus struct {
	Supported      bool     `json:"supported"`      // 当前平台是否支持（非 Windows 为 false）
	Exe            string   `json:"exe"`            // 当前可执行文件路径
	Formats        []string `json:"formats"`        // 已建立关联的扩展名（含点）
	DefaultFormats []string `json:"defaultFormats"` // 其中被设为默认打开方式的扩展名
	ExplorerMenu   bool     `json:"explorerMenu"`   // 是否注册了资源管理器右键菜单
	AppRegistered  bool     `json:"appRegistered"`  // 是否登记到「打开方式」应用列表
}

// AssocFormats 返回可关联的常见文本/代码格式（前端设置页展示用）。
func AssocFormats() []string {
	return []string{
		".txt", ".md", ".markdown", ".log", ".ini", ".cfg", ".conf",
		".json", ".yaml", ".yml", ".toml", ".xml", ".csv",
		".go", ".py", ".js", ".mjs", ".ts", ".jsx", ".tsx",
		".html", ".htm", ".css", ".scss", ".sql",
		".c", ".h", ".cpp", ".hpp", ".java", ".rs", ".sh", ".bat", ".ps1",
	}
}
