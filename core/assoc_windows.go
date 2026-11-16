//go:build windows

package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"golang.org/x/sys/windows/registry"
)

// 关联实现说明：
//   - 全部写入 HKCU\Software\Classes，无需管理员权限，卸载/退出可完整回滚；
//   - ProgID 采用 "LitePad.<ext>"，避免与其他编辑器争用同一 ProgID；
//   - "*\shell\LitePad" 提供资源管理器“用 LitePad 打开”右键菜单；
//   - 变更后调用 SHChangeNotify 通知外壳刷新图标与关联。

const (
	progIDPrefix = "LitePad"
	shellRoot    = `Software\Classes`
	// appKey 登记到「打开方式」应用列表，缺少它时只能通过 ProgID 关联，
	// 某些系统版本不会把程序列入“选择其他应用”对话框。
	appKey = shellRoot + `\Applications\LitePad.exe`
	// SHCNE_ASSOCCHANGED 通知资源管理器文件关联已变化
	shcneAssocChanged = 0x08000000
	shcnfIDList       = 0x0000
)

var (
	shell32            = syscall.NewLazyDLL("shell32.dll")
	procSHChangeNotify = shell32.NewProc("SHChangeNotify")
)

// ProgID 返回某扩展名对应的 LitePad ProgID。
func ProgID(ext string) string { return progIDPrefix + ext }

// ApplyAssoc 将注册表调整为期望状态：formats 内的扩展名建立关联，
// 其余此前由 LitePad 建立的关联会被清理。
// setDefault 为 true 时同时把扩展名的默认打开方式指向 LitePad。
func ApplyAssoc(exe string, formats []string, explorerMenu, setDefault bool) error {
	exe, err := filepath.Abs(exe)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(exe); statErr != nil {
		return fmt.Errorf("可执行文件不存在：%s", exe)
	}

	// 1) 清理不再需要的旧关联
	existing, err := linkedFormats()
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, ext := range formats {
		wanted[normalizeExt(ext)] = true
	}
	for _, ext := range existing {
		if !wanted[ext] {
			if err := removeExt(exe, ext); err != nil {
				return err
			}
		}
	}

	// 2) 建立新关联
	for ext := range wanted {
		if err := linkExt(exe, ext, setDefault); err != nil {
			return err
		}
	}

	// 3) 资源管理器右键菜单
	if explorerMenu {
		if err := setExplorerMenu(exe); err != nil {
			return err
		}
	} else if err := clearExplorerMenu(); err != nil {
		return err
	}

	// 4) 「打开方式」应用登记（与是否建立格式关联无关，便于用户手动选择）
	if err := registerApplication(exe, formats); err != nil {
		return err
	}

	notifyShell()
	return nil
}

// ReadAssocStatus 读取当前注册表状态（用于设置页回显）。
func ReadAssocStatus(exe string) AssocStatus {
	st := AssocStatus{Supported: true, Exe: exe, Formats: []string{}, DefaultFormats: []string{}}
	if current, err := os.Executable(); err == nil {
		st.Exe = current
	}
	exts, err := linkedFormats()
	if err == nil {
		st.Formats = exts
	}
	for _, ext := range st.Formats {
		k, err := registry.OpenKey(registry.CURRENT_USER, shellRoot+`\`+ext, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		v, _, err := k.GetStringValue("")
		k.Close()
		if err == nil && strings.EqualFold(v, ProgID(ext)) {
			st.DefaultFormats = append(st.DefaultFormats, ext)
		}
	}
	if k, err := registry.OpenKey(registry.CURRENT_USER, shellRoot+`\*\shell\`+progIDPrefix, registry.QUERY_VALUE); err == nil {
		st.ExplorerMenu = true
		k.Close()
	}
	if k, err := registry.OpenKey(registry.CURRENT_USER, appKey, registry.QUERY_VALUE); err == nil {
		st.AppRegistered = true
		k.Close()
	}
	return st
}

// ClearAssoc 移除本站写入的全部关联与右键菜单。
func ClearAssoc() error {
	exts, err := linkedFormats()
	if err != nil {
		return err
	}
	for _, ext := range exts {
		if err := removeExt("", ext); err != nil {
			return err
		}
	}
	if err := clearExplorerMenu(); err != nil {
		return err
	}
	if err := deleteKeyTree(appKey); err != nil {
		return err
	}
	notifyShell()
	return nil
}

// ---------- 内部实现 ----------

func normalizeExt(ext string) string {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == "" {
		return ""
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return ext
}

// linkExt 为单个扩展名创建 ProgID、图标、open/edit 命令并登记到“打开方式”。
func linkExt(exe, ext string, setDefault bool) error {
	if ext == "" {
		return fmt.Errorf("非法扩展名")
	}
	pid := ProgID(ext)
	base := shellRoot + `\` + pid

	k, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.WRITE)
	if err != nil {
		return err
	}
	display := fmt.Sprintf("%s 文件 (LitePad)", strings.TrimPrefix(ext, "."))
	if err := k.SetStringValue("", display); err != nil {
		k.Close()
		return err
	}
	k.Close()

	if err := setKeyDefault(base+`\DefaultIcon`, fmt.Sprintf(`"%s",0`, exe)); err != nil {
		return err
	}
	if err := setKeyDefault(base+`\shell\open\command`, fmt.Sprintf(`"%s" "%%1"`, exe)); err != nil {
		return err
	}
	if err := setKeyDefault(base+`\shell\edit\command`, fmt.Sprintf(`"%s" "%%1"`, exe)); err != nil {
		return err
	}

	// 登记到该扩展名的“打开方式”候选列表
	ow, _, err := registry.CreateKey(registry.CURRENT_USER, shellRoot+`\`+ext+`\OpenWithProgids`, registry.WRITE)
	if err != nil {
		return err
	}
	err = ow.SetStringValue(pid, "")
	ow.Close()
	if err != nil {
		return err
	}

	if setDefault {
		if err := setKeyDefault(shellRoot+`\`+ext, pid); err != nil {
			return err
		}
	}
	return nil
}

// removeExt 删除某一扩展名的 LitePad 关联（含 ProgID 子键与打开方式登记）。
func removeExt(exe, ext string) error {
	pid := ProgID(ext)
	// ProgID 键（DeleteKey 会连带删除子键）
	if err := deleteKeyTree(shellRoot + `\` + pid); err != nil {
		return err
	}
	// 打开方式登记
	if k, err := registry.OpenKey(registry.CURRENT_USER, shellRoot+`\`+ext+`\OpenWithProgids`, registry.SET_VALUE); err == nil {
		_ = k.DeleteValue(pid)
		k.Close()
	}
	// 若默认打开方式仍指向 LitePad，则撤销该默认值
	if k, err := registry.OpenKey(registry.CURRENT_USER, shellRoot+`\`+ext, registry.SET_VALUE|registry.QUERY_VALUE); err == nil {
		if v, _, err := k.GetStringValue(""); err == nil && strings.EqualFold(v, pid) {
			_ = k.DeleteValue("")
		}
		k.Close()
	}
	return nil
}

func setExplorerMenu(exe string) error {
	base := shellRoot + `\*\shell\` + progIDPrefix
	k, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.WRITE)
	if err != nil {
		return err
	}
	_ = k.SetStringValue("", "用 LitePad 打开")
	_ = k.SetStringValue("Icon", fmt.Sprintf(`"%s",0`, exe))
	// Player 模型：多选时对每个文件各启动一次
	_ = k.SetStringValue("MultiSelectModel", "Player")
	k.Close()
	return setKeyDefault(base+`\command`, fmt.Sprintf(`"%s" "%%1"`, exe))
}

func clearExplorerMenu() error {
	if err := deleteKeyTree(shellRoot + `\*\shell\` + progIDPrefix); err != nil {
		return err
	}
	return nil
}

// registerApplication 在 Applications 下登记 LitePad，使其出现在
// 「打开方式 → 选择其他应用」列表中，并声明支持的扩展名。
// Windows 只读取该键的 shell\open\command 与 SupportedTypes，不依赖格式关联是否生效。
func registerApplication(exe string, formats []string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, appKey, registry.WRITE)
	if err != nil {
		return err
	}
	_ = k.SetStringValue("", "LitePad")
	_ = k.SetStringValue("FriendlyAppName", "LitePad")
	_ = k.SetStringValue("ApplicationCompany", "LitePad")
	k.Close()

	if err := setKeyDefault(appKey+`\DefaultIcon`, fmt.Sprintf(`"%s",0`, exe)); err != nil {
		return err
	}
	if err := setKeyDefault(appKey+`\shell\open\command`, fmt.Sprintf(`"%s" "%%1"`, exe)); err != nil {
		return err
	}
	// SupportedTypes 决定“打开方式”对话框里 LitePad 的推荐范围；
	// 先清空旧子树，避免取消勾选的格式仍被推荐。
	_ = deleteKeyTree(appKey + `\SupportedTypes`)
	for _, ext := range formats {
		ext = normalizeExt(ext)
		if ext == "" {
			continue
		}
		if err := setKeyDefault(appKey+`\SupportedTypes\`+ext, ""); err != nil {
			return err
		}
	}
	return nil
}

// setKeyDefault 创建键并写入默认值。
func setKeyDefault(path, value string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.WRITE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue("", value)
}

// deleteKeyTree 递归删除注册表键。
// RegDeleteKey 在存在子键时会失败，ProgID / Applications 均为多层结构，
// 因此必须先自底向上清理，否则“移除关联”会半途而废并留下残键。
func deleteKeyTree(path string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	names, err := k.ReadSubKeyNames(-1)
	k.Close()
	if err != nil {
		return err
	}
	for _, n := range names {
		if err := deleteKeyTree(path + `\` + n); err != nil {
			return err
		}
	}
	if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

// linkedFormats 枚举 HKCU\Software\Classes 下所有 LitePad.* ProgID 对应的扩展名。
func linkedFormats() ([]string, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, shellRoot, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}
	defer k.Close()
	names, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, n := range names {
		if strings.HasPrefix(n, progIDPrefix+".") && len(n) > len(progIDPrefix)+1 {
			out = append(out, strings.ToLower(n[len(progIDPrefix):]))
		}
	}
	sort.Strings(out)
	return out, nil
}

// notifyShell 通知资源管理器刷新关联与图标。
func notifyShell() {
	if procSHChangeNotify.Find() == nil {
		_, _, _ = procSHChangeNotify.Call(shcneAssocChanged, shcnfIDList, 0, 0)
	}
}
