package core

import (
	"path/filepath"
	"strings"
)

// DetectLanguage 根据文件扩展名返回语言标识，
// 前端依据该标识装载对应的 CodeMirror 语法解析器。
// 返回空串表示无高亮（纯文本）。
// 注意：该映射需与 frontend/src/editor.js 的 langForPath 保持一致（有单测校验清单）。
func DetectLanguage(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".go":
		return "go"
	case ".py", ".pyw", ".pyi":
		return "python"
	case ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx":
		return "javascript"
	case ".json", ".jsonc", ".json5":
		return "json"
	case ".md", ".markdown", ".mkd":
		return "markdown"
	case ".html", ".htm", ".xhtml", ".vue", ".svelte":
		return "html"
	case ".xml", ".svg", ".xsl", ".xslt", ".plist", ".csproj", ".vbproj", ".resx", ".config":
		return "xml"
	case ".c", ".h", ".cpp", ".cxx", ".cc", ".hpp", ".hh", ".hxx":
		return "cpp"
	case ".css", ".scss", ".less":
		return "css"
	case ".yaml", ".yml":
		return "yaml"
	case ".sql":
		return "sql"
	default:
		return ""
	}
}
