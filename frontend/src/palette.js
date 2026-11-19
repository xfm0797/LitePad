// palette.js：命令面板（Ctrl+Shift+P）与快速打开（Ctrl+P）共用的浮层组件。

// fuzzyScore 做子序列匹配并打分：连续命中、位置靠前得分更高，
// 比 includes 更符合“打几个字母就能跳到命令”的使用习惯。
// 不匹配返回 -1；导出以便单元测试。
export function fuzzyScore(label, q) {
  const s = label.toLowerCase();
  const query = q.toLowerCase();
  let idx = -1;
  let score = 0;
  let streak = 0;
  for (const ch of query) {
    const next = s.indexOf(ch, idx + 1);
    if (next < 0) return -1;
    if (next === idx + 1) {
      streak++;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    idx = next;
  }
  return score - s.length * 0.01;
}

export function createPalette({ container }) {
  const input = container.querySelector("#palette-input");
  const list = container.querySelector("#palette-list");
  let items = [];      // {label, hint, run}
  let filtered = [];
  let selected = 0;

  function renderList() {
    list.innerHTML = "";
    filtered.slice(0, 50).forEach((it, idx) => {
      const el = document.createElement("div");
      el.className = "palette-item" + (idx === selected ? " selected" : "");
      const label = document.createElement("span");
      label.textContent = it.label;
      el.appendChild(label);
      if (it.hint) {
        const hint = document.createElement("span");
        hint.className = "palette-hint";
        hint.textContent = it.hint;
        el.appendChild(hint);
      }
      el.addEventListener("click", () => { hide(); it.run(); });
      list.appendChild(el);
    });
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "无匹配项";
      list.appendChild(empty);
    }
  }

  function applyFilter() {
    const q = input.value.trim().toLowerCase();
    if (q === "") {
      filtered = items;
    } else {
      filtered = items
        .map((it, i) => ({ it, i, score: fuzzyScore(it.label, q) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((x) => x.it);
    }
    selected = 0;
    renderList();
  }

  input.addEventListener("input", applyFilter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selected = Math.min(selected + 1, Math.max(0, filtered.length - 1)); renderList(); scrollSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selected = Math.max(selected - 1, 0); renderList(); scrollSel(); }
    else if (e.key === "Enter") { e.preventDefault(); const it = filtered[selected]; if (it) { hide(); it.run(); } }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });

  function scrollSel() {
    const el = list.querySelector(".palette-item.selected");
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function show(title, sourceItems) {
    items = sourceItems;
    container.querySelector("#palette-title").textContent = title;
    container.classList.remove("hidden");
    input.value = "";
    applyFilter();
    input.focus();
  }

  function hide() {
    container.classList.add("hidden");
  }

  // 焦点不在输入框时也允许 Esc 关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !container.classList.contains("hidden")) {
      e.preventDefault();
      hide();
    }
  });

  container.addEventListener("mousedown", (e) => {
    if (e.target === container) hide();
  });

  return { show, hide };
}
