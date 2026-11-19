# LitePad

用 Go 编写的 Windows 桌面文本编辑器，功能对齐 Notepad++ 基本能力，并加入自己的特色功能。
技术栈：**Wails v2.10.2 + CodeMirror 6**（前端 Vite 5），全程 **CGO_ENABLED=0** 纯 Go 编译，单 exe 约 **15.8 MB**（其中约 3.4 MB 为本地打包的 Mermaid 图表引擎）。

当前版本：**1.1.2**。唯一来源为 [wails.json](wails.json) 的 `info.productVersion`，设置 → 关于页在运行时读取；发版时只改 wails.json，并同步本行即可。

## 功能清单

### Notepad++ 基本功能对齐

| 分类 | 功能 | 快捷键 |
|---|---|---|
| 文件 | 新建 / 打开 / 保存 / 另存为 / 全部保存 / 关闭标签 / 关闭全部 | Ctrl+N/O/S、Ctrl+Shift+S、Ctrl+Alt+S、Ctrl+W |
| 文件 | 多标签（未保存 `*` 标记、未保存关闭/退出确认） | Ctrl+Tab 切换 |
| 文件 | 最近文件列表（持久化）、会话恢复（重启还原标签与活动文件）、文件拖放 | — |
| 文件 | **单实例**：再次双击文件时转发给已运行窗口，并聚焦该窗口 | — |
| 文件 | **退出**（文件菜单；有未保存改动时提供“全部保存并退出 / 不保存退出 / 取消”） | 文件 → 退出 |
| 搜索 | 查找/替换（正则、区分大小写、**整词匹配**、全部替换、命中计数） | Ctrl+F / Ctrl+H |
| 搜索 | **在文件中查找**：递归搜索目录，跳过二进制与依赖目录，结果面板点击跳转到行 | Ctrl+Shift+F |
| 搜索 | 转到指定行 | Ctrl+G |
| 编辑 | 撤销/重做（多级） | Ctrl+Z / Ctrl+Y |
| 编辑 | 复制并插入当前行 / 删除当前行 / 行上移 / 行下移 | Ctrl+D / Ctrl+L / Ctrl+Shift+↑/↓ |
| 编辑 | 转大写 / 转小写 / 行首字母大写（选区或全文） | Ctrl+Shift+U / Ctrl+U |
| 编辑 | 行升序 / 降序排序、删除重复行、删除空行、修剪行尾空格 | — |
| 编辑 | Tab ↔ 空格互转、插入日期时间、括号自动补全与配对高亮、选中词高亮 | — |
| 视图 | 行号、自动换行开关、亮/暗主题、字体字号设置、**缩放** | Ctrl+= / Ctrl+- / Ctrl+0 |
| 视图 | 状态栏：行/列、选中字符数、总字符数、行数、缩放比例、语言（可点击手动切换语法高亮）、编码、换行符 | — |
| 视图 | **空白字符显示**开关（持久化） | 视图菜单/设置 |
| 窗口 | 启动时按主屏工作区（扣除任务栏）计算初始尺寸并居中，小屏（如 1366×768）不越界；最小 640×480；使用 Windows 原生标题栏 | — |
| 菜单 | **菜单悬停切换**：菜单展开时鼠标移到其它顶级菜单立即切换，且不会误触发命令 | — |
| 多光标 | Alt+点击 添加光标、垂直方向加光标、Esc 合并 | Ctrl+Alt+↑/↓ |
| 书签 | 行书签（gutter ◆ 标记，文档编辑时自动跟随行号映射） | Ctrl+F2 / F2 / Shift+F2 |
| 标签 | **右键菜单**：关闭其他/右侧、复制路径、在资源管理器中显示、新窗口打开、重命名文件、只读属性 | Tab 右键 |
| 编辑器 | **右键上下文菜单**：撤销/剪贴板/行操作/文本转换/查找与书签/显示/文件 六组命令，分组可配置 | 编辑区右键 |
| 大文件 | 超过 5MB 自动禁用语法高亮并提示，保证编辑流畅 | — |
| 编码 | UTF-8 / UTF-8 BOM / GBK / ANSI(GB18030) / UTF-16 LE/BE 识别与切换（无 BOM 的 UTF-16 也可识别） | 状态栏点击 |
| 换行 | LF / CRLF 切换（保存时落盘转换） | 状态栏点击 |
| 监视 | **外部文件修改检测**：干净标签自动重载；有未保存更改时弹窗选择 | — |

### LitePad 特色功能

| 功能 | 说明 | 入口 |
|---|---|---|
| **命令面板** | 子序列模糊匹配搜索全部命令，键盘直达 | Ctrl+Shift+P |
| **窗口标题联动** | 标题实时显示「文件名 + 未保存星号」，与标签状态同步 | — |
| **快速打开** | 最近文件 + 已打开文件的模糊过滤 | Ctrl+P |
| **Markdown / GFM 实时预览** | 右侧窗格实时渲染（250ms 去抖、按比例保持滚动位置）：表格（含左/中/右对齐）、任务列表、删除线、裸 URL/邮箱/尖括号自动链接、围栏代码块与语言标签、行内代码、标题锚点（重名自动加序号）、引用（内部可嵌套块级语法）、有序/无序嵌套列表、GFM 软换行与硬换行 | Ctrl+Shift+V |
| **Mermaid 图表** | 以 `mermaid` 为语言标识的围栏代码块渲染为图表，非 mermaid 代码块保持原样；引擎本地打包、不联网；亮/暗主题配色跟随；语法错误时保留源码并显示可读提示，不影响其余预览；`securityLevel: strict` | 预览窗格内 |
| **设置 → 关于** | 软件简介、版本号（运行时读 wails.json）、版权；开发者 **XFM** 链接 `https://www.lovou.pw`，点击用系统默认浏览器打开（仅允许 http/https） | 设置 → 关于 |
| **工具箱** | JSON 格式化/压缩、Base64 编解码（UTF-8 安全）、URL 编解码、**时间戳↔日期互转**（秒/毫秒自动识别）、**正则测试器**，作用于选区或全文 | Ctrl+Alt+J、工具菜单 |
| **禅模式** | 隐藏菜单栏/标签栏/状态栏，纯编辑界面 | F10 |
| **全屏** | 无边框全屏编辑 | F11 |
| **右键菜单管理** | 编辑器右键菜单按 6 个分组（剪贴板/行操作/文本转换/查找与书签/显示/文件）自由开关，支持显示/隐藏快捷键提示、菜单预览、一键恢复默认；配置持久化 | 设置 → 右键菜单 |
| **文件关联与系统集成** | 把常见文本/代码格式（34 种）关联到 LitePad：写入 HKCU 注册表（无需管理员），含 ProgID/图标/打开方式登记，可同时设为默认打开方式；资源管理器右键「用 LitePad 打开」；并登记到「打开方式 → 选择其他应用」应用列表（SupportedTypes）；变更后 SHChangeNotify 刷新外壳；可一键移除全部关联；**双击关联文件直接用 LitePad 打开**（命令行参数接收） | 设置 → 文件关联 |

### Markdown / GFM 预览细节

| 语法 | 状态 |
|---|---|
| 表格（竖线分隔、`:--`/`:-:`/`--:` 对齐、`\|` 转义竖线） | 支持 |
| 任务列表（`- [ ]` / `- [x]`，含嵌套） | 支持（复选框只读展示） |
| 删除线 `~~text~~`、粗体、斜体、行内代码 | 支持 |
| 自动链接：裸 URL、裸邮箱、`<https://…>`、`<a@b.com>` | 支持（自动剥离裸 URL 尾随标点） |
| 围栏代码块（反引号或 `~` 波浪线）、语言标识（`data-lang` 标签 + `language-*` 类） | 支持 |
| 标题锚点（`#`~`######`，中文保留，重名追加 `-1`、`-2`） | 支持 |
| 引用、嵌套列表、有序列表 `start`、GFM 软换行（行尾两空格或 `\` 为硬换行） | 支持 |
| 原始 HTML | **一律转义为文本**（不放行，避免注入） |
| 图片 | 仅显示 `🖼 alt` 占位，不加载本地/远程图片（防路径泄露） |

### Mermaid 图表细节

- 引擎：Mermaid **11.17.2** 官方发行版单文件，位于 `frontend/public/vendor/mermaid.min.js`，由 Vite 原样拷贝进 `dist/vendor/`，随 exe 嵌入；**不依赖 CDN、运行时不联网**。
- 加载方式：仅当文档出现语言标识为 `mermaid` 的围栏代码块时才注入脚本（按需加载，主 JS 包不受影响）。
- 已实测类型：`flowchart/graph`、`sequenceDiagram`、`classDiagram`、`stateDiagram-v2`、`gantt`、`pie`、`erDiagram`；其余 Mermaid 11 支持的类型同理可用。
- 主题：每次渲染从 CSS 变量（`--bg/--fg/--panel/--border/--accent`）生成 `themeVariables`，亮/暗主题切换后随预览重渲染。
- 渲染策略：先在游离容器内完成异步渲染，再整体替换预览 DOM（串行队列 + 代际校验），因此不闪烁、不打断滚动位置恢复。
- 安全：`securityLevel: "strict"`、关闭 HTML 标签、关闭 Mermaid 自身的错误 SVG 注入；SVG 仅来自 Mermaid 渲染结果。

### 语法高亮

Go、Python、JavaScript/TypeScript(JSX/TSX)、JSON、Markdown、HTML、XML、CSS、C/C++、YAML、SQL；纯文本自动兜底。

## 目录结构

```
litepad/
├── main.go                    # Wails 应用入口（窗口选项、StartHidden、go:embed 前端资源）
├── app.go                     # 绑定层：对话框/读写/配置/会话/监视/全屏/关联/关于信息
├── window_geometry_windows.go # 按屏幕工作区计算初始窗口尺寸与居中位置
├── dialog_windows.go          # 启动失败弹窗（MessageBoxW）
├── dialog_other.go            # 非 Windows 平台的空实现
├── core/                      # 核心逻辑层（无 UI 耦合，可独立单测）
│   ├── encoding.go            # 编码识别与转换（BOM/UTF-8/GBK/GB18030/UTF-16）
│   ├── fileio.go              # 文件读写、二进制检测、换行符判定与转换、128MB 上限
│   ├── fileattr_windows.go    # Windows 文件只读属性切换
│   ├── fileattr_other.go      # 非 Windows 平台的空实现
│   ├── config.go              # 配置/会话持久化（JSON，%APPDATA%\LitePad），含右键菜单偏好与系统集成记录
│   ├── watcher.go             # fsnotify 外部修改监视（500ms 去抖）
│   ├── assoc.go               # 关联格式清单与状态类型
│   ├── assoc_windows.go       # Windows 注册表集成：文件关联、资源管理器右键菜单（HKCU，无需管理员）
│   ├── assoc_other.go         # 非 Windows 平台的空实现
│   ├── lang.go                # 扩展名 → 语言标识映射
│   └── core_test.go           # 编码往返、换行、二进制检测、配置兼容等单测
├── frontend/                  # UI 层（CodeMirror 6 + Vite）
│   ├── index.html             # 布局：菜单栏/标签栏/编辑器/预览窗格/查找面板/命令面板
│   ├── package.json           # 前端依赖清单
│   ├── public/vendor/mermaid.min.js  # 本地打包的 Mermaid 11.17.2（Vite 原样拷贝）
│   ├── dist/                  # 前端构建产物，被 go:embed 嵌入 exe（需先构建）
│   └── src/
│       ├── main.js            # 标签管理、文件操作、菜单（含悬停切换/退出）、快捷键、会话/配置/监视同步
│       ├── dialogs.js         # 模态框（串行队列 + Esc 取消）、Toast、下拉选择、右键菜单
│       ├── settings.js        # 设置对话框（编辑器/右键菜单/文件关联/关于）
│       ├── tools.js           # 工具箱：JSON/Base64/URL/时间戳/正则测试器
│       ├── preview.js         # Markdown 预览窗格：去抖、滚动保持、Mermaid 异步渲染与主题适配
│       ├── md-render.js       # 轻量 Markdown/GFM 渲染器（输出已转义，mermaid 块输出占位容器）
│       ├── status.js          # 状态栏渲染与交互
│       ├── editor.js          # 扩展构建、语言装载、主题/字体热更新
│       ├── find.js            # 查找替换面板（正则/大小写/整词）
│       ├── commands.js        # 行操作、大小写、排序去重、Tab 转换、多光标等文本命令
│       ├── bookmarks.js       # 行书签（StateField + gutter，编辑时自动映射位置）
│       ├── ctxmenu.js         # 编辑器右键菜单组装（分组开关、快捷键显示）
│       ├── palette.js         # 命令面板 / 快速打开浮层（模糊匹配）
│       └── style.css          # 亮/暗主题 CSS 变量、禅模式、预览/表格/Mermaid 样式
├── build/
│   ├── app.ico                # 应用图标
│   ├── app.manifest           # DPI 感知 + asInvoker 清单
│   └── build.bat              # 一键构建脚本（先前端后 Go）
├── rsrc_windows_amd64.syso    # 预生成的图标/清单资源（go build 自动链接）
├── wails.json                 # Wails CLI 配置 + 版本/版权唯一来源
└── go.mod / go.sum
```

## 构建与打包

前置：Go 1.23+（`go.mod` 声明 go 1.23，`toolchain go1.26.11`）、Node 18+、pnpm。

```bash
# 方式一：一键脚本（Windows）
build\build.bat

# 方式二：手动
cd frontend
pnpm install
pnpm run build          # 必须先执行：Vite 产物输出到 frontend/dist
cd ..
# 图标/清单资源缺失时生成一次（已存在 rsrc_windows_amd64.syso 可跳过）
go run github.com/akavel/rsrc@latest -ico build/app.ico -manifest build/app.manifest -o rsrc_windows_amd64.syso
# Git Bash 写法；PowerShell 用 $env:CGO_ENABLED="0"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags desktop,production -trimpath -ldflags "-s -w -H windowsgui" -o LitePad.exe .
```

- **前端必须先构建**：`main.go` 通过 `//go:embed all:frontend/dist` 在编译期把 UI 与 `dist/vendor/mermaid.min.js` 嵌入 exe。只改前端不重新 `pnpm run build`，编出来的 exe 仍是旧界面；`frontend/dist` 不存在时 Go 编译会直接失败。
- `-tags desktop,production`：**必需**。Wails v2 依据该标签启用嵌入资源与生产模式，缺失时启动会弹「Wails applications will not build without the correct build tags」错误框且无法使用。
- `-H windowsgui`：不显示控制台黑窗；启动失败原因通过 MessageBoxW 弹窗呈现。
- `rsrc_windows_amd64.syso`：图标 + 清单在链接期自动嵌入，无需 wails CLI。
- 也可用官方 CLI：`wails build`；开发调试 `wails dev`（走 Vite dev server，不经过 embed）。
- Mermaid 无 package.json 依赖：升级时替换 `frontend/public/vendor/mermaid.min.js` 即可，构建仍离线。

### 测试

```bash
go test ./core/          # 编码往返、换行规范化、二进制检测、配置兼容、最近文件
go test -race ./core/    # 竞态检测
```

`core` 层不依赖 UI，可直接单测；`assoc_windows.go`、`fileattr_windows.go` 仅 Windows 编译，非 Windows 平台走空实现。
前端目前没有自动化测试，改动 UI 后建议手动冒烟：多标签开关/保存、查找替换、Markdown 预览（GFM + Mermaid，亮/暗各一次）、主题切换、设置各页、菜单悬停与文件 → 退出。

## 大文件策略

- 单文件上限 **128MB**（`core.MaxOpenBytes`）：超出时给出明确错误而不是静默卡死或内存耗尽；
- CodeMirror 6 只渲染**可视视口**内的行，文档按行分块存储（B-tree）；
- 打开文件一次性读入并整体传输一次，此后编辑均为增量 patch；
- 查找命中计数正则扫描，**超过 2MB 自动跳过计数**（避免逐键 O(n) 卡顿）；
- 替换全部走 changes 批量提交；
- 未保存标记使用修订计数器 O(1) 比较；
- 标签栏仅在名称/脏标记/活动项变化时重建 DOM；会话与监视列表同步做 400ms 去抖；
- Markdown 预览对 >2MB 文档自动暂停（Mermaid 图表同样不渲染）。

## 已知限制

1. 个别浏览器加速键若被 WebView2 宿主吞掉，可用菜单/命令面板替代。
2. ANSI 编码按中文 Windows 代码页（GB18030）处理。
3. GFM 未支持：脚注、引用块懒续行、列表项多段落；表格列数以表头为准，多余单元格丢弃、缺少补空，单元格内不支持块级内容；原始 HTML 一律转义；图片只显示占位文本。
4. Mermaid 引擎单文件约 3.4 MB，随 exe 一起分发；首次出现图表时需加载并解析该脚本，首帧略有延迟。architecture/iconify 等依赖图标资源的图在离线环境可能取不到图标而落到错误占位；strict 模式下图表内点击跳转被禁用（工具栏已提供缩放/下载）。
5. 多行正则（跨行匹配）受 CM6 SearchQuery 限制，仅支持单行内匹配。
6. 文件关联写入 HKCU，绿色版 exe 移动位置后需在设置里重新应用；Windows 10/11 若某格式已被其他程序声明默认应用，需在「设置 → 默认应用」中手动切换（系统限制）。
7. 未实现：十六进制查看、文件对比、插件系统；书签不跨会话持久化。

## 后续扩展建议

- **文件对比**：Go 侧接 sergi/go-diff，前端用 CM6 merge-decorations 做双栏渲染；
- **插件系统**：命令注册表已统一（`COMMANDS` 数组 + `CMD` 字典），可开放插件注入命令、菜单分组与语法高亮扩展；
- **go-winres 版本信息**：Release 流程里加一步 `rsrc` 或 `go-winres` 把 `wails.json` 版本号写进 exe 文件属性页；
- **日志与崩溃报告**：`%APPDATA%\LitePad\logs` 按大小轮转 + panic 栈上报；
- **窗口位置持久化**：会话记录窗口 geometry，跨重启还原；
- **重新打开已关闭标签**（Ctrl+Shift+T）：标签关闭入栈，命令面板恢复。
