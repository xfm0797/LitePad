//go:build !windows

package main

import (
	"fmt"
	"os"
)

// fatalDialog 在非 Windows 平台输出到标准错误。
func fatalDialog(title, text string) {
	fmt.Fprintln(os.Stderr, title+": "+text)
}
