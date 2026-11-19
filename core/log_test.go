package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// captureLogger 创建一个临时目录下的 Logger（替换 UserConfigDir 语义）。
// 直接打开临时文件测试，绕开 UserConfigDir 依赖。
func captureLogger(t *testing.T) (*Logger, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "litepad.log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	return &Logger{file: f, path: path}, path
}

func readLog(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestLoggerWritesInfo(t *testing.T) {
	l, path := captureLogger(t)
	defer l.Close()

	l.write(levelInfo, "main.go:42", "hello %s", "world")
	content := readLog(t, path)
	if !strings.Contains(content, "[INFO]") || !strings.Contains(content, "hello world") {
		t.Errorf("expected INFO message, got: %s", content)
	}
	if !strings.Contains(content, "main.go:42") {
		t.Errorf("expected caller in log, got: %s", content)
	}
}

func TestLoggerLevels(t *testing.T) {
	l, path := captureLogger(t)
	defer l.Close()

	l.write(levelInfo, "a.go:1", "info msg")
	l.write(levelWarn, "b.go:2", "warn msg")
	l.write(levelError, "c.go:3", "error msg")
	content := readLog(t, path)

	for _, tag := range []string{"[INFO]", "[WARN]", "[ERROR]"} {
		if !strings.Contains(content, tag) {
			t.Errorf("missing level tag %s in %s", tag, content)
		}
	}
}

func TestLoggerNilSafety(t *testing.T) {
	var l *Logger
	// 所有方法对 nil receiver 安全
	l.write(levelInfo, "x", "ok")
	l.Close()
}

func TestSetEffectPackageFuncsNilSafe(t *testing.T) {
	// defaultLogger 未初始化时，Info/Warn/Error/LogPanic 都应静默。
	defaultLogger = nil
	Info("no-op: %d", 1)
	Warn("no-op: %s", "x")
	Error("no-op: %v", 1.0)
	// 不应 panic
	LogPanic("anything")
}

func TestLoggerRotate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "litepad.log")

	// 直接创建一个已满的日志文件
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	big := make([]byte, logFileMaxSize+100)
	for i := range big {
		big[i] = 'x'
	}
	f.Write(big)
	f.Close()

	f, err = os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	l := &Logger{file: f, path: path}
	defer l.Close()

	// 触发轮转
	l.mu.Lock()
	l.rotateIfNeeded()
	l.mu.Unlock()

	// 原文件应被移到 .1
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Errorf("expected backup %s.1 to exist after rotate: %v", path, err)
	}
	// 原文件应已截断（被重新创建）
	fi, _ := os.Stat(path)
	if fi.Size() >= logFileMaxSize {
		t.Errorf("log file not truncated after rotate, size=%d", fi.Size())
	}
}
