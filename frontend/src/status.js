// status.js：状态栏渲染与交互。
// 只在文本真正变化时写 DOM：光标移动非常频繁，避免无谓的重排。
import { langLabel } from "./editor.js";

const BASE_FONT_SIZE = 14;

export function createStatus({ viewRef, tabRef, cfgRef, onEncoding, onEOL, onLanguage, onZoomReset }) {
  const $ = (sel) => document.querySelector(sel);

  function setText(sel, text) {
    const el = $(sel);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function update() {
    const tab = tabRef();
    const view = viewRef();
    if (!tab || !view) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const sel = view.state.selection.main;
    setText("#st-pos", `行 ${line.number}, 列 ${head - line.from + 1}`);
    setText("#st-sel", `选中 ${Math.max(0, sel.to - sel.from)}`);
    // 字符数按 UTF-16 码元计（与编辑器内部长度一致，含 emoji 时可能与“可见字数”略有差异）
    setText("#st-chars", `字符 ${view.state.doc.length}`);
    setText("#st-lines", `行数 ${view.state.doc.lines}`);
    const size = Number(cfgRef().fontSize) || BASE_FONT_SIZE;
    setText("#st-zoom", `${Math.round((size / BASE_FONT_SIZE) * 100)}%`);
    setText("#st-lang", langLabel(tab.language));
    setText("#st-enc", tab.encoding);
    setText("#st-eol", tab.eol);
  }

  function init() {
    $("#st-enc").addEventListener("click", onEncoding);
    $("#st-eol").addEventListener("click", onEOL);
    $("#st-lang").addEventListener("click", onLanguage);
    $("#st-zoom").addEventListener("click", onZoomReset);
  }

  return { update, init };
}
