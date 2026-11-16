// find.js：查找/替换面板逻辑（正则、区分大小写、全部替换）。
import { SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from "@codemirror/search";
import { isModalOpen } from "./dialogs.js";

export function createFindPanel({ viewRef, container, onCount }) {
  const findInput = container.querySelector("#find-input");
  const replaceInput = container.querySelector("#replace-input");
  const btnCase = container.querySelector("#toggle-case");
  const btnRegex = container.querySelector("#toggle-regex");
  const countEl = container.querySelector("#find-count");

  const state = { caseSensitive: false, regexp: false, wholeWord: false };

  function buildQuery() {
    return new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: state.caseSensitive,
      regexp: state.regexp,
      wholeWord: state.wholeWord,
    });
  }

  function syncButtons() {
    btnCase.classList.toggle("on", state.caseSensitive);
    btnRegex.classList.toggle("on", state.regexp);
    const btnWord = container.querySelector("#toggle-word");
    if (btnWord) btnWord.classList.toggle("on", state.wholeWord);
  }

  // 统计命中数。注意：非正则模式应对“搜索词”做转义，而不是对文档内容转义。
  function countMatches(text, query) {
    if (!query.search) return 0;
    try {
      let src = query.regexp ? query.search : query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (query.wholeWord) src = `\\b(?:${src})\\b`;
      const re = new RegExp(src, query.caseSensitive ? "g" : "gi");
      return (text.match(re) || []).length;
    } catch {
      return null; // 正则非法
    }
  }

  // 大文档跳过全量计数，避免每次按键 O(n) 扫描卡顿
  const COUNT_LIMIT = 2 * 1024 * 1024;

  let countTimer = null;
  function updateCount() {
    const view = viewRef();
    if (!view) return;
    const q = buildQuery();
    if (!q.search) { countEl.textContent = ""; return; }
    if (view.state.doc.length > COUNT_LIMIT) { countEl.textContent = "大文件不计数"; return; }
    const total = countMatches(view.state.doc.toString(), q);
    countEl.textContent = total === null ? "正则无效" : `共 ${total} 处`;
  }

  function apply(focusNext = false) {
    const view = viewRef();
    if (!view) return;
    const q = buildQuery();
    view.dispatch({ effects: setSearchQuery.of(q) });
    clearTimeout(countTimer);
    // 输入时延迟统计，避免长文档逐键扫描
    countTimer = setTimeout(updateCount, 120);
    if (focusNext && q.search !== "") findNext(view);
  }

  findInput.addEventListener("input", () => apply(false));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = viewRef();
      if (!v) return;
      v.dispatch({ effects: setSearchQuery.of(buildQuery()) });
      e.shiftKey ? findPrevious(v) : findNext(v);
    } else if (e.key === "Escape") {
      hide();
    }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = viewRef();
      if (!v) return;
      v.dispatch({ effects: setSearchQuery.of(buildQuery()) });
      replaceNext(v);
    } else if (e.key === "Escape") {
      hide();
    }
  });

  btnCase.addEventListener("click", () => { state.caseSensitive = !state.caseSensitive; syncButtons(); apply(true); });
  btnRegex.addEventListener("click", () => { state.regexp = !state.regexp; syncButtons(); apply(true); });
  const btnWord = container.querySelector("#toggle-word");
  if (btnWord) btnWord.addEventListener("click", () => { state.wholeWord = !state.wholeWord; syncButtons(); apply(true); });

  container.querySelector("#btn-find-next").addEventListener("click", () => {
    const v = viewRef();
    if (v) { v.dispatch({ effects: setSearchQuery.of(buildQuery()) }); findNext(v); }
  });
  container.querySelector("#btn-find-prev").addEventListener("click", () => {
    const v = viewRef();
    if (v) { v.dispatch({ effects: setSearchQuery.of(buildQuery()) }); findPrevious(v); }
  });
  container.querySelector("#btn-replace-one").addEventListener("click", () => {
    const v = viewRef();
    if (v) { v.dispatch({ effects: setSearchQuery.of(buildQuery()) }); replaceNext(v); }
  });
  container.querySelector("#btn-replace-all").addEventListener("click", () => {
    const v = viewRef();
    if (v) { v.dispatch({ effects: setSearchQuery.of(buildQuery()) }); replaceAll(v); }
  });
  container.querySelector("#btn-find-close").addEventListener("click", hide);

  function show() {
    container.classList.remove("hidden");
    syncButtons();
    findInput.focus();
    findInput.select();
  }

  // 焦点不在面板内时也允许 Esc 关闭；模态框打开时让位给对话框。
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !isModalOpen() && !container.classList.contains("hidden")) {
      e.preventDefault();
      hide();
    }
  });

  function hide() {
    container.classList.add("hidden");
    const v = viewRef();
    if (v) {
      // 清除命中高亮
      v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
      v.focus();
    }
  }

  return { show, hide, isOpen: () => !container.classList.contains("hidden"), focusReplace: () => replaceInput.focus() };
}
