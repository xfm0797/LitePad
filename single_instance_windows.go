//go:build windows

package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// 单实例通过命名互斥量判定，二次启动再经由本机回环端口把文件转发给主实例。
// 仅监听 127.0.0.1，并用随机 token 校验，避免同机其他进程随意触发打开文件。
const instanceMutexName = `Local\LitePad.SingleInstance`

var procCreateMutexW = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW")

type singleInstance struct {
	handle syscall.Handle
	ln     net.Listener
	file   string
	token  string

	mu      sync.Mutex
	onOpen  func([]string)
	pending [][]string
}

type instanceInfo struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

type instanceMessage struct {
	Token string   `json:"token"`
	Paths []string `json:"paths"`
}

// acquireSingleInstance 尝试成为主实例。返回 (nil, false) 表示已有实例在运行。
func acquireSingleInstance() (*singleInstance, bool) {
	handle, already, err := createInstanceMutex(instanceMutexName)
	if err != nil {
		// 无法判断时按主实例继续，宁可多开也不能吞掉启动。
		return nil, true
	}
	if already {
		if handle != 0 {
			syscall.CloseHandle(handle)
		}
		return nil, false
	}

	si := &singleInstance{handle: handle, file: instanceFilePath()}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		// 仍持有互斥量，保证后续实例不会抢占主实例身份。
		return si, true
	}
	si.ln = ln
	si.token, _ = randomToken()
	info := instanceInfo{Port: ln.Addr().(*net.TCPAddr).Port, Token: si.token}
	raw, _ := json.Marshal(info)
	if err := os.MkdirAll(filepath.Dir(si.file), 0o700); err == nil {
		_ = os.WriteFile(si.file, raw, 0o600)
	}
	go si.serve()
	return si, true
}

func (si *singleInstance) serve() {
	for {
		conn, err := si.ln.Accept()
		if err != nil {
			return
		}
		go si.handleConn(conn)
	}
}

func (si *singleInstance) handleConn(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	raw, err := io.ReadAll(io.LimitReader(conn, 1<<20))
	if err != nil {
		return
	}
	var msg instanceMessage
	if json.Unmarshal(raw, &msg) != nil || msg.Token != si.token {
		return
	}
	si.deliver(msg.Paths)
}

func (si *singleInstance) deliver(paths []string) {
	si.mu.Lock()
	if si.onOpen == nil {
		si.pending = append(si.pending, paths)
		si.mu.Unlock()
		return
	}
	fn := si.onOpen
	si.mu.Unlock()
	fn(paths)
}

// setHandler 在应用启动完成后注册处理函数，并补发启动期间收到的路径。
func (si *singleInstance) setHandler(fn func([]string)) {
	if si == nil {
		return
	}
	si.mu.Lock()
	si.onOpen = fn
	pending := si.pending
	si.pending = nil
	si.mu.Unlock()
	for _, paths := range pending {
		fn(paths)
	}
}

// Close 释放监听、端口信息文件与互斥量。
func (si *singleInstance) Close() {
	if si == nil {
		return
	}
	if si.ln != nil {
		_ = si.ln.Close()
	}
	if si.file != "" {
		_ = os.Remove(si.file)
	}
	if si.handle != 0 {
		_ = syscall.CloseHandle(si.handle)
	}
}

// forwardToPrimary 把本次启动的文件发给已运行实例；成功返回 true。
func forwardToPrimary(paths []string) bool {
	raw, err := os.ReadFile(instanceFilePath())
	if err != nil {
		return false
	}
	var info instanceInfo
	if json.Unmarshal(raw, &info) != nil || info.Port <= 0 || info.Token == "" {
		return false
	}
	addr := fmt.Sprintf("127.0.0.1:%d", info.Port)
	deadline := time.Now().Add(2 * time.Second)
	for {
		conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
		if err == nil {
			defer conn.Close()
			_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
			msg, _ := json.Marshal(instanceMessage{Token: info.Token, Paths: paths})
			if _, err := conn.Write(msg); err != nil {
				return false
			}
			if tc, ok := conn.(*net.TCPConn); ok {
				_ = tc.CloseWrite()
			}
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func createInstanceMutex(name string) (syscall.Handle, bool, error) {
	p, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, false, err
	}
	h, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(p)))
	if h == 0 {
		return 0, false, callErr
	}
	return syscall.Handle(h), callErr == syscall.ERROR_ALREADY_EXISTS, nil
}

func randomToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func instanceFilePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "LitePad-instance.json")
	}
	return filepath.Join(dir, "LitePad", "instance.json")
}
