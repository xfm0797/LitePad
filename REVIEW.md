# LitePad 1.1.0 最终评审报告

评审范围：全部 Go 源码（main / app / core/*）与前端源码（frontend/src/*），
验证手段：单元测试（含竞态检测）、跨平台编译、浏览器冒烟测试（Playwright，注入 Wails 桥接 mock）、Windows 目标 `go vet`。

## 一、本轮修复的技术债与缺陷

### 严重（数据正确性 / 功能失效）

| # | 问题 | 修复 |
|---|---|---|
| 1 | **UTF-16 文件无法打开**：二进制检测（NUL 字节）先于编码识别执行，UTF-16 文本因含 NUL 被整体拒绝，UTF-16 支持形同虚设 | `ReadTextFile` 改为：有 BOM 直接放行；无 BOM 时按 NUL 奇偶分布启发式识别（≥20% NUL + 解码无替换符 + 控制字符占比校验），普通二进制仍被拒绝。新增 3 个回归测试 |
| 2 | **书签切换后 gutter 不重绘**：书签切换只派发 effect 不改文档，`gutter()` 默认仅在 docChanged 时刷新，标记要等下次输入才出现 | `bookmarkGutter` 显式声明 `lineMarkerChange`，effect 变化即重绘。冒烟测试覆盖 |
| 3 | **退出确认死循环风险**：确认后直接 `Quit()`，未保存标记仍置位，`OnBeforeClose` 会再次弹确认框 | 确认后先 `SetUnsaved(false)` 再退出 |
| 4 | **监视器协程泄漏 / 事件通道悬挂**：`watchLoop` 永久 range `Events`，关闭后不退出；去抖定时器在 Close 后仍可能回调 | 新增 `Done()` 通道供转发协程退出；loop 退出时停止全部去抖定时器；`Close` 幂等并有测试覆盖 |
| 5 | **注册表删除不递归**：`RegDeleteKey` 存在子键时失败，ProgID/Applications 均为多层结构，「移除全部关联」可能半途而废留下残键 | 新增 `deleteKeyTree` 自底向上递归删除，三处删除点全部替换 |

### 中等（健壮性 / 数据丢失）

| # | 问题 | 修复 |
|---|---|---|
| 6 | 配置/会话非原子写：进程崩溃会留下截断的 JSON，配置全部丢失 | `writeFileAtomic`：同目录临时文件 + Sync + 原子替换，写入后不残留 .tmp（有测试） |
| 7 | `SaveConfig` 用前端副本整体覆盖服务端配置：前端状态滞后时会丢掉最近文件与集成记录 | 合并语义：`RecentFiles` / `Integrations` 始终以主进程为准 |
| 8 | 配置字段无校验：手改配置文件（fontSize=999、theme 拼错等）直接生效 | `Config.Normalize()` 在读写两侧收敛越界字段 |
| 9 | 无文件大小上限：超大文件一次性读入 + IPC 传输会静默卡死/OOM | 新增 `core.MaxOpenBytes`（128MB），超出返回明确错误 |
| 10 | 保存覆盖原文件权限（Windows 下固定 0644） | 写盘前读取原权限并保留 |
| 11 | 只读属性用 `os.Chmod` 实现，会丢掉隐藏/系统等其他属性位 | Windows 改用 `Get/SetFileAttributes` 只翻转 READONLY 位 |
| 12 | 同一文件因大小写/分隔符差异被重复打开、外部事件匹配失败 | 前后端均引入路径归一化 key（Windows 大小写不敏感 + Clean） |
| 13 | 模态框可重入：文件变更提示与保存提示并发时互相覆盖，留下永不 resolve 的 Promise | `dialogs.js` 模态串行队列；`collect` 异常兜底；Esc 触发取消按钮 |
| 14 | 切换标签后书签/配置 state 与 view 不同步等历史问题在本轮回归测试中确认已修复 | — |

### 一般（体验 / 质量）

| # | 问题 | 修复 |
|---|---|---|
| 15 | `main.js` 1462 行单文件 | 拆分为 `dialogs / settings / tools / preview / status` 5 个模块，main.js 降至约 1100 行编排层 |
| 16 | 状态栏「语言」显示为指针样式但不可点击（假交互） | 实现手动切换语法高亮（含后台标签 state 同步与 toast） |
| 17 | 命令面板为 `includes` 过滤，与宣传的“模糊搜索”不符 | 子序列模糊匹配 + 连续命中/位置加分排序 |
| 18 | 预览每次输入跳回顶部 | 按滚动比例恢复位置 |
| 19 | Ctrl+= 连续缩放每键写盘一次 | 配置写盘 300ms 去抖 |
| 20 | 设置对话框把 `cfg.fontFamily` 等用户输入拼进 HTML 属性（注入风险） | 改为渲染后 DOM 赋值；重命名对话框同样改为 DOM 构建 |
| 21 | 窗口标题不随标签/未保存状态变化 | 新增 `SetWindowTitle` 绑定，仅在实际变化时调用 |
| 22 | 「打开方式」列表不含 LitePad | 新增 `Applications\LitePad.exe` 登记（FriendlyAppName + shell\open\command + SupportedTypes），并随关联格式更新 |
| 23 | 「同时设为默认打开方式」每次打开都默认勾选，不看真实状态 | 回显注册表实际状态或上次偏好；偏好持久化 `setDefault` |
| 24 | `wails.Run` 失败仅 `fmt.Println`，windowsgui 下完全不可见 | 新增 `fatalDialog`（MessageBoxW） |
| 25 | 死代码：`highlightSelectionMatches` / `bookmarkCount` 未使用导入、`lang.go` 无效分支 | 清理 |
| 26 | Toast 无样式（裸 div）、启动失败无界面提示 | 补 `#toast` 浮层样式与 `.boot-error` 错误面板，boot 全程捕获异常 |

## 二、验证结果

| 项目 | 结果 |
|---|---|
| `gofmt -l` | 无输出 |
| `go vet`（本机 + GOOS=windows） | 通过 |
| `go test ./core/ -count=1` | 16/16 通过 |
| `go test -race ./core/ -count=1` | 通过，无竞态 |
| `pnpm run build` | 通过（889KB minified / 312KB gzip） |
| 浏览器冒烟测试（Playwright，29 项断言） | 29/29 通过，无未捕获前端错误 |
| Windows exe 交叉编译（CGO_ENABLED=0，-H windowsgui） | 通过，5.6MB |

冒烟覆盖：启动/会话恢复、脏标记与标题联动、书签 gutter、查找计数、Ctrl+S 写盘、预览渲染、
命令面板模糊匹配、右键菜单、设置三页签与 Esc 取消、主题应用与配置落盘、语言切换、外部修改自动重载。

## 三、遗留风险与后续建议

1. exe 版本信息（属性页）未嵌入，可用 `go-winres` 一并生成（README 已注明）。
2. 无 BOM 且以 CJK 为主的 UTF-16 文件无法启发式识别（NUL 占比过低），需 BOM 或手动切换编码。
3. 单实例转发未实现：双击多个关联文件会开多个窗口。
4. 书签不跨会话持久化；矩形列选、文件对比、插件系统仍未实现。
5. 前端 bundle 889KB（CodeMirror 全语法），可按需 dynamic import 语言包，当前加载耗时无感知问题。

---

## 1.1.1 修复（2026-11-16）

- **严重**：1.1.0 版 exe 用裸 `go build` 编译，缺少 Wails 必需的 `-tags desktop,production` 构建标签，启动即弹「Wails applications will not build without the correct build tags」错误框且不可用。已带标签重新构建，并同步修正 README 与 build\build.bat 中的构建命令。
- 佐证：新 exe 体积 11.7MB（前端资源已正确嵌入），旧 exe 5.6MB 实际未嵌入资源。
