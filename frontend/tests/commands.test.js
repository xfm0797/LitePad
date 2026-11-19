import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  toggleCase,
  capitalizeLines,
  sortLines,
  removeDuplicateLines,
  removeEmptyLines,
  trimTrailingSpaces,
  tabToSpaces,
  spacesToTab,
} from "../src/commands.js";

// 命令只依赖 state 与 dispatch，用最小 view 桩即可在 Node 中测试。
function makeView(doc, anchor = 0, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head } });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
  };
}

test("sortLines 对全文升序/降序排序", () => {
  const v = makeView("b\nc\na");
  sortLines(v, false);
  assert.equal(v.state.doc.toString(), "a\nb\nc");
  sortLines(v, true);
  assert.equal(v.state.doc.toString(), "c\nb\na");
});

test("sortLines 仅作用于选区覆盖的行", () => {
  // 第 2~3 行 "b\na" 被选中，第 1、4 行保持不动
  const v = makeView("x\nb\na\ny", 2, 5);
  sortLines(v, false);
  assert.equal(v.state.doc.toString(), "x\na\nb\ny");
});

test("removeDuplicateLines 保序去重", () => {
  const v = makeView("a\nb\na\nc\nb");
  removeDuplicateLines(v);
  assert.equal(v.state.doc.toString(), "a\nb\nc");
});

test("removeEmptyLines 删除空白行", () => {
  const v = makeView("a\n\n  \nb");
  removeEmptyLines(v);
  assert.equal(v.state.doc.toString(), "a\nb");
});

test("trimTrailingSpaces 清理行尾空白", () => {
  const v = makeView("a  \nb\t\nc");
  trimTrailingSpaces(v);
  assert.equal(v.state.doc.toString(), "a\nb\nc");
});

test("tabToSpaces 按 tabSize 展开制表符", () => {
  const v = makeView("a\tb");
  tabToSpaces(v, 2);
  assert.equal(v.state.doc.toString(), "a  b");
});

test("spacesToTab 仅转换行首缩进", () => {
  const v = makeView("    a\n  b");
  spacesToTab(v, 4);
  assert.equal(v.state.doc.toString(), "\ta\n  b");
});

test("toggleCase 支持全文与选区", () => {
  const all = makeView("abC");
  toggleCase(all, true);
  assert.equal(all.state.doc.toString(), "ABC");

  const sel = makeView("abc def", 4, 7);
  toggleCase(sel, true);
  assert.equal(sel.state.doc.toString(), "abc DEF");
});

test("capitalizeLines 每行首字母大写", () => {
  const v = makeView("hello\nworld");
  capitalizeLines(v);
  assert.equal(v.state.doc.toString(), "Hello\nWorld");
});
