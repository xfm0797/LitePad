//go:build !windows

package core

import "os"

// SetReadOnly 在非 Windows 平台通过权限位模拟只读。
func SetReadOnly(path string, readonly bool) error {
	mode := os.FileMode(0o644)
	if readonly {
		mode = 0o444
	}
	return os.Chmod(path, mode)
}
