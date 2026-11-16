//go:build !windows

package core

import "errors"

// ApplyAssoc 在非 Windows 平台不可用。
func ApplyAssoc(exe string, formats []string, explorerMenu, setDefault bool) error {
	return errors.New("文件关联与右键菜单集成仅支持 Windows")
}

// ReadAssocStatus 在非 Windows 平台返回不支持状态。
func ReadAssocStatus(exe string) AssocStatus {
	return AssocStatus{Supported: false, Exe: exe, Formats: []string{}, DefaultFormats: []string{}}
}

// ClearAssoc 在非 Windows 平台不做任何事。
func ClearAssoc() error { return nil }
