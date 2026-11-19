import test from "node:test";
import assert from "node:assert/strict";
import {
  CTX_GROUPS,
  defaultContextMenu,
  normalizeContextMenu,
  editorMenuItems,
} from "../src/ctxmenu.js";

// 任意命令都返回 no-op；hasPath 供禁用态判断。
const noopCmd = new Proxy({ hasPath: false }, {
  get: (target, key) => (key in target ? target[key] : () => {}),
});

function prefsWithOnly(key) {
  const p = {};
  CTX_GROUPS.forEach((g) => { p[g.key] = g.key === key; });
  p.showShortcut = true;
  return p;
}

test("默认配置全部分组开启", () => {
  const p = defaultContextMenu();
  CTX_GROUPS.forEach((g) => assert.equal(p[g.key], true));
  assert.equal(p.showShortcut, true);
});

test("旧配置缺失字段时补默认值，非法类型被忽略", () => {
  const p = normalizeContextMenu({ clipboard: false, lines: "yes" });
  assert.equal(p.clipboard, false);
  assert.equal(p.lines, true);
  assert.equal(p.file, true);
});

test("关闭分组后不再生成该组菜单项", () => {
  const items = editorMenuItems(prefsWithOnly("file"), noopCmd);
  const labels = items.filter((i) => !i.sep).map((i) => i.label);
  assert.ok(labels.includes("保存"));
  assert.ok(!labels.includes("撤销"));
});

test("首尾与连续分隔符被规范化", () => {
  const items = editorMenuItems(defaultContextMenu(), noopCmd);
  assert.ok(items.length > 0);
  assert.equal(items[0].sep, undefined);
  assert.equal(items[items.length - 1].sep, undefined);
  for (let i = 1; i < items.length; i++) {
    assert.ok(!(items[i].sep && items[i - 1].sep), "不应出现连续分隔符");
  }
});

test("showShortcut 关闭后所有菜单项不带快捷键", () => {
  const p = { ...defaultContextMenu(), showShortcut: false };
  const items = editorMenuItems(p, noopCmd);
  assert.ok(items.filter((i) => !i.sep).every((i) => !i.shortcut));
});

test("无文件路径时复制路径/资源管理器项被禁用", () => {
  const items = editorMenuItems(prefsWithOnly("file"), noopCmd);
  const copyPath = items.find((i) => i.label === "复制文件路径");
  const reveal = items.find((i) => i.label === "在资源管理器中显示");
  assert.equal(copyPath.disabled, true);
  assert.equal(reveal.disabled, true);
});
