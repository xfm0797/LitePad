// outline.js：函数列表 / 大纲侧栏。
// 对各常用语言用轻量正则提取符号（比遍历 Lezer 语法树轻且跨语言一致），
// 对 Markdown 则提取标题层级；点击项定位行号，当前行所在项高亮。

const RULES = {
  go: [
    { re: /^func\s*(?:\([^)]*\))?\s*([A-Za-z_]\w*)\s*\(/m, kind: "ƒ" },
    { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/m, kind: "T" },
  ],
  python: [
    { re: /^\s*async\s+def\s+([A-Za-z_]\w*)\s*\(/m, kind: "⚡" },
    { re: /^\s*def\s+([A-Za-z_]\w*)\s*\(/m, kind: "ƒ" },
    { re: /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/m, kind: "C" },
  ],
  javascript: [
    { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/m, kind: "ƒ" },
    { re: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\s*\()/m, kind: "ƒ" },
    { re: /^\s*class\s+([A-Za-z_$][\w$]*)/m, kind: "C" },
  ],
  markdown: [
    // setext 标题（--- / === 底线式）+ ATX（# 开头）
    { re: /^(.+)\n\s*=+\s*$/m, kind: "H1" },
    { re: /^(.+)\n\s*-{3,}\s*$/m, kind: "H2" },
    { re: /^(#{1,6})\s+(.+?)\s*#*\s*$/m, kind: "ATX" },
  ],
  html: [
    { re: /id="([A-Za-z_][\w-]*)"/m, kind: "#" },
  ],
  css: [
    { re: /^([^{}]+?)\s*\{/m, kind: "{" },
  ],
  json: [
    { re: /^ {2}"([A-Za-z_]\w*)"\s*:/m, kind: "·" },
  ],
  yaml: [
    { re: /^([A-Za-z_][\w-]*):\s*$/m, kind: ":" },
  ],
  cpp: [
    { re: /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:const\s*)?\{/m, kind: "ƒ" },
    { re: /^(?:class|struct)\s+([A-Za-z_]\w*)/m, kind: "C" },
    { re: /^namespace\s+([A-Za-z_]\w+)/m, kind: "ns" },
  ],
  sql: [
    { re: /^\s*CREATE(?:\s+OR\s+REPLACE)?\s+(?:FUNCTION|PROCEDURE|VIEW|TRIGGER)\s+([A-Za-z_]\w*)/im, kind: "∑" },
  ],
};

function extractSymbols(text, language) {
  const rules = RULES[language];
  if (!rules) return [];
  const out = [];
  for (const rule of rules) {
    let m;
    rule.re.lastIndex = 0;
    while ((m = rule.re.exec(text)) !== null) {
      let label, kind = rule.kind;
      if (kind === "ATX") {
        const lvl = m[1].length;
        label = m[2];
        kind = String(lvl);
      } else {
        label = m[1];
      }
      if (!label) continue;
      const lineNum = text.slice(0, m.index).split("\n").length;
      out.push({ line: lineNum, label: label.trim(), kind });
    }
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

export function createOutline({ viewRef, tabRef, langFor }) {
  const pane = document.querySelector("#outline-pane");
  if (!pane) return null;
  const list = pane.querySelector("#outline-list");
  const empty = pane.querySelector("#outline-empty");
  let visible = false;
  let symbols = [];

  function toggle() {
    visible = !visible;
    pane.classList.toggle("hidden", !visible);
    if (visible) render();
  }

  function isOn() { return visible; }

  function gotoLine(n) {
    const view = viewRef();
    if (!view) return;
    const doc = view.state.doc;
    if (n < 1 || n > doc.lines) return;
    const pos = doc.line(n).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  function cursorLine(view) {
    if (!view) return -1;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  // 光标行落到哪个符号范围内：找 line <= cl 的最后一个符号
  function activeSymbolFor(cl) {
    let hit = -1;
    for (let i = 0; i < symbols.length; i++) {
      if (symbols[i].line <= cl) hit = i;
      else break;
    }
    return hit;
  }

  function render() {
    const tab = tabRef();
    if (!tab) return;
    const view = viewRef();
    if (!view) return;
    const language = langFor(tab.path) || "";
    symbols = extractSymbols(view.state.doc.toString(), language);

    if (!symbols.length) {
      list.replaceChildren();
      empty.classList.remove("hidden");
      empty.textContent = language
        ? "当前语言暂无符号可提取（支持 Go/Python/JS/Markdown/HTML/CSS/JSON/YAML/C++/SQL）"
        : "纯文本模式无大纲";
      return;
    }
    empty.classList.add("hidden");
    const cl = cursorLine(view);
    const idx = activeSymbolFor(cl);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      const row = document.createElement("div");
      row.className = "ow-row" + (i === idx ? " ow-active" : "");
      row.dataset.line = s.line;
      const kind = document.createElement("span");
      kind.className = "ow-kind";
      kind.textContent = s.kind;
      const lbl = document.createElement("span");
      lbl.className = "ow-label";
      lbl.textContent = s.label;
      row.append(kind, lbl);
      row.addEventListener("click", () => gotoLine(s.line));
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  }

  function onUpdate(update) {
    if (!visible) return;
    // docChanged 时全量重建，selectionSet 时只更新高亮
    if (update.docChanged) {
      queueMicrotask(render);
      return;
    }
    const cl = cursorLine(update.view);
    const idx = activeSymbolFor(cl);
    list.querySelectorAll(".ow-row.ow-active").forEach((r) => r.classList.remove("ow-active"));
    const row = list.querySelector(`.ow-row:nth-child(${idx + 1})`);
    if (row) {
      row.classList.add("ow-active");
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function switchTo() {
    if (visible) render();
  }

  return { toggle, isOn, refresh: render, switchTo, onUpdate };
}
