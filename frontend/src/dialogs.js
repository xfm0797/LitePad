// dialogs.js：模态框、错误提示、Toast、下拉选择与右键菜单的通用实现。
// 模态框按队列串行展示：文件变更提示与保存提示同时出现时不会互相覆盖，
// 也不会留下永远不 resolve 的 Promise。

const $ = (sel) => document.querySelector(sel);

const modalQueue = [];
let currentJob = null;
let settling = false;

export function isModalOpen() {
  return currentJob !== null;
}

// showModal 展示模态框，返回按钮 collect 的结果。
// buttons: [{ label, primary?, collect?(body) }]；Esc 触发「取消」按钮。
export function showModal(msg, buttons, bodyBuilder, opts = {}) {
  return new Promise((resolve) => {
    modalQueue.push({ msg, buttons, bodyBuilder, opts, resolve });
    if (!currentJob && !settling) pumpModal();
  });
}

function pumpModal() {
  if (currentJob || settling) return;
  const job = modalQueue.shift();
  if (!job) return;
  currentJob = job;
  renderModal(job);
}

function renderModal(job) {
  const mask = $("#modal-mask");
  $("#modal-msg").textContent = job.msg;
  $("#modal").classList.toggle("wide", !!job.opts.wide);
  const body = $("#modal-body");
  body.innerHTML = "";
  if (job.bodyBuilder) job.bodyBuilder(body);
  const btnBox = $("#modal-btns");
  btnBox.innerHTML = "";
  job.buttons.forEach((b) => {
    const el = document.createElement("button");
    el.textContent = b.label;
    if (b.primary) el.className = "primary";
    el.addEventListener("click", () => settle(b));
    btnBox.appendChild(el);
  });
  mask.classList.remove("hidden");
  const first = body.querySelector("input, select, textarea, button");
  if (first) first.focus();
}

function cancelButton(job) {
  return job.buttons.find((b) => b.label === "取消") || job.buttons[job.buttons.length - 1];
}

async function settle(button) {
  if (!currentJob || settling) return;
  settling = true;
  const job = currentJob;
  let result = null;
  try {
    result = button && button.collect ? await button.collect($("#modal-body")) : null;
  } catch (e) {
    console.error("模态框收集数据失败", e);
    result = null;
  }
  $("#modal-mask").classList.add("hidden");
  $("#modal").classList.remove("wide");
  currentJob = null;
  settling = false;
  job.resolve(result);
  pumpModal();
}

export async function showError(e) {
  const text = String((e && e.message) || e || "未知错误");
  await showModal(text, [{ label: "确定", primary: true, collect: () => null }]);
}

// toast 展示不阻塞操作的轻提示。
export function toast(msg, ms = 2800) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), ms);
}

// pickFromList 用下拉框选择一个值（取消返回 null）。
export function pickFromList(title, options, current) {
  return showModal(title, [
    { label: "确定", primary: true, collect: (b) => b.querySelector("select").value },
    { label: "取消", collect: () => null },
  ], (b) => {
    const sel = document.createElement("select");
    options.forEach(([value, label]) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      if (value === current) o.selected = true;
      sel.appendChild(o);
    });
    b.appendChild(sel);
  });
}

// ---------- 右键菜单 ----------
export function showContextMenu(x, y, items) {
  const menu = $("#ctxmenu");
  menu.innerHTML = "";
  items.forEach((item) => {
    if (item.sep) {
      const s = document.createElement("div");
      s.className = "menu-sep";
      menu.appendChild(s);
      return;
    }
    const e = document.createElement("div");
    e.className = "menu-entry";
    const label = document.createElement("span");
    label.textContent = item.label;
    e.appendChild(label);
    if (item.shortcut) {
      const sc = document.createElement("span");
      sc.className = "shortcut";
      sc.textContent = item.shortcut;
      e.appendChild(sc);
    }
    e.title = item.title || "";
    if (item.disabled) e.classList.add("disabled");
    else e.addEventListener("click", () => { hideContextMenu(); item.run(); });
    menu.appendChild(e);
  });
  menu.classList.add("open");
  // 先归零再测量，避免上一次定位影响尺寸
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(0, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
}

export function hideContextMenu() {
  $("#ctxmenu").classList.remove("open");
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("#editor-host, #tabs, #ctxmenu")) hideContextMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (currentJob && !settling) {
    e.preventDefault();
    e.stopPropagation();
    settle(cancelButton(currentJob));
  } else {
    hideContextMenu();
  }
}, true);
