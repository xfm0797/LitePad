# LitePad

用 Go 编写的 Windows 桌面文本编辑器，功能对齐 Notepad++ 基本能力，并加入自己的特色功能。
技术栈：**Wails v2 + CodeMirror 6**，全程 **CGO_ENABLED=0** 纯 Go 编译，单 exe 约 5.6 MB。

## 功能清单

### Notepad++ 基本功能对齐

| 分类 | 功能 | 快捷键 |
|---|---|---|
| 文件 | 新建 / 打开 / 保存 / 另存为 / 全部保存 / 关闭标签 / 关闭全部 | Ctrl+N/O/S、Ctrl+Shift+S、Ctrl+Alt+S、Ctrl+W |
| 文件 | 多标签（未保存 `*` 标记、未保存关闭/退出确认） | Ctrl+Tab 切换 |
| 文件 | 最近文件列表（持久化）、会话恢复（重启还原标签）、文件拖放 | — |
| 搜索 | 查找/替换（正则、区分大小写、**整词匹配**、全部替换、命中计数） | Ctrl+F / Ctrl+H |
| 搜索 | 转到指定行 | Ctrl+G |
| 编辑 | 撤销/重做（多级） | Ctrl+Z / Ctrl+Y |
| 编辑 | 复制并插入当前行 / 删除当前行 / 行上移 / 行下移 | Ctrl+D / Ctrl+L / Ctrl+Shift+↑/↓ |
| 编辑 | 转大写 / 转小写 / 行首字母大写（选区或全文） | Ctrl+Shift+U / Ctrl+U |
| 编辑 | 行升序 / 降序排序、删除重复行、删除空行、修剪行尾空格 | — |
| 编辑 | Tab ↔ 空格互转、插入日期时间、括号自动补全与配对高亮、选中词高亮 | — |
| 视图 | 行号、自动换行开关、亮/暗主题、字体字号设置、**缩放** | Ctrl+= / Ctrl+- / Ctrl+0 |
| 视图 | 状态栏：行/列、选中字符数、总字符数、行数、缩放比例、语言（可点击手动切换语法高亮）、编码、换行符 | — |
| 视图 | **空白字符显示**开关（持久化） | 视图菜单/设置 |
| 多光标 | Alt+点击 添加光标、垂直方向加光标、Esc 合并 | Ctrl+Alt+↑/↓ |
| 书签 | 行书签（gutter ◆ 标记，文档编辑时自动跟随行号映射） | Ctrl+F2 / F2 / Shift+F2 |
| 标签 | **右键菜单**：关闭其他/右侧、复制路径、在资源管理器中显示、**新窗口打开**、重命名文件、只读属性 | Tab 右键 |
| 编辑器 | **右键上下文菜单**：撤销/剪贴板/行操作/文本转换/查找书签/显示/文件 七组命令，分组可配置 | 编辑区右键 |
| 大文件 | 超过 5MB 自动禁用语法高亮并提示，保证编辑流畅 | — |
| 编码 | UTF-8 / UTF-8 BOM / GBK / ANSI(GB18030) / UTF-16 LE/BE 识别与切换（无 BOM 的 UTF-16 也可识别） | 状态栏点击 |
| 换行 | LF / CRLF 切换（保存时落盘转换） | 状态栏点击 |
| 监视 | **外部文件修改检测**：干净标签自动重载；有未保存更改时弹窗选择 | — |

### LitePad 特色功能

| 功能 | 说明 | 入口 |
|---|---|---|
| **命令面板** | 子序列模糊匹配（连续命中/位置靠前加分）搜索全部 50+ 命令，键盘直达 | Ctrl+Shift+P |
| **窗口标题联动** | 标题实时显示「文件名 + 未保存星号」，与标签状态同步 | — |
| **快速打开** | 最近文件 + 已打开文件的模糊过滤 | Ctrl+P |
| **Markdown 实时预览** | 右侧窗格实时渲染（标题/列表/任务列表/引用/代码块/表格外的常用语法），任意文本文档可用，内置 XSS 转义 | Ctrl+Shift+V |
| **工具箱** | JSON 格式化/压缩、Base64 编解码（UTF-8 安全）、URL 编解码、**时间戳↔日期互转**（秒/毫秒自动识别）、**正则测试器**，作用于选区或全文 | Ctrl+Alt+J、工具菜单 |
| **禅模式** | 隐藏菜单栏/标签栏/状态栏，纯编辑界面 | F10 |
| **全屏** | 无边框全屏编辑 | F11 |
| **右键菜单管理** | 编辑器右键菜单按 6 个分组（剪贴板/行操作/文本转换/查找书签/显示/文件）自由开关，支持显示/隐藏快捷键提示、菜单预览、一键恢复默认；配置持久化 | 设置 → 右键菜单 |
| **文件关联与系统集成** | 把常见文本/代码格式（34 种）关联到 LitePad：写入 HKCU 注册表（无需管理员），含 ProgID/图标/打开方式登记，可同时设为默认打开方式；资源管理器右键「用 LitePad 打开」；并登记到「打开方式 → 选择其他应用」应用列表（SupportedTypes）；变更后 SHChangeNotify 刷新外壳；可一键移除全部关联；**双击关联文件直接用 LitePad 打开**（命令行参数接收） | 设置 → 文件关联 |

### 语法高亮

Go、Python、JavaScript/TypeScript(JSX/TSX)、JSON、Markdown、HTML、XML、CSS、C/C++、YAML、SQL；纯文本自动兜底。

## 目录结构

```
litepad/
├── main.go                    # Wails 应用入口（窗口选项、生命周期）
├── app.go                     # 绑定层：对话框/读写/配置/会话/监视/全屏
├── core/                      # 核心逻辑层（无 UI 耦合，可独立单测）
│   ├── encoding.go            # 编码识别与转换（BOM/UTF-8/GBK/GB18030/UTF-16）
│   ├── fileio.go              # 文件读写、二进制检测、换行符判定与转换
│   ├── config.go              # 配置/会话持久化（JSON，%APPDATA%\LitePad），含右键菜单偏好与系统集成记录
│   ├── watcher.go             # fsnotify 外部修改监视（500ms 去抖）
│   ├── assoc.go               # 关联格式清单与状态类型
│   ├── assoc_windows.go       # Windows 注册表集成：文件关联、资源管理器右键菜单（HKCU，无需管理员）
│   ├── assoc_other.go         # 非 Windows 平台的空实现
│   └── lang.go                # 扩展名 → 语言标识映射
├── frontend/                  # UI 层（CodeMirror 6 + Vite）
│   ├── index.html             # 布局：菜单栏/标签栏/编辑器/预览窗格/查找面板/命令面板
│   ├── package.json           # 前端依赖清单
│   └── src/
│       ├── main.js            # 标签管理、文件操作、菜单、快捷键、会话/配置/监视同步
│       ├── dialogs.js         # 模态框（串行队列 + Esc 取消）、Toast、下拉选择、右键菜单
│       ├── settings.js        # 设置对话框（编辑器/右键菜单/文件关联）
│       ├── tools.js           # 工具箱：JSON/Base64/URL/时间戳/正则测试器
│       ├── preview.js         # Markdown 预览窗格（去抖 + 滚动位置保持）
│       ├── status.js          # 状态栏渲染与交互
│       ├── editor.js          # 扩展构建、语言装载、主题/字体热更新
│       ├── find.js            # 查找替换面板（正则/大小写/整词）
│       ├── commands.js        # 行操作、大小写、排序去重、Tab 转换、多光标等文本命令
│       ├── bookmarks.js       # 行书签（StateField + gutter，编辑时自动映射位置）
│       ├── ctxmenu.js         # 编辑器右键菜单组装（分组开关、快捷键显示）
│       ├── palette.js         # 命令面板 / 快速打开浮层（模糊匹配）
│       ├── md-render.js       # 轻量 Markdown 渲染器（输出已转义）
│       └── style.css          # 亮/暗主题 CSS 变量、禅模式、预览排版
├── build/
│   ├── app.ico                # 应用图标
│   ├── app.manifest           # DPI 感知 + asInvoker 清单
│   └── build.bat              # 一键构建脚本
├── rsrc_windows_amd64.syso    # 预生成的图标/清单资源（go build 自动链接）
├── wails.json                 # Wails CLI 配置
└── go.mod / go.sum
```

## 构建与打包

前置：Go 1.22+（1.21 环境会经 `GOTOOLCHAIN=auto` 自动下载工具链）、Node 18+、pnpm。

```bash
# 方式一：一键脚本（Windows）
build\build.bat

# 方式二：手动
cd frontend && pnpm install && pnpm run build && cd ..
go run github.com/akavel/rsrc@latest -ico build/app.ico -manifest build/app.manifest -o rsrc_windows_amd64.syso
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags desktop,production -trimpath -ldflags "-s -w -H windowsgui" -o LitePad.exe .
```

- `-tags desktop,production`：**必需**。Wails v2 运行时依据该标签启用嵌入的前端资源与生产模式；缺失时程序启动会弹「Wails applications will not build without the correct build tags」错误框且无法使用（1.1.0 版 exe 即存在此问题，1.1.1 起修复）
- `-H windowsgui`：不显示控制台黑窗
- `rsrc_windows_amd64.syso`：图标 + 清单在链接期自动嵌入，无需 wails CLI
- 也可用官方 CLI：`wails build`；开发调试 `wails dev`

### 测试

```bash
go test ./core/          # 编码往返、换行规范化、二进制检测、配置兼容、最近文件
go test -race ./core/    # 竞态检测
```

`core` 层不依赖 UI，可直接单测；`assoc_windows.go` 仅 Windows 编译，非 Windows 平台走空实现。

前端另有一份浏览器冒烟测试（注入 Wails 桥接 mock，覆盖标签/保存/查找/书签/设置/预览/右键菜单/外部重载 29 项断言），
可按需在本地以 Playwright + 静态服务器运行 `frontend/dist` 复现。

## 大文件（≥10MB）策略

- 单文件上限 **128MB**（`core.MaxOpenBytes`）：超出时给出明确错误而不是静默卡死或内存耗尽；
- CodeMirror 6 只渲染**可视视口**内的行，文档按行分块存储（B-tree）；
- 打开文件一次性读入并整体传输一次，此后编辑均为增量 patch；
- 查找命中计数正则扫描，**超过 2MB 自动跳过计数**（避免逐键 O(n) 卡顿）；
- 替换全部走 changes 批量提交；
- 未保存标记使用修订计数器 O(1) 比较；
- 标签栏仅在名称/脏标记/活动项变化时重建 DOM；会话与监视列表同步做 400ms 去抖；
- Markdown 预览对 >2MB 文档自动暂停。

## 已知限制

1. 个别浏览器加速键若被 WebView2 宿主吞掉，可用菜单/命令面板替代。
2. ANSI 编码按中文 Windows 代码页（GB18030）处理。
3. Markdown 预览不支持表格语法与本地图片加载（防路径泄露）。
4. 多行正则（跨行匹配）受 CM6 SearchQuery 限制，仅支持单行内匹配。
5. 文件关联写入 HKCU，绿色版 exe 移动位置后需在设置里重新应用；Windows 10/11 若某格式已被其他程序声明默认应用，需在「设置 → 默认应用」中手动切换（系统限制）。
6. 双击关联文件时每次启动一个新窗口（未做单实例转发）。
7. exe 已含图标与清单，版本信息（文件属性页）尚未嵌入，可用 `go-winres` 补全。
8. 未实现：矩形列选（Alt+Shift 拖拽）、十六进制查看、文件对比、插件系统；书签不跨会话持久化。

## 后续扩展建议

- **列选择/矩形选区**：CM6 multiple selection 已接入（Alt+Click、Ctrl+Alt+↑/↓），可补 Alt+Shift+鼠标矩形选区交互；
- **函数列表（大纲）**：基于各语言 Lezer 语法树提取符号，侧边栏跳转；
- **文件对比**：Go 侧接 diff-match-patch 或 sergi/go-diff 双栏渲染；
- **更多工具**：正则测试器、颜色选择器、时间戳批量转换；
- **插件系统**：命令面板已具备命令注册表形态，可开放插件注入命令；
- **安装包**：Inno Setup / NSIS 封装，或 `go-winres` 补全版本信息。
