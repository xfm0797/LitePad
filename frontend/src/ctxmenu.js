// ctxmenu.js：编辑器右键菜单的组装逻辑。
// 菜单按「分组」组织，用户在 设置 → 右键菜单 中可勾选要显示的分组，
// 命令实现由 main.js 注入（cmd 对象），本模块保持无副作用、便于测试。

// 分组元信息（顺序即菜单顺序）。
export const CTX_GROUPS = [
  { key: "clipboard", label: "剪贴板" },
  { key: "lines", label: "行操作" },
  { key: "transform", label: "文本转换" },
  { key: "navigate", label: "查找与书签" },
  { key: "view", label: "显示" },
  { key: "file", label: "文件" },
];

// 默认全开（与 Go 端 core.DefaultContextMenu 保持一致）。
export function defaultContextMenu() {
  const prefs = { showShortcut: true };
  CTX_GROUPS.forEach((g) => { prefs[g.key] = true; });
  return prefs;
}

// 补全历史配置缺失的分组字段。
export function normalizeContextMenu(prefs) {
  const def = defaultContextMenu();
  if (!prefs || typeof prefs !== "object") return def;
  const out = { ...def };
  CTX_GROUPS.forEach((g) => {
    if (typeof prefs[g.key] === "boolean") out[g.key] = prefs[g.key];
  });
  if (typeof prefs.showShortcut === "boolean") out.showShortcut = prefs.showShortcut;
  return out;
}

// 各组菜单项。cmd 中的函数由 main.js 提供。
const GROUP_ITEMS = {
  clipboard: (c) => [
    { label: "撤销", shortcut: "Ctrl+Z", run: c.undo },
    { label: "重做", shortcut: "Ctrl+Y", run: c.redo },
    { sep: true },
    { label: "剪切", shortcut: "Ctrl+X", run: c.cut },
    { label: "复制", shortcut: "Ctrl+C", run: c.copy },
    { label: "粘贴", shortcut: "Ctrl+V", run: c.paste },
    { sep: true },
    { label: "全选", shortcut: "Ctrl+A", run: c.selectAll },
  ],
  lines: (c) => [
    { label: "复制并插入当前行", shortcut: "Ctrl+D", run: c.copyLineDown },
    { label: "删除当前行", shortcut: "Ctrl+L", run: c.deleteLine },
    { label: "当前行上移", shortcut: "Ctrl+Shift+↑", run: c.moveLineUp },
    { label: "当前行下移", shortcut: "Ctrl+Shift+↓", run: c.moveLineDown },
    { sep: true },
    { label: "行升序排序", run: c.sortAsc },
    { label: "行降序排序", run: c.sortDesc },
    { label: "删除重复行", run: c.dedupe },
    { label: "删除空行", run: c.removeEmpty },
    { label: "修剪行尾空格", run: c.trim },
  ],
  transform: (c) => [
    { label: "转换为大写", shortcut: "Ctrl+Shift+U", run: c.upper },
    { label: "转换为小写", shortcut: "Ctrl+U", run: c.lower },
    { label: "行首字母大写", run: c.capitalize },
    { sep: true },
    { label: "Tab 转空格", run: c.tabToSpaces },
    { label: "行首空格转 Tab", run: c.spacesToTab },
    { label: "插入日期时间", run: c.insertDate },
  ],
  navigate: (c) => [
    { label: "查找…", shortcut: "Ctrl+F", run: c.find },
    { label: "替换…", shortcut: "Ctrl+H", run: c.replace },
    { label: "转到行…", shortcut: "Ctrl+G", run: c.gotoLine },
    { sep: true },
    { label: "添加/移除书签", shortcut: "Ctrl+F2", run: c.toggleBookmark },
    { label: "下一个书签", shortcut: "F2", run: c.nextBookmark },
    { label: "命令面板…", shortcut: "Ctrl+Shift+P", run: c.palette },
  ],
  view: (c) => [
    { label: "自动换行", run: c.wrap },
    { label: "显示空白字符", run: c.whitespace },
    { label: "Markdown 实时预览", shortcut: "Ctrl+Shift+V", run: c.preview },
    { sep: true },
    { label: "放大字体", shortcut: "Ctrl+=", run: c.zoomIn },
    { label: "缩小字体", shortcut: "Ctrl+-", run: c.zoomOut },
    { label: "重置字体", shortcut: "Ctrl+0", run: c.zoomReset },
  ],
  file: (c) => [
    { label: "保存", shortcut: "Ctrl+S", run: c.save },
    { label: "另存为…", shortcut: "Ctrl+Shift+S", run: c.saveAs },
    { sep: true },
    { label: "复制文件路径", run: c.copyPath, disabled: !c.hasPath },
    { label: "在资源管理器中显示", run: c.reveal, disabled: !c.hasPath },
    { sep: true },
    { label: "关闭标签", shortcut: "Ctrl+W", run: c.closeTab },
  ],
};

// 组装最终菜单项列表；分隔符会被规范化（去掉连续与首尾分隔）。
export function editorMenuItems(prefs, cmd) {
  const cfg = normalizeContextMenu(prefs);
  const items = [];
  for (const g of CTX_GROUPS) {
    if (!cfg[g.key]) continue;
    const group = GROUP_ITEMS[g.key](cmd) || [];
    if (group.length === 0) continue;
    if (items.length > 0) items.push({ sep: true });
    for (const it of group) {
      if (it.sep) {
        if (items.length && !items[items.length - 1].sep) items.push({ sep: true });
        continue;
      }
      items.push(cfg.showShortcut ? it : { ...it, shortcut: "" });
    }
  }
  while (items.length && items[items.length - 1].sep) items.pop();
  return items;
}
