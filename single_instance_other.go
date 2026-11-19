//go:build !windows

package main

// 非 Windows 平台不做多实例限制。所有函数返回 "总是主实例，从不转发" 的默认值。

type singleInstance struct{}

// acquireSingleInstance 非 Windows 平台直接返回 (nil, true)，不尝试互斥量。
func acquireSingleInstance() (*singleInstance, bool) {
	return nil, true
}

// forwardToPrimary 非 Windows 平台永远不转发。
func forwardToPrimary(paths []string) bool {
	return false
}

// setHandler 为 nil receiver safe，无需实现。
func (si *singleInstance) setHandler(fn func([]string)) {}

// Close 为 nil receiver safe，无需实现。
func (si *singleInstance) Close() {}
