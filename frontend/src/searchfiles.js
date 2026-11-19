// searchfiles.js：「在文件中查找」结果面板。
// 搜索在后端执行，前端只负责参数、结果展示与跳转，避免阻塞 WebView。
import { showError } from "./dialogs.js";

function relPath(path, root) {
  const norm = (s) => String(s || "").replace(/\\/g, "/");
  const base = norm(root).replace(/\/+$/, "");
  const full = norm(path);
  return full.startsWith(base + "/") ? full.slice(base.length + 1) : full;
}

export function createSearchFiles({ app, getRoot, onOpen }) {
  const panel = document.querySelector("#search-results");
  const query = panel.querySelector("#sr-query");
  const root = panel.querySelector("#sr-root");
  const caseBox = panel.querySelector("#sr-case");
  const wordBox = panel.querySelector("#sr-word");
  const runBtn = panel.querySelector("#sr-run");
  const closeBtn = panel.querySelector("#sr-close");
  const summary = panel.querySelector("#sr-summary");
  const list = panel.querySelector("#sr-list");

  let visible = false;
  let seq = 0;

  function show() {
    visible = true;
    panel.classList.remove("hidden");
    if (!root.value.trim()) root.value = getRoot() || "";
    query.focus();
    query.select();
  }

  function close() {
    visible = false;
    seq++; // 让在途请求的结果失效
    panel.classList.add("hidden");
  }

  function isOpen() { return visible; }

  async function run() {
    const q = query.value.trim();
    const dir = root.value.trim();
    if (!q) { query.focus(); return; }
    if (!dir) { root.focus(); summary.textContent = "请填写要搜索的文件夹路径"; return; }
    const A = app();
    if (!A) return;

    const mySeq = ++seq;
    runBtn.disabled = true;
    summary.textContent = "搜索中…";
    list.replaceChildren();
    try {
      const res = await A.FindInFiles(dir, q, {
        caseSensitive: !!caseBox.checked,
        wholeWord: !!wordBox.checked,
        maxResults: 500,
      });
      if (mySeq !== seq) return;
      render(res, dir);
    } catch (e) {
      if (mySeq !== seq) return;
      summary.textContent = "";
      await showError("在文件中查找失败：" + ((e && e.message) || e));
    } finally {
      if (mySeq === seq) runBtn.disabled = false;
    }
  }

  function render(res, dir) {
    const results = (res && res.results) || [];
    summary.textContent = `${results.length} 个结果${res && res.truncated ? "（已截断）" : ""}`
      + ` · 扫描 ${(res && res.scanned) || 0} 个文件`;
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "sr-empty";
      empty.textContent = "未找到匹配内容。";
      list.replaceChildren(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const r of results) {
      const row = document.createElement("div");
      row.className = "sr-row";
      row.title = r.path;
      const loc = document.createElement("span");
      loc.className = "sr-loc";
      loc.textContent = `${relPath(r.path, dir)}:${r.line}`;
      const text = document.createElement("span");
      text.className = "sr-text";
      text.textContent = String(r.text || "").replace(/^\s+/, "");
      row.append(loc, text);
      row.addEventListener("click", () => onOpen(r.path, r.line));
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  }

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target === query || e.target === root)) {
      e.preventDefault();
      run();
    } else if (e.key === "Escape") {
      close();
    }
  });
  runBtn.addEventListener("click", run);
  closeBtn.addEventListener("click", close);

  return { show, close, isOpen };
}
