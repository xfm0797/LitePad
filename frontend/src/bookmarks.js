// bookmarks.js：行书签——StateField 存储、gutter 标记、跳转与清除。
import { StateField, StateEffect } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";

const toggleBookmarkEf = StateEffect.define(); // number[]（书签行起始位置，切换状态）
const clearBookmarksEf = StateEffect.define();

// 书签集合：存储各书签行的行首位置，文档编辑时自动映射。
export const bookmarkField = StateField.define({
  create: () => new Set(),
  update(set, tr) {
    let next = set;
    for (const e of tr.effects) {
      if (e.is(toggleBookmarkEf)) {
        next = new Set(next);
        for (const p of e.value) {
          if (next.has(p)) next.delete(p); else next.add(p);
        }
      } else if (e.is(clearBookmarksEf)) {
        next = new Set();
      }
    }
    if (tr.docChanged || next !== set) {
      const mapped = new Set();
      for (const p of next) {
        const m = tr.changes.mapPos(p, -1);
        if (m >= 0) mapped.add(m);
      }
      next = mapped;
    }
    return next;
  },
});

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "bm-marker";
    el.textContent = "◆";
    return el;
  }
}
const BOOKMARK = new BookmarkMarker();

// 书签 gutter 扩展（加入 buildExtensions；同时注册 bookmarkField）。
export function bookmarkGutter() {
  return [
    bookmarkField,
    gutter({
      class: "cm-bookmark-gutter",
      // 书签切换只派发 effect、不修改文档，默认的 docChanged 判定不会重绘 gutter，
      // 必须显式声明 effect 变化时也要刷新，否则标记要等到下次输入才出现。
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(toggleBookmarkEf) || e.is(clearBookmarksEf))),
      lineMarker(view, line) {
        const set = view.state.field(bookmarkField, false);
        return set && set.has(line.from) ? BOOKMARK : null;
      },
    }),
  ];
}

// 对当前选区覆盖的行切换书签。
export function toggleBookmark(view) {
  const doc = view.state.doc;
  const positions = [];
  for (const range of view.state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) positions.push(doc.line(n).from);
  }
  if (positions.length) {
    view.dispatch({ effects: toggleBookmarkEf.of(positions) });
    return true;
  }
  return false;
}

// 跳转到上/下一个书签（循环）。
export function gotoBookmark(view, forward = true) {
  const set = view.state.field(bookmarkField, false);
  if (!set || set.size === 0) return false;
  const positions = [...set].sort((a, b) => a - b);
  const head = view.state.selection.main.head;
  let target = null;
  if (forward) {
    target = positions.find((p) => p > head);
    if (target === undefined) target = positions[0];
  } else {
    for (const p of positions) { if (p < head) target = p; }
    if (target === null || target === undefined) target = positions[positions.length - 1];
  }
  if (target === null) return false;
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  view.focus();
  return true;
}

// 清除全部书签。
export function clearAllBookmarks(view) {
  view.dispatch({ effects: clearBookmarksEf.of(null) });
}

export function bookmarkCount(view) {
  return view.state.field(bookmarkField, false)?.size || 0;
}
