@echo off
REM LitePad 一键构建脚本（Windows）
REM 前置条件：Go 1.22+（1.21 会自动下载工具链）、Node 18+、pnpm（npm i -g pnpm）
setlocal

cd /d "%~dp0.."

echo [1/3] 构建前端...
pushd frontend
call pnpm install
call pnpm run build
popd
if errorlevel 1 goto :fail

echo [2/3] 嵌入图标与版本资源（可选，需已生成 rsrc_windows_amd64.syso）...
if not exist rsrc_windows_amd64.syso (
  go run github.com/akavel/rsrc@latest -ico build/app.ico -manifest build/app.manifest -o rsrc_windows_amd64.syso
)

echo [3/3] 编译 Windows exe（无 CGO、无控制台窗口）...
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go build -tags desktop,production -trimpath -ldflags "-s -w -H windowsgui" -o LitePad.exe .
if errorlevel 1 goto :fail

echo 构建完成: LitePad.exe
exit /b 0

:fail
echo 构建失败
exit /b 1
