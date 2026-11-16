package core

import (
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// FileEvent 描述一次外部文件变更（Write 已按 500ms 去抖合并）。
type FileEvent struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // "write" | "remove" | "rename"
}

// Watcher 监视已打开文件的外部修改。
// 创建失败（如系统限制）时返回 nil，调用方需判空降级。
type Watcher struct {
	mu     sync.Mutex
	w      *fsnotify.Watcher
	paths  map[string]string // 归一化 key → 注册时的原始路径（事件回传用原路径）
	Events chan FileEvent
	quit   chan struct{}
	done   chan struct{} // loop 退出后关闭，供调用方结束转发协程
	once   sync.Once
}

// NewWatcher 创建监视器并启动事件循环。
func NewWatcher() *Watcher {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil
	}
	wa := &Watcher{
		w:      w,
		paths:  make(map[string]string),
		Events: make(chan FileEvent, 16),
		quit:   make(chan struct{}),
		done:   make(chan struct{}),
	}
	go wa.loop()
	return wa
}

// Done 返回在监视循环退出后关闭的通道。
func (wa *Watcher) Done() <-chan struct{} {
	if wa == nil {
		return nil
	}
	return wa.done
}

// watchKey 归一化路径：Clean 去掉 ./ 与重复分隔符；Windows 文件系统不区分大小写，
// 统一小写可避免同一个文件因大小写差异被重复登记或漏匹配。
func watchKey(p string) string {
	k := filepath.Clean(p)
	if runtime.GOOS == "windows" {
		k = strings.ToLower(k)
	}
	return k
}

// Sync 将监视列表与传入路径集合对齐：新增缺失的、移除多余的。
func (wa *Watcher) Sync(paths []string) {
	if wa == nil {
		return
	}
	wa.mu.Lock()
	defer wa.mu.Unlock()
	want := make(map[string]string, len(paths))
	for _, p := range paths {
		if p == "" {
			continue
		}
		want[watchKey(p)] = p
	}
	for k, orig := range wa.paths {
		if _, ok := want[k]; !ok {
			_ = wa.w.Remove(orig)
			delete(wa.paths, k)
		}
	}
	for k, orig := range want {
		if _, ok := wa.paths[k]; ok {
			continue
		}
		// 文件可能已被删除或暂时不可访问：Add 失败时保持未登记状态，
		// 下一次 Sync（标签切换/保存）会重试，而非永久性漏监视。
		if err := wa.w.Add(orig); err == nil {
			wa.paths[k] = orig
		}
	}
}

func (wa *Watcher) loop() {
	var debounceMu sync.Mutex
	debounce := make(map[string]*time.Timer)
	defer func() {
		// 停止尚未触发的去抖定时器，避免其回调在循环退出后访问已释放资源。
		debounceMu.Lock()
		for _, t := range debounce {
			t.Stop()
		}
		debounce = nil
		debounceMu.Unlock()
		close(wa.done)
	}()

	for {
		select {
		case <-wa.quit:
			return
		case ev, ok := <-wa.w.Events:
			if !ok {
				return
			}
			kind := ""
			switch {
			case ev.Has(fsnotify.Write):
				kind = "write"
			case ev.Has(fsnotify.Remove):
				kind = "remove"
			case ev.Has(fsnotify.Rename):
				kind = "rename"
			}
			orig, watched := wa.pathOf(ev.Name)
			if kind == "" || !watched {
				continue
			}
			if kind != "write" {
				// fsnotify 对已删除/重命名的文件会自动移除 watch，
				// 必须同步清理登记表，否则下次 Sync 会误判“已在监视”而不再 Add，
				// 导致文件重建后永久失去监视。
				wa.mu.Lock()
				delete(wa.paths, watchKey(ev.Name))
				wa.mu.Unlock()
				_ = wa.w.Remove(ev.Name)
			}
			if kind == "write" {
				// 去抖：编辑器类软件保存时往往触发多次 Write
				debounceMu.Lock()
				if t, ok := debounce[orig]; ok {
					t.Reset(500 * time.Millisecond)
				} else {
					debounce[orig] = time.AfterFunc(500*time.Millisecond, func() {
						debounceMu.Lock()
						delete(debounce, orig)
						debounceMu.Unlock()
						// 去抖窗口内文件可能已被关闭标签（移出监视集合）
						if _, ok := wa.pathOf(orig); !ok {
							return
						}
						select {
						case wa.Events <- FileEvent{Path: orig, Kind: "write"}:
						case <-wa.quit:
						}
					})
				}
				debounceMu.Unlock()
			} else {
				select {
				case wa.Events <- FileEvent{Path: orig, Kind: kind}:
				case <-wa.quit:
					return
				}
			}
		case _, ok := <-wa.w.Errors:
			if !ok {
				return
			}
		}
	}
}

// pathOf 返回路径对应的原始登记路径（防止已关闭文件的事件外泄）。
func (wa *Watcher) pathOf(path string) (string, bool) {
	wa.mu.Lock()
	defer wa.mu.Unlock()
	orig, ok := wa.paths[watchKey(path)]
	return orig, ok
}

// Close 停止监视（幂等，可安全多次调用）。
func (wa *Watcher) Close() {
	if wa == nil {
		return
	}
	wa.once.Do(func() {
		close(wa.quit)
		_ = wa.w.Close()
	})
}
