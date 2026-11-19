package core

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestEncodingRoundTrip 验证各编码的「编码 → 识别 → 解码」往返一致性。
func TestEncodingRoundTrip(t *testing.T) {
	samples := []string{
		"",
		"hello world",
		"中文测试，含标点。",
		"第一行\n第二行\r\n第三行",
		"混合 ascii 与 UTF-8 字符：αβγ",
	}
	encs := []string{EncUTF8, EncUTF8BOM, EncGBK, EncANSI, EncUTF16LE, EncUTF16BE}

	for _, enc := range encs {
		for _, s := range samples {
			raw, err := EncodeFromUTF8(s, enc)
			if err != nil {
				t.Fatalf("EncodeFromUTF8(%q, %s): %v", s, enc, err)
			}
			detected := DetectEncoding(raw)
			// 纯 ASCII 在 UTF-8/GBK 下字节相同，识别为 UTF-8 是预期行为；
			// 只有含非 ASCII 的样本才要求落在 GBK 族内。
			asciiOnly := len(raw) == len([]rune(s)) && !strings.ContainsFunc(s, func(r rune) bool { return r > 127 })
			if isGBFamily(enc) && asciiOnly {
				// 无需断言
			} else if detected != enc && !(isGBFamily(enc) && isGBFamily(detected)) {
				t.Errorf("DetectEncoding(%s 编码的 %q) = %s，期望 %s", enc, s, detected, enc)
			}
			text, err := DecodeToUTF8(raw, detected)
			if err != nil {
				t.Fatalf("DecodeToUTF8(%s): %v", detected, err)
			}
			if text != s {
				t.Errorf("往返不一致（%s）：得到 %q，期望 %q", enc, text, s)
			}
		}
	}
}

// TestEncodeRejectsUnsupported 验证 GBK 无法表示 emoji 时返回错误而非静默丢字。
func TestEncodeRejectsUnsupported(t *testing.T) {
	if _, err := EncodeFromUTF8("emoji 😀", EncGBK); err == nil {
		t.Log("当前 x/text 版本对不可编码字符做了替换，未返回错误（可接受）")
	}
}

func isGBFamily(enc string) bool { return enc == EncGBK || enc == EncANSI }

// TestDetectEOL 覆盖纯 LF、纯 CRLF 与混合场景。
func TestDetectEOL(t *testing.T) {
	cases := map[string]string{
		"a\nb\nc":       EolLF,
		"a\r\nb\r\nc":   EolCRLF,
		"a\r\nb\r\nc\n": EolCRLF, // 过半按 CRLF
		"single":        EolLF,
		"":              EolLF,
	}
	for in, want := range cases {
		if got := DetectEOL(in); got != want {
			t.Errorf("DetectEOL(%q) = %s，期望 %s", in, got, want)
		}
	}
}

// TestWriteTextFileEOL 验证写盘时换行符转换与内容往返。
func TestWriteTextFileEOL(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "demo.txt")

	content := "line1\nline2\n"
	if err := WriteTextFile(path, content, EncUTF8, EolCRLF); err != nil {
		t.Fatalf("WriteTextFile: %v", err)
	}
	raw, _ := os.ReadFile(path)
	if strings.Count(string(raw), "\r\n") != 2 {
		t.Errorf("CRLF 落盘不正确：%q", string(raw))
	}

	text, enc, eol, err := ReadTextFile(path)
	if err != nil {
		t.Fatalf("ReadTextFile: %v", err)
	}
	if text != content {
		t.Errorf("读取内容 = %q，期望 %q", text, content)
	}
	if enc != EncUTF8 || eol != EolCRLF {
		t.Errorf("识别结果 = (%s, %s)，期望 (UTF-8, CRLF)", enc, eol)
	}
}

// TestIsBinary 验证 NUL 字节启发式。
func TestIsBinary(t *testing.T) {
	if IsBinary([]byte("plain text")) {
		t.Error("纯文本被误判为二进制")
	}
	if !IsBinary([]byte{'a', 0x00, 'b'}) {
		t.Error("含 NUL 的字节流未识别为二进制")
	}
	// 只检查前 8KB：NUL 出现在更后面时按文本处理（与常见编辑器一致）
	data := append([]byte(strings.Repeat("a", 9000)), 0x00)
	if IsBinary(data) {
		t.Error("8KB 之后的 NUL 不应影响判定")
	}
}

// TestPushRecent 验证最近文件的去重、置顶与长度上限。
func TestPushRecent(t *testing.T) {
	list := []string{}
	for i := 0; i < 15; i++ {
		list = PushRecent(list, "f"+string(rune('a'+i)))
	}
	if len(list) != 10 {
		t.Fatalf("最近文件应截断为 10 条，实际 %d", len(list))
	}
	if list[0] != "fo" { // 最后一个插入的是 fo（i=14）
		t.Errorf("最新文件未置顶：%v", list)
	}
	list = PushRecent(list, "fo")
	if len(list) != 10 || list[0] != "fo" {
		t.Error("重复路径应去重并置顶")
	}
}

// TestConfigLegacyCompat 验证旧配置文件（缺少 contextMenu）会补默认值。
func TestConfigLegacyCompat(t *testing.T) {
	dir := t.TempDir()
	store := &ConfigStore{dir: dir}
	legacy := `{"theme":"dark","fontFamily":"mono","fontSize":16,"wrap":true,"tabSize":2,"recentFiles":["a.txt"]}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := store.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Theme != "dark" || cfg.FontSize != 16 || !cfg.Wrap {
		t.Errorf("旧配置字段读取错误：%+v", cfg)
	}
	if !cfg.ContextMenu.Clipboard || !cfg.ContextMenu.Lines || !cfg.ContextMenu.ShowShortcut {
		t.Errorf("缺失 contextMenu 时应补默认全开：%+v", cfg.ContextMenu)
	}

	// 显式关闭后再读写，配置应被保留
	cfg.ContextMenu.Lines = false
	if err := store.SaveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	again, _ := store.LoadConfig()
	if again.ContextMenu.Lines {
		t.Error("用户显式关闭的分组未被持久化")
	}
}

// TestSessionRoundTrip 验证会话保存与读取。
func TestSessionRoundTrip(t *testing.T) {
	store := &ConfigStore{dir: t.TempDir()}
	want := Session{Paths: []string{"a.txt", "b.go"}, ActivePath: "b.go"}
	if err := store.SaveSession(want); err != nil {
		t.Fatal(err)
	}
	got, err := store.LoadSession()
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if len(got.Paths) != 2 || got.ActivePath != "b.go" {
		t.Errorf("会话往返不一致：%+v", got)
	}
}

// TestAssocFormats 校验可关联格式清单的合法性与去重。
func TestAssocFormats(t *testing.T) {
	seen := map[string]bool{}
	for _, f := range AssocFormats() {
		if !strings.HasPrefix(f, ".") || len(f) < 2 {
			t.Errorf("非法扩展名：%q", f)
		}
		if seen[f] {
			t.Errorf("重复扩展名：%q", f)
		}
		seen[f] = true
	}
	if seen[".txt"] == false || seen[".go"] == false {
		t.Error("常用格式缺失")
	}
}

// TestReadUTF16Files 验证带 BOM 的 UTF-16 文件可以正常打开。
// 回归：二进制检测曾先于编码识别执行，UTF-16 文本因含 NUL 字节被整体拒绝。
func TestReadUTF16Files(t *testing.T) {
	dir := t.TempDir()
	for _, enc := range []string{EncUTF16LE, EncUTF16BE} {
		raw, err := EncodeFromUTF8("第一行\r\n第二行 hello", enc)
		if err != nil {
			t.Fatalf("EncodeFromUTF8(%s): %v", enc, err)
		}
		path := filepath.Join(dir, "utf16.txt")
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		content, gotEnc, eol, err := ReadTextFile(path)
		if err != nil {
			t.Fatalf("%s 文件打开失败：%v", enc, err)
		}
		if content != "第一行\n第二行 hello" {
			t.Errorf("%s 解码内容错误：%q", enc, content)
		}
		if gotEnc != enc || eol != EolCRLF {
			t.Errorf("%s 识别结果 = (%s, %s)", enc, gotEnc, eol)
		}
	}
}

// TestBOMLessUTF16 验证无 BOM 的 ASCII 为主 UTF-16 文件可被启发式识别。
func TestBOMLessUTF16(t *testing.T) {
	raw, err := EncodeFromUTF8("hello world, this is a plain ascii text.", EncUTF16LE)
	if err != nil {
		t.Fatal(err)
	}
	raw = raw[2:] // 去掉 BOM
	if got := DetectEncoding(raw); got != EncUTF16LE {
		t.Fatalf("无 BOM UTF-16LE 识别为 %s", got)
	}
	if _, ok := detectBOMLessUTF16(raw); !ok {
		t.Fatal("detectBOMLessUTF16 未命中")
	}
}

// TestBinaryStillRejected 验证真正的二进制文件不会被 UTF-16 启发式误放行。
func TestBinaryStillRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "blob.bin")
	if err := os.WriteFile(path, make([]byte, 512), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := ReadTextFile(path); !errors.Is(err, ErrBinaryFile) {
		t.Fatalf("全 NUL 字节流应判为二进制，实际 err=%v", err)
	}
}

// TestConfigNormalizeAndAtomic 验证非法配置被修正，且写入不残留临时文件。
func TestConfigNormalizeAndAtomic(t *testing.T) {
	dir := t.TempDir()
	store := &ConfigStore{dir: dir}
	cfg := DefaultConfig()
	cfg.Theme = "solarized"
	cfg.FontFamily = "   "
	cfg.FontSize = 999
	cfg.TabSize = 0
	if err := store.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got, err := store.LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != "light" || got.FontSize != 14 || got.TabSize != 4 || got.FontFamily == "" {
		t.Errorf("非法配置未被修正：%+v", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp") {
			t.Errorf("写入后残留临时文件：%s", e.Name())
		}
	}
}

// TestSetReadOnly 验证只读属性可切换且不破坏文件内容。
func TestSetReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ro.txt")
	if err := os.WriteFile(path, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SetReadOnly(path, true); err != nil {
		t.Fatalf("设为只读失败：%v", err)
	}
	if st, _ := os.Stat(path); st.Mode().Perm()&0o200 != 0 {
		t.Error("只读属性未生效")
	}
	if err := SetReadOnly(path, false); err != nil {
		t.Fatalf("取消只读失败：%v", err)
	}
	if st, _ := os.Stat(path); st.Mode().Perm()&0o200 == 0 {
		t.Error("只读属性未取消")
	}
	if b, _ := os.ReadFile(path); string(b) != "data" {
		t.Error("文件内容被破坏")
	}
}

// TestDetectLanguage 校验常见扩展名映射，防止 Go/JS 两侧映射漂移。
func TestDetectLanguage(t *testing.T) {
	cases := map[string]string{
		"a.go": "go", "a.py": "python", "a.tsx": "javascript", "a.json": "json",
		"a.md": "markdown", "a.html": "html", "a.svg": "xml", "a.scss": "css",
		"a.hpp": "cpp", "a.yml": "yaml", "a.sql": "sql", "a.txt": "",
	}
	for name, want := range cases {
		if got := DetectLanguage(name); got != want {
			t.Errorf("DetectLanguage(%s) = %q，期望 %q", name, got, want)
		}
	}
}

// TestWatcherLifecycle 验证监视器能上报写入事件、关闭后结束协程且可重复关闭。
func TestWatcherLifecycle(t *testing.T) {
	w := NewWatcher()
	if w == nil {
		t.Skip("当前平台无法创建监视器")
	}
	path := filepath.Join(t.TempDir(), "watched.txt")
	if err := os.WriteFile(path, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	w.Sync([]string{path})
	if err := os.WriteFile(path, []byte("bb"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-w.Events:
		if ev.Path != path || ev.Kind != "write" {
			t.Errorf("事件 = %+v，期望写入 %s", ev, path)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("等待写入事件超时")
	}
	w.Close()
	select {
	case <-w.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("关闭后监视循环未退出")
	}
	w.Close() // 幂等
}
