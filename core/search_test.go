package core

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSearchInFilesBasic(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.txt"), "hello world\nsecond Hello line\n")
	writeTestFile(t, filepath.Join(dir, "sub", "b.go"), "fmt.Println(\"hello\")\n")

	got, err := SearchInFiles(dir, "hello", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Results) != 3 {
		t.Fatalf("期望 3 条结果，得到 %d：%+v", len(got.Results), got.Results)
	}
	first := got.Results[0]
	if first.Line != 1 || first.Column != 1 {
		t.Errorf("首条位置错误：%+v", first)
	}
	if got.Scanned != 2 {
		t.Errorf("扫描文件数 = %d，期望 2", got.Scanned)
	}
}

func TestSearchInFilesCaseSensitive(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.txt"), "Hello\nhello\n")

	got, err := SearchInFiles(dir, "hello", SearchOptions{CaseSensitive: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Results) != 1 || got.Results[0].Line != 2 {
		t.Fatalf("区分大小写结果错误：%+v", got.Results)
	}
}

func TestSearchInFilesWholeWord(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.txt"), "foo foobar foo_bar foo\n")

	got, err := SearchInFiles(dir, "foo", SearchOptions{WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	var lines []int
	for _, r := range got.Results {
		lines = append(lines, r.Column)
	}
	if len(lines) != 2 || lines[0] != 1 || lines[1] != 20 {
		t.Fatalf("整词匹配错误：%+v", got.Results)
	}
}

func TestSearchInFilesSkipsIgnoredDirsAndBinary(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "node_modules", "dep.js"), "needle\n")
	writeTestFile(t, filepath.Join(dir, "bin.dat"), "needle\x00binary")
	writeTestFile(t, filepath.Join(dir, "ok.txt"), "needle\n")

	got, err := SearchInFiles(dir, "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Results) != 1 || filepath.Base(got.Results[0].Path) != "ok.txt" {
		t.Fatalf("应只命中 ok.txt：%+v", got.Results)
	}
}

func TestSearchInFilesResultLimit(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "a.txt"), "x\nx\nx\nx\nx\n")

	got, err := SearchInFiles(dir, "x", SearchOptions{MaxResults: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Results) != 2 || !got.Truncated {
		t.Fatalf("结果上限未生效：%+v", got)
	}
}

func TestSearchInFilesRejectsEmptyQuery(t *testing.T) {
	if _, err := SearchInFiles(t.TempDir(), "   ", SearchOptions{}); err == nil {
		t.Fatal("空查询应返回错误")
	}
}
