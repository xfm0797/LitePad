// Package core 提供编码识别与转换能力（UTF-8 / UTF-8 BOM / GBK / GB18030(ANSI) / UTF-16）。
package core

import (
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// 编码名称常量（对外统一使用这些字符串标识）。
const (
	EncUTF8    = "UTF-8"
	EncUTF8BOM = "UTF-8 BOM"
	EncGBK     = "GBK"
	EncANSI    = "ANSI (GB18030)"
	EncUTF16LE = "UTF-16 LE"
	EncUTF16BE = "UTF-16 BE"
)

var (
	bomUTF8    = []byte{0xEF, 0xBB, 0xBF}
	bomUTF16LE = []byte{0xFF, 0xFE}
	bomUTF16BE = []byte{0xFE, 0xFF}
)

// SupportedEncodings 返回支持的编码列表（供菜单渲染）。
func SupportedEncodings() []string {
	return []string{EncUTF8, EncUTF8BOM, EncGBK, EncANSI, EncUTF16LE, EncUTF16BE}
}

// DetectEncoding 根据字节内容推断编码：
//  1. 优先识别 BOM；
//  2. 无 BOM 时按 NUL 分布启发式识别 UTF-16（Windows 记事本另存的 UTF-16 可能无 BOM）；
//  3. 若为合法 UTF-8 则视为 UTF-8；
//  4. 否则尝试 GB18030 解码，若成功视为 ANSI（中文 Windows 默认代码页）；
//  5. 全部失败则回退 GBK。
func DetectEncoding(data []byte) string {
	if len(data) >= 3 && string(data[:3]) == string(bomUTF8) {
		return EncUTF8BOM
	}
	if len(data) >= 2 && string(data[:2]) == string(bomUTF16LE) {
		return EncUTF16LE
	}
	if len(data) >= 2 && string(data[:2]) == string(bomUTF16BE) {
		return EncUTF16BE
	}
	if enc, ok := detectBOMLessUTF16(data); ok {
		return enc
	}
	if utf8.Valid(data) {
		return EncUTF8
	}
	// GB18030 是 GBK 的超集且允许四字节序列；解码无替换符即认为匹配。
	dec := simplifiedchinese.GB18030.NewDecoder()
	out, _, err := transform.Bytes(dec, data)
	if err == nil && !strings.ContainsRune(string(out), utf8.RuneError) {
		return EncANSI
	}
	return EncGBK
}

// detectBOMLessUTF16 在没有 BOM 时通过 NUL 字节的奇偶分布推断 UTF-16。
// 纯 ASCII 的 UTF-16LE 形如 41 00 42 00（NUL 全在奇数位），BE 则相反；
// 要求 NUL 占比足够高且解码后无替换符，避免把普通二进制误判为文本。
func detectBOMLessUTF16(data []byte) (string, bool) {
	if len(data) < 8 || len(data)%2 != 0 {
		return "", false
	}
	limit := len(data)
	if limit > 4096 {
		limit = 4096
	}
	even, odd := 0, 0
	for i := 0; i < limit; i++ {
		if data[i] == 0 {
			if i%2 == 0 {
				even++
			} else {
				odd++
			}
		}
	}
	nuls := even + odd
	// 文本中若以 CJK 为主，NUL 比例会低到 0，此时只能靠 BOM 识别；
	// 这里只覆盖 NUL 占比 ≥ 20% 的典型 ASCII 混合文本。
	if nuls*5 < limit {
		return "", false
	}
	var enc string
	switch {
	case even*10 >= nuls*9:
		enc = EncUTF16BE
	case odd*10 >= nuls*9:
		enc = EncUTF16LE
	default:
		return "", false
	}
	text, err := decodeUTF16(data, endianOf(enc))
	if err != nil || strings.ContainsRune(text, utf8.RuneError) {
		return "", false
	}
	// 控制字符比例过高说明更像二进制：文本中除 \t\r\n 外不应出现大量 <0x20 的字符。
	ctrl, total := 0, 0
	for _, r := range text {
		total++
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			ctrl++
		}
	}
	if total == 0 || ctrl*100 > total {
		return "", false
	}
	return enc, true
}

func endianOf(enc string) unicode.Endianness {
	if enc == EncUTF16BE {
		return unicode.BigEndian
	}
	return unicode.LittleEndian
}

// HasBOM 判断字节流是否带 BOM。
func HasBOM(data []byte) bool {
	if len(data) >= 3 && string(data[:3]) == string(bomUTF8) {
		return true
	}
	if len(data) >= 2 && (string(data[:2]) == string(bomUTF16LE) || string(data[:2]) == string(bomUTF16BE)) {
		return true
	}
	return false
}

// DecodeToUTF8 将原始字节按指定编码解码为 UTF-8 字符串。
// 对带 BOM 的编码自动剥离 BOM，返回值可直接送入编辑器。
func DecodeToUTF8(data []byte, enc string) (string, error) {
	// 先剥离 BOM
	if len(data) >= 3 && string(data[:3]) == string(bomUTF8) {
		data = data[3:]
	} else if len(data) >= 2 && string(data[:2]) == string(bomUTF16LE) {
		data = data[2:]
	} else if len(data) >= 2 && string(data[:2]) == string(bomUTF16BE) {
		data = data[2:]
	}

	switch enc {
	case EncUTF8, EncUTF8BOM:
		return string(data), nil
	case EncGBK:
		out, _, err := transform.Bytes(simplifiedchinese.GBK.NewDecoder(), data)
		return string(out), err
	case EncANSI:
		out, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), data)
		return string(out), err
	case EncUTF16LE:
		return decodeUTF16(data, unicode.LittleEndian)
	case EncUTF16BE:
		return decodeUTF16(data, unicode.BigEndian)
	default:
		return "", errors.New("不支持的编码: " + enc)
	}
}

// EncodeFromUTF8 将 UTF-8 字符串按指定编码编码为字节流。
// enc 为带 BOM 的编码时自动追加 BOM。
func EncodeFromUTF8(content string, enc string) ([]byte, error) {
	var out []byte
	var err error

	switch enc {
	case EncUTF8, EncUTF8BOM:
		out = []byte(content)
	case EncGBK:
		out, _, err = transform.Bytes(simplifiedchinese.GBK.NewEncoder(), []byte(content))
	case EncANSI:
		out, _, err = transform.Bytes(simplifiedchinese.GB18030.NewEncoder(), []byte(content))
	case EncUTF16LE:
		out, err = encodeUTF16(content, unicode.LittleEndian)
	case EncUTF16BE:
		out, err = encodeUTF16(content, unicode.BigEndian)
	default:
		return nil, errors.New("不支持的编码: " + enc)
	}
	if err != nil {
		return nil, err
	}

	switch enc {
	case EncUTF8BOM:
		out = append(bomUTF8, out...)
	case EncUTF16LE:
		out = append(bomUTF16LE, out...)
	case EncUTF16BE:
		out = append(bomUTF16BE, out...)
	}
	return out, nil
}

func decodeUTF16(data []byte, bo unicode.Endianness) (string, error) {
	dec := unicode.UTF16(bo, unicode.IgnoreBOM).NewDecoder()
	out, _, err := transform.Bytes(dec, data)
	return string(out), err
}

func encodeUTF16(content string, bo unicode.Endianness) ([]byte, error) {
	enc := unicode.UTF16(bo, unicode.IgnoreBOM).NewEncoder()
	out, _, err := transform.Bytes(enc, []byte(content))
	return out, err
}
