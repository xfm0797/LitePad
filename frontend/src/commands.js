// commands.js：Notepad++ 风格文本命令——大小写、行排序/去重、修剪、Tab 转换等。
// 约定：有选区时作用于选区覆盖的行，否则作用于全文。
import { EditorSelection } from "@codemirror/state";

function selectionOrAll(view) {
  const sel = view.state.selection.main;
  return sel.empty ? { from: 0, to: view.state.doc.length } : sel;
}

// 选区（或全文）覆盖的行范围 [firstLine, lastLine]
function lineSpan(view, range) {
  const doc = view.state.doc;
  const first = doc.lineAt(range.from).number;
  const last = doc.lineAt(range.to).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n));
  return lines;
}

function replaceRange(view, from, to, text) {
  view.dispatch({ changes: { from, to, insert: text } });
}

// ---------- 大小写 ----------
export function toggleCase(view, toUpper) {
  const sel = view.state.selection.main;
  const { from, to } = sel.empty ? { from: 0, to: view.state.doc.length } : sel;
  const text = view.state.sliceDoc(from, to);
  const mapped = toUpper ? text.toUpperCase() : text.toLowerCase();
  replaceRange(view, from, to, mapped);
}

// 行首字母大写（每行）
export function capitalizeLines(view) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const doc = view.state.doc;
  const changes = [];
  for (const l of lines) {
    if (l.text.length === 0) continue;
    const ch = l.text[0];
    const upper = ch.toUpperCase();
    if (ch !== upper) changes.push({ from: l.from, to: l.from + 1, insert: upper });
  }
  if (changes.length) view.dispatch({ changes });
}

// ---------- 行级操作 ----------
export function sortLines(view, desc = false) {
  const range = selectionOrAll(view);
  const doc = view.state.doc;
  const lines = lineSpan(view, range);
  const texts = lines.map((l) => l.text).sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  if (desc) texts.reverse();
  replaceRange(view, lines[0].from, lines[lines.length - 1].to, texts.join("\n"));
}

export function removeDuplicateLines(view) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    if (!seen.has(l.text)) { seen.add(l.text); out.push(l.text); }
  }
  replaceRange(view, lines[0].from, lines[lines.length - 1].to, out.join("\n"));
}

export function removeEmptyLines(view) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const out = lines.filter((l) => l.text.trim().length > 0).map((l) => l.text);
  replaceRange(view, lines[0].from, lines[lines.length - 1].to, out.join("\n"));
}

export function trimTrailingSpaces(view) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const changes = [];
  for (const l of lines) {
    const trimmed = l.text.replace(/\s+$/, "");
    if (trimmed !== l.text) changes.push({ from: l.from, to: l.to, insert: trimmed });
  }
  if (changes.length) view.dispatch({ changes });
}

// ---------- Tab / 空格 ----------
export function tabToSpaces(view, tabSize = 4) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const changes = [];
  for (const l of lines) {
    if (l.text.includes("\t")) {
      changes.push({ from: l.from, to: l.to, insert: l.text.replaceAll("\t", " ".repeat(tabSize)) });
    }
  }
  if (changes.length) view.dispatch({ changes });
}

export function spacesToTab(view, tabSize = 4) {
  const range = selectionOrAll(view);
  const lines = lineSpan(view, range);
  const changes = [];
  for (const l of lines) {
    const m = l.text.match(/^( +)/); // 仅处理行首缩进
    if (m) {
      const spaces = m[1];
      const tabs = "\t".repeat(Math.floor(spaces.length / tabSize)) + " ".repeat(spaces.length % tabSize);
      if (tabs !== spaces) changes.push({ from: l.from, to: l.from + spaces.length, insert: tabs });
    }
  }
  if (changes.length) view.dispatch({ changes });
}

// ---------- 插入 ----------
export function insertDateTime(view) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  view.dispatch(view.state.replaceSelection(stamp));
}

// ---------- 多光标 ----------
// 在每个光标的上/下一行同列位置添加光标（Ctrl+Alt+↑/↓）。
export function addCursorVertical(view, dir) {
  const doc = view.state.doc;
  const ranges = [...view.state.selection.ranges];
  const seen = new Set(ranges.map((r) => r.head));
  for (const r of [...ranges]) { // 迭代副本，避免级联复制光标
    const line = doc.lineAt(r.head);
    const col = r.head - line.from;
    const n = line.number + dir;
    if (n < 1 || n > doc.lines) continue;
    const target = doc.line(n);
    const pos = Math.min(target.from + col, target.to);
    if (!seen.has(pos)) {
      seen.add(pos);
      ranges.push(EditorSelection.cursor(pos));
    }
  }
  ranges.sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  view.dispatch({ selection: EditorSelection.create(ranges) });
  view.focus();
}

// 将多光标合并为单个光标（Esc）。
export function collapseCursors(view) {
  if (view.state.selection.ranges.length > 1) {
    view.dispatch({ selection: EditorSelection.single(view.state.selection.main.head) });
    return true;
  }
  return false;
}
