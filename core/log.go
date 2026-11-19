// Package core 内建一个极简轮转日志器，无第三方依赖。
// 日志目录：UserConfigDir/LitePad/logs/litepad.log
// 轮转：单文件 ≤ 2 MB，保留 3 份历史备份。
// 生产代码通过 core.Info/Warn/Error 写日志；main.go 在启动时 InitLogger()。

package core

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"
)

const (
	logFileMaxSize = 2 * 1024 * 1024 // 2 MB
	logBackupCount = 3
)

type logLevel int

const (
	levelDebug logLevel = iota
	levelInfo
	levelWarn
	levelError
)

// Logger 是文件写入安全的极简 logger。
type Logger struct {
	mu     sync.Mutex
	file   *os.File
	path   string
	closed bool
}

var defaultLogger *Logger

// InitLogger 打开（或创建）日志文件，返回 logger 实例。
// 路径不可用时退回 os.TempDir()；彻底失败返回 error。
func InitLogger() (*Logger, error) {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	logDir := filepath.Join(dir, "LitePad", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(logDir, "litepad.log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	l := &Logger{file: f, path: path}
	defaultLogger = l
	l.write(levelInfo, "log.go", "==== LitePad session start ====")
	return l, nil
}

// Close 关闭日志文件（defer 在 main 里调用）。
func (l *Logger) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		ts := time.Now().Format("2006-01-02 15:04:05")
		_, _ = fmt.Fprintf(l.file, "%s [INFO] log.go ==== LitePad session end ====\n", ts)
		_ = l.file.Close()
		l.file = nil
		l.closed = true
	}
}

// rotateIfNeeded 达到阈值时轮转。调用方必须已持 l.mu。
func (l *Logger) rotateIfNeeded() {
	fi, err := os.Stat(l.path)
	if err != nil || fi.Size() < logFileMaxSize {
		return
	}
	_ = l.file.Close()
	// 删除最老的备份
	_ = os.Remove(l.path + "." + strconv.Itoa(logBackupCount))
	// .log.N-1 → .log.N
	for i := logBackupCount - 1; i >= 1; i-- {
		src := l.path + "." + strconv.Itoa(i)
		dst := l.path + "." + strconv.Itoa(i+1)
		_ = os.Rename(src, dst)
	}
	// .log → .log.1
	_ = os.Rename(l.path, l.path+".1")
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		l.file = f
	}
}

func (l *Logger) write(level logLevel, caller string, format string, args ...any) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || l.file == nil {
		return
	}
	l.rotateIfNeeded()
	var levelStr string
	switch level {
	case levelInfo:
		levelStr = "INFO"
	case levelWarn:
		levelStr = "WARN"
	case levelError:
		levelStr = "ERROR"
	default:
		levelStr = "DEBUG"
	}
	ts := time.Now().Format("2006-01-02 15:04:05")
	msg := fmt.Sprintf(format, args...)
	_, _ = fmt.Fprintf(l.file, "%s [%s] %s %s\n", ts, levelStr, caller, msg)
}

// stack 返回当前 goroutine 的栈帧（skip=2 跳过 stack→caller→... 的内部帧）。
func stack(skip int) string {
	buf := make([]byte, 4096)
	n := runtime.Stack(buf, false)
	return string(buf[:n])
}

func logCaller(skip int) string {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return "?"
	}
	return fmt.Sprintf("%s:%d", filepath.Base(file), line)
}

// Info/Warn/Error 包级便捷函数，nil logger 时静默返回。
func Info(format string, args ...any) {
	if defaultLogger != nil {
		defaultLogger.write(levelInfo, logCaller(2), format, args...)
	}
}

func Warn(format string, args ...any) {
	if defaultLogger != nil {
		defaultLogger.write(levelWarn, logCaller(2), format, args...)
	}
}

func Error(format string, args ...any) {
	if defaultLogger != nil {
		defaultLogger.write(levelError, logCaller(2), format, args...)
	}
}

// LogPanic 被 recover() 调用，把 panic 值和栈写进日志，然后 os.Exit(1)。
func LogPanic(r any) {
	Error("panic recovered: %v\n%s", r, stack(2))
}
