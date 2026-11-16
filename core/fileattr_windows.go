//go:build windows

package core

import "golang.org/x/sys/windows"

// SetReadOnly 切换 Windows 文件系统只读属性。
// 使用 SetFileAttributes 而非 os.Chmod：后者只按 0200 位推算，
// 会丢失隐藏、系统、归档等其他属性位。
func SetReadOnly(path string, readonly bool) error {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		return err
	}
	if readonly {
		attrs |= windows.FILE_ATTRIBUTE_READONLY
	} else {
		attrs &^= windows.FILE_ATTRIBUTE_READONLY
	}
	return windows.SetFileAttributes(p, attrs)
}
