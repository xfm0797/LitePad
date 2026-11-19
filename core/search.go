package core

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	searchMaxFileBytes = 2 << 20 // 单文件超过 2MB 跳过，避免大日志拖慢搜索
	searchMaxResults   = 2000    // 结果硬上限
	searchMaxFiles     = 20000   // 扫描文件数上限
	searchSnippetRunes = 400     // 单条结果展示的最大字符数
)

// 这些目录几乎不会是需要搜索的文本源码，递归进入只会浪费时间。
var searchSkipDirs = map[string]bool{
	".git": true, ".svn": true, ".hg": true, "node_modules": true,
}

// SearchOptions 控制“在文件中查找”的匹配方式。
type SearchOptions struct {
	CaseSensitive bool `json:"caseSensitive"`
	WholeWord     bool `json:"wholeWord"`
	MaxResults    int  `json:"maxResults"`
}

// SearchResult 是一行命中的位置与原文。
type SearchResult struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`   // 1 起始
	Column int    `json:"column"` // 1 起始（按字符计数）
	Text   string `json:"text"`   // 行内容（已截断过长部分）
}

// SearchResultSet 汇总一次搜索。
type SearchResultSet struct {
	Results   []SearchResult `json:"results"`
	Scanned   int            `json:"scanned"`
	Truncated bool           `json:"truncated"`
}

// SearchInFiles 在 root 下递归查找 query（纯文本，非正则）。
// 只读取普通文件，跳过二进制与常见依赖目录；权限错误直接忽略。
func SearchInFiles(root, query string, opts SearchOptions) (SearchResultSet, error) {
	out := SearchResultSet{Results: []SearchResult{}}
	query = strings.TrimSpace(query)
	if query == "" {
		return out, errors.New("查找内容不能为空")
	}
	root = strings.TrimSpace(root)
	if root == "" {
		root = "."
	}
	st, err := os.Stat(root)
	if err != nil {
		return out, err
	}
	if !st.IsDir() {
		root = filepath.Dir(root)
	}

	limit := opts.MaxResults
	if limit <= 0 {
		limit = 500
	}
	if limit > searchMaxResults {
		limit = searchMaxResults
	}

	pattern := regexp.QuoteMeta(query)
	if !opts.CaseSensitive {
		pattern = "(?i:" + pattern + ")"
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return out, err
	}

	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil // 无权限等错误：跳过该条目继续
		}
		if d.IsDir() {
			if path != root && searchSkipDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if out.Scanned >= searchMaxFiles {
			out.Truncated = true
			return fs.SkipAll
		}
		out.Scanned++
		info, err := d.Info()
		if err != nil || info.Size() > searchMaxFileBytes {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || isBinary(raw) {
			return nil
		}
		scanFile(path, string(raw), re, opts.WholeWord, limit, &out)
		if len(out.Results) >= limit {
			out.Truncated = true
			return fs.SkipAll
		}
		return nil
	})
	if walkErr != nil {
		return out, walkErr
	}
	return out, nil
}

func scanFile(path, content string, re *regexp.Regexp, wholeWord bool, limit int, out *SearchResultSet) {
	lines := strings.Split(content, "\n")
	for i, rawLine := range lines {
		line := strings.TrimSuffix(rawLine, "\r")
		for _, loc := range re.FindAllStringIndex(line, -1) {
			if wholeWord && !wordBoundary(line, loc[0], loc[1]) {
				continue
			}
			out.Results = append(out.Results, SearchResult{
				Path:   path,
				Line:   i + 1,
				Column: utf8.RuneCountInString(line[:loc[0]]) + 1,
				Text:   clipLine(line),
			})
			if len(out.Results) >= limit {
				return
			}
		}
	}
}

// isBinary 用前 8KB 是否含 NUL 判断，与前端打开文件时的策略一致。
func isBinary(raw []byte) bool {
	head := raw
	if len(head) > 8000 {
		head = head[:8000]
	}
	for _, b := range head {
		if b == 0 {
			return true
		}
	}
	return false
}

func wordBoundary(s string, start, end int) bool {
	if start > 0 {
		r, _ := utf8.DecodeLastRuneInString(s[:start])
		if isWordRune(r) {
			return false
		}
	}
	if end < len(s) {
		r, _ := utf8.DecodeRuneInString(s[end:])
		if isWordRune(r) {
			return false
		}
	}
	return true
}

func isWordRune(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

func clipLine(s string) string {
	s = strings.TrimRight(s, " \t")
	if utf8.RuneCountInString(s) <= searchSnippetRunes {
		return s
	}
	r := []rune(s)
	return string(r[:searchSnippetRunes]) + "…"
}
