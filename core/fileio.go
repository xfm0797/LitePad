package core

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// 换行符常量。
const (
	EolLF   = "LF"
	EolCRLF = "CRLF"
)

var (
	ErrBinaryFile   = errors.New("疑似二进制文件，无法以文本方式打开")
	ErrFileTooLarge = fmt.Errorf("文件超过 %d MB，已超出轻量编辑器的安全上限（避免一次性载入导致内存耗尽）", MaxOpenBytes>>20)
)

// MaxOpenBytes 是单文件打开上限。编辑器会把整个文件读入内存并经 IPC 传给前端，
// 超过该阈值时拒绝打开并给出明确提示，比静默卡死或 OOM 更可控。
const MaxOpenBytes = 128 << 20

// ReadTextFile 读取磁盘文件，自动识别编码与换行符，
// 统一返回 UTF-8 内容、识别出的编码与换行符类型。
func ReadTextFile(path string) (content string, encoding string, eol string, err error) {
	// 先用 Stat 判断大小：os.ReadFile 会一次性分配并读入整个文件，
	// 读完再比较上限时超大文件早已占满内存，限制形同虚设。
	if st, statErr := os.Stat(path); statErr == nil && st.Size() > MaxOpenBytes {
		return "", "", "", ErrFileTooLarge
	}
	f, err := os.Open(path)
	if err != nil {
		return "", "", "", err
	}
	defer f.Close()
	// 多读 1 字节：防止文件在 Stat 与读取之间被追加，导致绕过上限。
	raw, err := io.ReadAll(io.LimitReader(f, MaxOpenBytes+1))
	if err != nil {
		return "", "", "", err
	}
	if len(raw) > MaxOpenBytes {
		return "", "", "", ErrFileTooLarge
	}
	// 二进制检测必须在编码识别之前，但 UTF-16 文本天然含 NUL 字节：
	// 有 BOM 时直接放行；无 BOM 时先看 NUL 分布是否像 UTF-16。
	if !HasBOM(raw) && IsBinary(raw) {
		if _, ok := detectBOMLessUTF16(raw); !ok {
			return "", "", "", ErrBinaryFile
		}
	}
	enc := DetectEncoding(raw)
	text, err := DecodeToUTF8(raw, enc)
	if err != nil {
		return "", "", "", err
	}
	// 先判定原始换行类型，再统一规范为 \n：
	// 编辑器内部一律使用 \n，否则“切换为 LF 后保存”会因为残留 \r 而失效。
	eol = DetectEOL(text)
	text = normalizeEOL(text)
	return text, enc, eol, nil
}

// WriteTextFile 将 UTF-8 内容按指定编码、换行符写盘。
// 编辑器内部内容以 \n 为行分隔符；eol 为 CRLF 时写盘前统一转换。
func WriteTextFile(path string, content string, encoding string, eol string) error {
	content = normalizeEOL(content) // 无论目标格式，先规范为 \n
	if eol == EolCRLF {
		content = strings.ReplaceAll(content, "\n", "\r\n")
	}
	raw, err := EncodeFromUTF8(content, encoding)
	if err != nil {
		// 常见于目标编码（GBK/ANSI）无法表示 emoji、生僻字等字符
		return fmt.Errorf("按 %s 编码保存失败：文本中包含该编码不支持的字符，请切换为 UTF-8 后重试（%w）", encoding, err)
	}
	// 保留原文件权限（Windows 下对应只读属性）；文件不存在时使用默认权限。
	perm := os.FileMode(0o644)
	if st, statErr := os.Stat(path); statErr == nil {
		perm = st.Mode().Perm()
	}
	if err := os.WriteFile(path, raw, perm); err != nil {
		return fmt.Errorf("写入文件失败：%w", err)
	}
	return nil
}

// normalizeEOL 将 CRLF 与孤立 CR 统一为 LF（编辑器内部表示）。
func normalizeEOL(s string) string {
	if !strings.ContainsRune(s, '\r') {
		return s
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

// DetectEOL 统计 \r\n 与 \n 的占比，判定文件换行符。
func DetectEOL(text string) string {
	crlf := strings.Count(text, "\r\n")
	totalLF := strings.Count(text, "\n")
	if totalLF == 0 {
		return EolLF
	}
	if crlf*2 >= totalLF { // 过半为 CRLF 即按 CRLF 处理
		return EolCRLF
	}
	return EolLF
}

// IsBinary 通过特征字节判断是否为二进制文件：
// 含 NUL 字节即视为二进制（与 GNU diff 的启发式一致）。
func IsBinary(data []byte) bool {
	limit := len(data)
	if limit > 8192 {
		limit = 8192
	}
	return bytes.IndexByte(data[:limit], 0x00) >= 0
}
