// main.js：应用编排层——标签管理、文件操作、菜单、快捷键、会话与配置、
// 外部文件修改同步。通用 UI（对话框/工具箱/设置/预览/状态栏）拆分到独立模块。
import "./style.css";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo, moveLineUp, moveLineDown, copyLineDown, deleteLine } from "@codemirror/commands";
import {
  buildExtensions, langEffect, configEffects, applyConfigToState, langForPath, langLabel, languageOptions,
} from "./editor.js";
import { createFindPanel } from "./find.js";
import { createSearchFiles } from "./searchfiles.js";
import { createPalette } from "./palette.js";
import { createPreview } from "./preview.js";
import { createOutline } from "./outline.js";
import { createStatus } from "./status.js";
import { openSettings } from "./settings.js";
import { showModal, showError, toast, pickFromList, showContextMenu } from "./dialogs.js";
import { toolJSON, toolBase64, toolURL, toolTimestamp, showRegexTester } from "./tools.js";
import {
  toggleCase, capitalizeLines, sortLines, removeDuplicateLines, removeEmptyLines,
  trimTrailingSpaces, tabToSpaces, spacesToTab, insertDateTime,
  addCursorVertical, collapseCursors,
} from "./commands.js";
import { toggleBookmark, gotoBookmark, clearAllBookmarks } from "./bookmarks.js";
import { editorMenuItems, normalizeContextMenu } from "./ctxmenu.js";

const $ = (sel) => document.querySelector(sel);
const App = () => window.go && window.go.main && window.go.main.App;
const onEvent = (name, cb) => {
  if (window.runtime && window.runtime.EventsOn) window.runtime.EventsOn(name, cb);
};

// ---------- 全局状态 ----------
let cfg = null;      // core.Config（由 Go 侧持久化）
let ed = null;       // { view: EditorView }
let tabs = [];       // {id, name, path, state, encoding, eol, language, rev, savedRev}
let activeId = null;
let tabSeq = 0;
let find = null;     // 查找替换面板
let searchFiles = null; // 在文件中查找面板
let palette = null;  // 命令面板
let status = null;   // 状态栏
let preview = null;  // Markdown 预览
let outline = null;  // 大纲侧栏
let fullscreen = false;
let lastUnsaved = false; // 上次同步给 Go 侧的脏状态，避免每次按键都发 IPC
const closedStack = []; // 最近关闭的非空标签路径，Ctrl+Shift+T 弹出

const ENCODINGS = ["UTF-8", "UTF-8 BOM", "GBK", "ANSI (GB18030)", "UTF-16 LE", "UTF-16 BE"];
const BASE_FONT_SIZE = 14;
// 大文件阈值：超过后自动禁用语法高亮以保证流畅
const LARGE_FILE_BYTES = 5 * 1024 * 1024;

function activeTab() { return tabs.find((t) => t.id === activeId) || null; }

// 取标签当前内容对应的 EditorState：活动标签以视图为准，后台标签用快照。
// 注意：后台标签绝不能用 ed.view.state（那是另一个文件的内容）。
function stateOf(t) {
  if (!t) return null;
  if (t.id === activeId && ed) return ed.view.state;
  return t.state;
}
function isDirty(t) { return t && t.rev !== t.savedRev; }

// pathKey 用于比较“同一个文件”：Windows 路径不区分大小写且分隔符可混用。
function pathKey(p) {
  if (!p) return "";
  const s = p.replace(/\//g, "\\");
  return /^[a-zA-Z]:\\/.test(s) ? s.toLowerCase() : s;
}

// ---------- 文档更新回调（单例视图共用） ----------
function onDocUpdate(u) {
  const t = activeTab();
  if (!t) return;
  if (u.docChanged) {
    t.rev++;
    t.state = ed.view.state;
    renderTabs();
    syncUnsaved();
    persistSession();
  }
  if (u.selectionSet || u.docChanged) {
    updateStatus();
  }
  // 预览只随文档内容变化：仅移动光标/选择时重渲染整篇 Markdown 没有意义。
  if (u.docChanged) renderPreview();
  if (outline) outline.onUpdate(u);
}

// ---------- 标签 ----------
// 标签栏签名：仅当名称/脏状态/活动项变化时才重建 DOM（编辑时高频调用）。
let tabsSignature = "";
function renderTabs(force = false) {
  const sig = tabs.map((t) => `${t.id}:${isDirty(t) ? 1 : 0}:${t.name}`).join("|") + "#" + activeId;
  if (!force && sig === tabsSignature) return;
  tabsSignature = sig;
  const bar = $("#tabs");
  bar.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = (isDirty(t) ? "*" : "") + t.name;
    name.title = t.path || t.name;
    el.appendChild(name);
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    el.appendChild(close);
    el.addEventListener("click", () => activateTab(t.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, t);
    });
    bar.appendChild(el);
  });
  updateWindowTitle();
}

function updateWindowTitle() {
  const t = activeTab();
  const name = t ? `${isDirty(t) ? "*" : ""}${t.name}` : "";
  const title = name ? `${name} - LitePad` : "LitePad";
  document.title = title;
  const A = App();
  if (A && typeof A.SetWindowTitle === "function") A.SetWindowTitle(title);
}

function activateTab(id) {
  const cur = activeTab();
  if (cur && ed && cur.id !== id) cur.state = ed.view.state;
  activeId = id;
  const t = activeTab();
  if (!t) return;
  ed.view.setState(t.state);
  updateStatus();
  renderTabs();
  renderPreview();
  if (outline) outline.switchTo();
  persistSession();
}

function openTab(payload, { activate = true, fromSession = false } = {}) {
  if (payload.path) {
    const key = pathKey(payload.path);
    const existing = tabs.find((t) => pathKey(t.path) === key);
    if (existing) { activateTab(existing.id); return existing; }
  }
  let language = payload.path ? langForPath(payload.path) : "";
  // 大文件自动禁用语法高亮
  if (language && (payload.size || 0) > LARGE_FILE_BYTES) {
    language = "";
    toast(`「${payload.name}」约 ${Math.round(payload.size / 1024 / 1024)}MB，已自动禁用语法高亮以保证流畅`);
  }
  const t = {
    id: ++tabSeq,
    name: payload.name,
    path: payload.path || "",
    encoding: payload.encoding || "UTF-8",
    eol: payload.eol || "LF",
    language,
    rev: 0,
    savedRev: 0,
    state: null,
  };
  tabs.push(t);
  const state = EditorState.create({
    doc: payload.content,
    extensions: buildExtensions(cfg, language, onDocUpdate),
  });
  if (activate) {
    activeId = t.id;
    t.state = state;
    ed.view.setState(state);
    updateStatus();
  } else {
    t.state = state;
  }
  renderTabs();
  renderPreview();
  persistSession();
  if (payload.path && !fromSession) addRecent(payload.path);
  return t;
}

function blankTab() {
  openTab({ name: "未命名", path: "", content: "", encoding: "UTF-8", eol: "LF" });
}

async function closeTab(id, { ensureOne = true } = {}) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const t = tabs[idx];
  if (isDirty(t)) {
    const ok = await showModal(`「${t.name}」有未保存的更改，是否保存？`, [
      { label: "保存", primary: true, collect: async () => await saveTab(t) },
      { label: "不保存", collect: () => true },
      { label: "取消", collect: () => false },
    ]);
    if (!ok) return;
    if (isDirty(t)) return;
  }
  const cur = activeTab();
  if (cur && cur.id === id && ed) cur.state = ed.view.state;
  // 非空标签压入关闭栈，供 Ctrl+Shift+T 恢复（最多保留最近 10 条）
  if (t.path) {
    closedStack.push({ path: t.path, name: t.name });
    if (closedStack.length > 10) closedStack.shift();
  }
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    if (ensureOne) {
      blankTab();
    } else {
      activeId = null;
      renderTabs(true);
    }
  } else if (activeId === id) {
    activateTab(tabs[Math.max(0, idx - 1)].id);
  } else {
    renderTabs();
  }
  syncUnsaved();
  flushSession(); // 关闭标签立即落盘会话，避免退出时丢失
}

async function closeAllTabs() {
  for (const t of [...tabs]) {
    if (!tabs.some((x) => x.id === t.id)) continue;
    const before = tabs.length;
    await closeTab(t.id, { ensureOne: false });
    if (tabs.length === before) return; // 用户取消
  }
  if (tabs.length === 0) blankTab();
}

// 关闭除指定标签外的所有标签
async function closeOtherTabs(id) {
  for (const t of [...tabs]) {
    if (t.id === id) continue;
    const before = tabs.length;
    await closeTab(t.id);
    if (tabs.length === before) return; // 用户取消
  }
}

// 关闭指定标签右侧的所有标签
async function closeRightTabs(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  for (const t of tabs.slice(idx + 1)) {
    const before = tabs.length;
    await closeTab(t.id);
    if (tabs.length === before) return;
  }
}

// ---------- 文件操作 ----------
async function cmdOpen() {
  const A = App();
  if (!A) return;
  try {
    const p = await A.OpenFileDialog();
    if (p && p.path) openTab(p);
  } catch (e) { await showError(e); }
}

async function cmdNew() { blankTab(); }

async function saveTab(t) {
  if (!t) return false;
  if (!t.path) return await saveTabAs(t);
  const state = stateOf(t);
  if (!state) return false;
  try {
    const A = App();
    markSelfWrite(t.path);
    await A.WriteFile(t.path, state.doc.toString(), t.encoding, t.eol);
    t.savedRev = t.rev;
    renderTabs();
    syncUnsaved();
    persistSession();
    return true;
  } catch (e) {
    await showError("保存失败：" + ((e && e.message) || e));
    return false;
  }
}

async function saveTabAs(t) {
  const A = App();
  if (!A) return false;
  const path = await A.SaveFileDialog(t.name);
  if (!path) return false;
  t.path = path;
  t.name = path.split(/[\\/]/).pop();
  setTabLanguage(t, path);
  const ok = await saveTab(t);
  if (ok) addRecent(path);
  renderTabs();
  return ok;
}

async function cmdSave() { const t = activeTab(); if (t) await saveTab(t); }

async function saveAllTabs() {
  for (const t of [...tabs]) {
    if (!isDirty(t)) continue;
    const state = stateOf(t); // 每个标签保存自己的内容，避免互相覆盖
    if (!state) continue;
    const content = state.doc.toString();
    try {
      const A = App();
      if (!t.path) {
        const path = await A.SaveFileDialog(t.name);
        if (!path) continue;
        t.path = path;
        t.name = path.split(/[\\/]/).pop();
        t.language = langForPath(path);
      }
      markSelfWrite(t.path);
      await A.WriteFile(t.path, content, t.encoding, t.eol);
      t.savedRev = t.rev;
    } catch (e) { await showError(e); }
  }
  renderTabs(); syncUnsaved(); persistSession();
}

async function cmdSaveAs() { const t = activeTab(); if (t) await saveTabAs(t); }
async function cmdClose() { const t = activeTab(); if (t) await closeTab(t.id); }

// 重新打开最近关闭的标签（Ctrl+Shift+T）。直接弹出栈顶，若文件仍存在则重新打开。
async function reopenClosed() {
  const entry = closedStack.pop();
  if (!entry) { toast("没有可重新打开的标签"); return; }
  await openByPath(entry.path);
}

// 退出程序：未保存确认沿用 Go 侧 OnBeforeClose 的统一逻辑
async function cmdExit() {
  const A = App();
  if (!A) return;
  try {
    await A.Quit();
  } catch (e) {
    await showError(e);
  }
}

// 路径变化后热切换语法高亮（另存为 / 重命名）
function setTabLanguage(t, path) {
  setTabLanguageById(t, langForPath(path));
}

function setTabLanguageById(t, lang) {
  if (!t || lang === t.language) return;
  t.language = lang;
  const eff = langEffect(lang);
  if (t.id === activeId && ed) ed.view.dispatch({ effects: [eff] });
  else if (t.state) t.state = t.state.update({ effects: [eff] }).state;
  updateStatus();
  toast(`语法高亮：${langLabel(lang)}`, 1500);
}

// 手动选择语法高亮（状态栏语言项）
async function switchLanguage() {
  const t = activeTab();
  if (!t) return;
  const opts = languageOptions().map((o) => [o.id || "__none", o.label]);
  const picked = await pickFromList("选择语法高亮语言", opts, t.language || "__none");
  if (picked == null) return;
  setTabLanguageById(t, picked === "__none" ? "" : picked);
}

// 文件重命名
async function renameFile(t) {
  const A = App();
  if (!A || !t.path) return;
  const newName = await showModal("重命名文件", [
    { label: "确定", primary: true, collect: (b) => b.querySelector("input").value.trim() },
    { label: "取消", collect: () => null },
  ], (b) => {
    const label = document.createElement("label");
    label.textContent = "新文件名 ";
    const input = document.createElement("input");
    input.type = "text";
    input.value = t.name;
    label.appendChild(input);
    b.appendChild(label);
  });
  if (!newName || newName === t.name) return;
  const dir = t.path.replace(/[\\/][^\\/]+$/, "");
  const sep = t.path.includes("\\") ? "\\" : "/";
  const newPath = dir + sep + newName;
  try {
    await A.RenameFile(t.path, newPath);
    t.path = newPath;
    t.name = newName;
    setTabLanguage(t, newPath);
    await A.AddRecent(newPath);
    renderTabs();
    updateStatus();
    persistSession();
  } catch (e) { await showError("重命名失败：" + ((e && e.message) || e)); }
}

// 切换文件系统只读属性
async function toggleReadOnlyAttr(t) {
  const A = App();
  if (!A || !t.path) return;
  const choice = await pickFromList("文件只读属性", [["on", "设为只读"], ["off", "取消只读"]], "off");
  if (!choice) return;
  try {
    await A.SetReadOnlyAttr(t.path, choice === "on");
    toast(choice === "on" ? "已设为只读" : "已取消只读");
  } catch (e) { await showError(e); }
}

function addRecent(path) {
  const A = App();
  if (!A) return;
  A.AddRecent(path).then((c) => {
    // 只合并可信字段：异常响应不应把整个配置覆盖成空对象
    if (c && typeof c === "object" && typeof c.fontSize === "number" && Array.isArray(c.recentFiles)) {
      cfg.recentFiles = c.recentFiles;
      cfg.contextMenu = normalizeContextMenu(c.contextMenu || cfg.contextMenu);
      if (c.integrations) cfg.integrations = c.integrations;
    }
  }).catch(() => {});
}

// ---------- 外部文件变更（fsnotify） ----------
// 自身写盘后的短时抑制：保存动作也会产生 write 事件，若不忽略会导致
// 刚保存的标签被“外部修改”逻辑重新加载，光标跳动且撤销历史丢失。
const selfWrites = new Map();
function markSelfWrite(path) { if (path) selfWrites.set(pathKey(path), Date.now()); }
function consumeSelfWrite(path) {
  const key = pathKey(path);
  const at = selfWrites.get(key);
  if (!at) return false;
  selfWrites.delete(key);
  return Date.now() - at < 2000;
}

async function reloadTab(t) {
  const A = App();
  if (!A) return;
  try {
    const p = await A.OpenPath(t.path);
    const state = EditorState.create({
      doc: p.content,
      extensions: buildExtensions(cfg, t.language, onDocUpdate),
    });
    t.encoding = p.encoding;
    t.eol = p.eol;
    t.state = state;
    if (t.id === activeId) { ed.view.setState(state); updateStatus(); }
    t.rev++;
    t.savedRev = t.rev; // 重新加载后的内容视为与磁盘一致
    syncUnsaved();
    renderTabs();
    renderPreview();
  } catch (e) { await showError(e); }
}

onEvent("file:external-change", async (ev) => {
  if (!ev || !ev.path) return;
  if (consumeSelfWrite(ev.path)) return; // 忽略自身保存引发的事件
  const key = pathKey(ev.path);
  const t = tabs.find((x) => pathKey(x.path) === key);
  if (!t) return;
  if (ev.kind === "write") {
    if (!isDirty(t)) { await reloadTab(t); return; }
    const ok = await showModal(
      `文件「${t.name}」已被外部程序修改。\n当前标签有未保存的更改，重新加载将丢失这些更改。是否重新加载？`,
      [{ label: "重新加载", primary: true, collect: () => true }, { label: "保留我的版本", collect: () => false }]);
    if (ok) await reloadTab(t);
  } else {
    const closeIt = await showModal(
      `文件「${t.name}」已在磁盘上被${ev.kind === "rename" ? "重命名/移动" : "删除"}。\n是否关闭对应标签？（未保存的更改会保留在内存中）`,
      [{ label: "关闭标签", primary: true, collect: () => true }, { label: "保留", collect: () => false }]);
    if (closeIt) await closeTab(t.id);
  }
});

// ---------- 编码 / 换行符 ----------
async function switchEncoding() {
  const t = activeTab();
  if (!t) return;
  const picked = await pickFromList("切换文件编码（保存时生效）", ENCODINGS.map((e) => [e, e]), t.encoding);
  if (picked && picked !== t.encoding) {
    t.encoding = picked;
    t.rev++;
    renderTabs(); syncUnsaved(); updateStatus();
  }
}

async function switchEOL() {
  const t = activeTab();
  if (!t) return;
  const picked = await pickFromList("切换换行符", [["LF", "LF (\\n, Unix)"], ["CRLF", "CRLF (\\r\\n, Windows)"]], t.eol);
  if (picked && picked !== t.eol) {
    t.eol = picked;
    t.rev++;
    renderTabs(); syncUnsaved(); updateStatus();
  }
}

// ---------- 转到行 ----------
async function cmdGotoLine() {
  const view = ed && ed.view;
  if (!view) return;
  const lineNo = await showModal("转到指定行", [
    { label: "确定", primary: true, collect: (b) => parseInt(b.querySelector("input").value, 10) },
    { label: "取消", collect: () => null },
  ], (b) => {
    b.innerHTML = `<label>行号（1 - ${view.state.doc.lines}）<input type="number" min="1" max="${view.state.doc.lines}" value="${view.state.doc.lineAt(view.state.selection.main.head).number}"></label>`;
  });
  if (lineNo && lineNo >= 1 && lineNo <= view.state.doc.lines) {
    const line = view.state.doc.line(lineNo);
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
    updateStatus();
  }
}

// ---------- 剪贴板 ----------
async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

// 读取剪贴板文本；失败时返回 null（由调用方提示使用快捷键）
async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

// 右键菜单的剪切/复制/粘贴（基于 CM6 事务，保留撤销历史）
async function clipboardAction(kind) {
  const view = ed.view;
  const sel = view.state.selection;
  if (kind === "copy" || kind === "cut") {
    const text = sel.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n");
    if (!text) return;
    await copyText(text);
    if (kind === "cut" && !sel.main.empty) view.dispatch(view.state.replaceSelection(""));
  } else if (kind === "paste") {
    const text = await readClipboard();
    if (text == null) {
      await showModal("无法读取剪贴板，请使用 Ctrl+V 粘贴。", [{ label: "确定", primary: true, collect: () => null }]);
      return;
    }
    if (text) view.dispatch(view.state.replaceSelection(text));
  }
  view.focus();
}

function selectAllText() {
  const view = ed.view;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

// ---------- 右键上下文菜单 ----------
// 编辑器区右键菜单：命令集由 main.js 注入，分组开关来自配置
function editorCmdBundle(t) {
  return {
    hasPath: !!t.path,
    undo: () => undo(ed.view),
    redo: () => redo(ed.view),
    cut: () => clipboardAction("cut"),
    copy: () => clipboardAction("copy"),
    paste: () => clipboardAction("paste"),
    selectAll: () => selectAllText(),
    copyLineDown: () => copyLineDown(ed.view),
    deleteLine: () => deleteLine(ed.view),
    moveLineUp: () => moveLineUp(ed.view),
    moveLineDown: () => moveLineDown(ed.view),
    sortAsc: () => sortLines(ed.view, false),
    sortDesc: () => sortLines(ed.view, true),
    dedupe: () => removeDuplicateLines(ed.view),
    removeEmpty: () => removeEmptyLines(ed.view),
    trim: () => trimTrailingSpaces(ed.view),
    upper: () => toggleCase(ed.view, true),
    lower: () => toggleCase(ed.view, false),
    capitalize: () => capitalizeLines(ed.view),
    tabToSpaces: () => tabToSpaces(ed.view, cfg.tabSize),
    spacesToTab: () => spacesToTab(ed.view, cfg.tabSize),
    insertDate: () => insertDateTime(ed.view),
    find: () => find && find.show(),
    replace: () => { if (find) { find.show(); find.focusReplace(); } },
    gotoLine: () => cmdGotoLine(),
    toggleBookmark: () => toggleBookmark(ed.view),
    nextBookmark: () => gotoBookmark(ed.view, true),
    palette: () => showPalette(),
    wrap: () => toggleWrap(),
    whitespace: () => toggleWhitespace(),
    preview: () => togglePreview(),
    zoomIn: () => zoom(1),
    zoomOut: () => zoom(-1),
    zoomReset: () => zoomReset(),
    save: () => cmdSave(),
    saveAs: () => cmdSaveAs(),
    copyPath: () => copyText(t.path),
    reveal: () => App() && App().RevealInExplorer(t.path).catch(showError),
    closeTab: () => closeTab(t.id),
  };
}

// 在编辑区（含 CodeMirror 内部 DOM）右键时弹出菜单
$("#editor-host").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!ed) return;
  // 右键点空白处时把光标移到点击位置，符合常见编辑器行为
  const pos = ed.view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos != null) {
    const sel = ed.view.state.selection.main;
    if (pos < sel.from || pos > sel.to) ed.view.dispatch({ selection: { anchor: pos } });
    ed.view.focus();
  }
  showEditorContextMenu(e.clientX, e.clientY);
});

function showEditorContextMenu(x, y) {
  const t = activeTab();
  if (!t) return;
  showContextMenu(x, y, editorMenuItems(cfg.contextMenu, editorCmdBundle(t)));
}

function showTabContextMenu(x, y, t) {
  showContextMenu(x, y, [
    { label: "关闭标签", run: () => closeTab(t.id) },
    { label: "关闭其他标签", run: () => closeOtherTabs(t.id) },
    { label: "关闭右侧标签", run: () => closeRightTabs(t.id) },
    { sep: true },
    { label: "复制文件路径", disabled: !t.path, run: () => copyText(t.path) },
    { label: "在资源管理器中显示", disabled: !t.path, run: () => App() && App().RevealInExplorer(t.path).catch(showError) },
    { label: "在新窗口打开", disabled: !t.path, run: () => App() && App().OpenInNewWindow(t.path).catch(showError) },
    { label: "重命名文件…", disabled: !t.path, run: () => renameFile(t) },
    { label: "文件只读属性…", disabled: !t.path, run: () => toggleReadOnlyAttr(t) },
  ]);
}

// ---------- 命令注册表 ----------
// 菜单、命令面板与快捷键共用这一份数据：新增命令只改这里，
// 避免此前三处重复导致的标签/快捷键漂移。keys 中的省略字段表示必须为 false。
const COMMANDS = [
  // 文件
  { id: "file.new", label: "新建", shortcut: "Ctrl+N", keys: [{ key: "n", ctrl: true }], run: cmdNew },
  { id: "file.open", label: "打开…", shortcut: "Ctrl+O", keys: [{ key: "o", ctrl: true }], run: cmdOpen },
  { id: "file.save", label: "保存", shortcut: "Ctrl+S", keys: [{ key: "s", ctrl: true }], run: cmdSave },
  { id: "file.saveAs", label: "另存为…", shortcut: "Ctrl+Shift+S", keys: [{ key: "s", ctrl: true, shift: true }], run: cmdSaveAs },
  { id: "file.saveAll", label: "全部保存", shortcut: "Ctrl+Alt+S", keys: [{ key: "s", ctrl: true, alt: true }], run: saveAllTabs },
  { id: "file.close", label: "关闭标签", shortcut: "Ctrl+W", keys: [{ key: "w", ctrl: true }], run: cmdClose },
  { id: "file.closeAll", label: "关闭全部标签", run: closeAllTabs },
  { id: "file.reopenClosed", label: "重新打开已关闭标签", shortcut: "Ctrl+Shift+T", keys: [{ key: "t", ctrl: true, shift: true }], run: reopenClosed },
  { id: "file.exit", label: "退出", palette: false, run: cmdExit },

  // 编辑
  { id: "edit.undo", label: "撤销", shortcut: "Ctrl+Z", run: () => undo(ed.view) },
  { id: "edit.redo", label: "重做", shortcut: "Ctrl+Y", keys: [{ key: "y", ctrl: true }], run: () => redo(ed.view) },
  { id: "edit.upper", label: "转换为大写", shortcut: "Ctrl+Shift+U", keys: [{ key: "u", ctrl: true, shift: true }], run: () => toggleCase(ed.view, true) },
  { id: "edit.lower", label: "转换为小写", shortcut: "Ctrl+U", keys: [{ key: "u", ctrl: true, shift: false }], run: () => toggleCase(ed.view, false) },
  { id: "edit.capitalize", label: "行首字母大写", run: () => capitalizeLines(ed.view) },
  { id: "edit.dupLine", label: "复制并插入当前行", shortcut: "Ctrl+D", keys: [{ key: "d", ctrl: true }], run: () => copyLineDown(ed.view) },
  { id: "edit.deleteLine", label: "删除当前行", shortcut: "Ctrl+L", keys: [{ key: "l", ctrl: true }], run: () => deleteLine(ed.view) },
  { id: "edit.moveUp", label: "当前行上移", shortcut: "Ctrl+Shift+↑", keys: [{ key: "arrowup", ctrl: true, shift: true }], run: () => moveLineUp(ed.view) },
  { id: "edit.moveDown", label: "当前行下移", shortcut: "Ctrl+Shift+↓", keys: [{ key: "arrowdown", ctrl: true, shift: true }], run: () => moveLineDown(ed.view) },
  { id: "edit.collapseCursors", label: "合并多光标", shortcut: "Esc", run: () => collapseCursors(ed.view) },
  { id: "edit.sortAsc", label: "行升序排序", run: () => sortLines(ed.view, false) },
  { id: "edit.sortDesc", label: "行降序排序", run: () => sortLines(ed.view, true) },
  { id: "edit.dedupe", label: "删除重复行", run: () => removeDuplicateLines(ed.view) },
  { id: "edit.removeEmpty", label: "删除空行", run: () => removeEmptyLines(ed.view) },
  { id: "edit.trim", label: "修剪行尾空格", run: () => trimTrailingSpaces(ed.view) },
  { id: "edit.tabsToSpaces", label: "Tab 转空格", run: () => tabToSpaces(ed.view, cfg.tabSize) },
  { id: "edit.spacesToTab", label: "行首空格转 Tab", run: () => spacesToTab(ed.view, cfg.tabSize) },
  { id: "edit.insertTime", label: "插入日期时间", run: () => insertDateTime(ed.view) },

  // 搜索与导航
  { id: "search.find", label: "查找…", shortcut: "Ctrl+F", keys: [{ key: "f", ctrl: true, shift: false }], run: () => find && find.show() },
  { id: "search.replace", label: "替换…", shortcut: "Ctrl+H", keys: [{ key: "h", ctrl: true, shift: false }], run: () => { if (find) { find.show(); find.focusReplace(); } } },
  { id: "search.inFiles", label: "在文件中查找…", shortcut: "Ctrl+Shift+F", keys: [{ key: "f", ctrl: true, shift: true }], run: () => searchFiles && searchFiles.show() },
  { id: "search.goto", label: "转到行…", shortcut: "Ctrl+G", keys: [{ key: "g", ctrl: true, shift: false }], run: cmdGotoLine },
  { id: "search.palette", label: "命令面板…", shortcut: "Ctrl+Shift+P", keys: [{ key: "p", ctrl: true, shift: true }], run: showPalette },
  { id: "search.quickOpen", label: "快速打开…", shortcut: "Ctrl+P", keys: [{ key: "p", ctrl: true, shift: false }], run: showQuickOpen },

  // 视图
  { id: "view.wrap", label: "自动换行", run: toggleWrap },
  { id: "view.dark", label: "暗色主题", run: toggleTheme },
  { id: "view.whitespace", label: "显示空白字符", run: toggleWhitespace },
  { id: "view.preview", label: "Markdown 实时预览", shortcut: "Ctrl+Shift+V", keys: [{ key: "v", ctrl: true, shift: true }], run: togglePreview },
  { id: "view.outline", label: "大纲 / 函数列表", run: toggleOutline },
  { id: "view.zoomIn", label: "放大字体", shortcut: "Ctrl+=", keys: [{ key: "=", ctrl: true }, { key: "+", ctrl: true }], run: () => zoom(1) },
  { id: "view.zoomOut", label: "缩小字体", shortcut: "Ctrl+-", keys: [{ key: "-", ctrl: true }], run: () => zoom(-1) },
  { id: "view.zoomReset", label: "重置字体", shortcut: "Ctrl+0", keys: [{ key: "0", ctrl: true }], run: zoomReset },
  { id: "view.bookmarkToggle", label: "添加/移除书签", shortcut: "Ctrl+F2", keys: [{ key: "f2", ctrl: true }], run: () => toggleBookmark(ed.view) },
  { id: "view.bookmarkPrev", label: "上一个书签", shortcut: "Shift+F2", keys: [{ key: "f2", shift: true }], run: () => gotoBookmark(ed.view, false) },
  { id: "view.bookmarkNext", label: "下一个书签", shortcut: "F2", keys: [{ key: "f2" }], run: () => gotoBookmark(ed.view, true) },
  { id: "view.bookmarkClear", label: "清除全部书签", run: () => clearAllBookmarks(ed.view) },
  { id: "view.language", label: "切换语法高亮…", run: switchLanguage },
  { id: "view.zen", label: "禅模式（隐藏界面装饰）", shortcut: "F10", keys: [{ key: "f10" }], run: toggleZen },
  { id: "view.fullscreen", label: "全屏", shortcut: "F11", keys: [{ key: "f11" }], run: toggleFullscreen },
  { id: "view.encoding", label: "切换编码…", run: switchEncoding },
  { id: "view.eol", label: "切换换行符…", run: switchEOL },

  // 工具
  { id: "tools.jsonFormat", label: "JSON 格式化", shortcut: "Ctrl+Alt+J", keys: [{ key: "j", ctrl: true, alt: true }], run: () => toolJSON(ed.view, false) },
  { id: "tools.jsonMin", label: "JSON 压缩", run: () => toolJSON(ed.view, true) },
  { id: "tools.base64Enc", label: "Base64 编码", run: () => toolBase64(ed.view, false) },
  { id: "tools.base64Dec", label: "Base64 解码", run: () => toolBase64(ed.view, true) },
  { id: "tools.urlEnc", label: "URL 编码", run: () => toolURL(ed.view, false) },
  { id: "tools.urlDec", label: "URL 解码", run: () => toolURL(ed.view, true) },
  { id: "tools.timestamp", label: "时间戳 ↔ 日期互转", run: () => toolTimestamp(ed.view) },
  { id: "tools.regex", label: "正则测试器…", run: () => showRegexTester(ed.view) },

  // 设置
  { id: "settings.editor", label: "字体与主题…", run: () => showSettings("editor") },
  { id: "settings.ctx", label: "右键菜单管理…", run: () => showSettings("ctx") },
  { id: "settings.assoc", label: "文件关联与系统集成…", run: () => showSettings("assoc") },
  { id: "settings.about", label: "关于 LitePad…", palette: false, run: () => showSettings("about") },
  { id: "settings.resetCtx", label: "恢复默认右键菜单", palette: false, run: resetContextMenu },

  // 仅快捷键（不进入菜单/命令面板）
  { id: "nav.cursorUp", label: "添加上方光标", palette: false, keys: [{ key: "arrowup", ctrl: true, alt: true }], run: () => addCursorVertical(ed.view, -1) },
  { id: "nav.cursorDown", label: "添加下方光标", palette: false, keys: [{ key: "arrowdown", ctrl: true, alt: true }], run: () => addCursorVertical(ed.view, 1) },
  { id: "nav.prevTab", label: "上一个标签", palette: false, keys: [{ key: "tab", ctrl: true, shift: true }], run: () => cycleTab(-1) },
  { id: "nav.nextTab", label: "下一个标签", palette: false, keys: [{ key: "tab", ctrl: true, shift: false }], run: () => cycleTab(1) },
];
const CMD = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

function menuItem(id) {
  const c = CMD[id];
  return { label: c.label, shortcut: c.shortcut, run: c.run };
}

function checkedItem(id, checked) {
  const c = CMD[id];
  return { label: (checked ? "✓ " : "   ") + c.label, shortcut: c.shortcut, run: c.run };
}

function commandsList() {
  return COMMANDS.filter((c) => c.palette !== false)
    .map((c) => ({ label: c.label, hint: c.shortcut || "", run: c.run }));
}

// ---------- 菜单 ----------

const MENUS = {
  file: () => {
    const recents = (cfg.recentFiles || []).map((p, i) => ({
      label: `${i + 1}. ${p.split(/[\\/]/).pop()}`,
      title: p,
      run: () => openByPath(p),
    }));
    return [
      menuItem("file.new"),
      menuItem("file.open"),
      { sep: true },
      menuItem("file.save"),
      menuItem("file.saveAs"),
      menuItem("file.saveAll"),
      { sep: true },
      menuItem("file.close"),
      menuItem("file.closeAll"),
      menuItem("file.reopenClosed"),
      ...(recents.length ? [{ sep: true }, ...recents] : []),
      { sep: true },
      menuItem("file.exit"),
    ];
  },
  edit: () => [
    menuItem("edit.undo"),
    menuItem("edit.redo"),
    { sep: true },
    menuItem("edit.upper"),
    menuItem("edit.lower"),
    menuItem("edit.capitalize"),
    { sep: true },
    menuItem("edit.dupLine"),
    menuItem("edit.deleteLine"),
    menuItem("edit.moveUp"),
    menuItem("edit.moveDown"),
    { sep: true },
    menuItem("edit.sortAsc"),
    menuItem("edit.sortDesc"),
    menuItem("edit.dedupe"),
    menuItem("edit.removeEmpty"),
    menuItem("edit.trim"),
    { sep: true },
    menuItem("edit.tabsToSpaces"),
    menuItem("edit.spacesToTab"),
    menuItem("edit.insertTime"),
  ],
  search: () => [
    menuItem("search.find"),
    menuItem("search.replace"),
    { sep: true },
    menuItem("search.inFiles"),
    menuItem("search.goto"),
    { sep: true },
    menuItem("search.palette"),
    menuItem("search.quickOpen"),
  ],
  view: () => [
    checkedItem("view.wrap", !!cfg.wrap),
    checkedItem("view.dark", cfg.theme === "dark"),
    checkedItem("view.whitespace", !!cfg.showWhitespace),
    checkedItem("view.preview", !!(preview && preview.isOn())),
    checkedItem("view.outline", !!(outline && outline.isOn())),
    { sep: true },
    menuItem("view.zoomIn"),
    menuItem("view.zoomOut"),
    menuItem("view.zoomReset"),
    { sep: true },
    menuItem("view.bookmarkToggle"),
    menuItem("view.bookmarkNext"),
    menuItem("view.bookmarkPrev"),
    menuItem("view.bookmarkClear"),
    { sep: true },
    menuItem("view.language"),
    menuItem("view.zen"),
    menuItem("view.fullscreen"),
    { sep: true },
    menuItem("view.encoding"),
    menuItem("view.eol"),
  ],
  tools: () => [
    menuItem("tools.jsonFormat"),
    menuItem("tools.jsonMin"),
    { sep: true },
    menuItem("tools.base64Enc"),
    menuItem("tools.base64Dec"),
    menuItem("tools.urlEnc"),
    menuItem("tools.urlDec"),
    { sep: true },
    menuItem("tools.timestamp"),
    menuItem("tools.regex"),
    { sep: true },
    menuItem("edit.insertTime"),
  ],
  settings: () => [
    menuItem("settings.editor"),
    menuItem("settings.ctx"),
    menuItem("settings.assoc"),
    menuItem("settings.about"),
    { sep: true },
    menuItem("settings.resetCtx"),
  ],
};

// 当前展开菜单所属的顶级菜单项；null 表示菜单未展开
let activeMenuEl = null;

function closeMenu() {
  $("#dropdown").classList.remove("open");
  activeMenuEl = null;
}

function renderMenu(which, anchor) {
  const dd = $("#dropdown");
  activeMenuEl = anchor;
  dd.innerHTML = "";
  MENUS[which]().forEach((item) => {
    if (item.sep) {
      const s = document.createElement("div");
      s.className = "menu-sep";
      dd.appendChild(s);
      return;
    }
    const e = document.createElement("div");
    e.className = "menu-entry";
    const l = document.createElement("span");
    l.textContent = item.label;
    e.appendChild(l);
    if (item.shortcut) {
      const sc = document.createElement("span");
      sc.className = "shortcut";
      sc.textContent = item.shortcut;
      e.appendChild(sc);
    }
    e.title = item.title || "";
    e.addEventListener("click", () => {
      closeMenu();
      item.run();
    });
    dd.appendChild(e);
  });
  dd.style.left = anchor.getBoundingClientRect().left + "px";
  dd.classList.add("open");
}

document.querySelectorAll(".menu-item").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    // 点击已展开的同一菜单则收起，否则展开
    if (activeMenuEl === el) { closeMenu(); return; }
    renderMenu(el.dataset.menu, el);
  });
  // 菜单已展开时，鼠标移到其他顶级菜单立即切换（无需再次点击）
  el.addEventListener("mouseenter", () => {
    if (!activeMenuEl || activeMenuEl === el) return;
    renderMenu(el.dataset.menu, el);
  });
});
document.addEventListener("click", closeMenu);

// ---------- 视图控制 ----------
// 配置热更新：dispatch Compartment 重配置，保留撤销历史；同时同步所有后台标签。
function applyConfigToView() {
  if (!ed) return;
  ed.view.dispatch({ effects: configEffects(cfg) });
  for (const t of tabs) {
    if (t.id === activeId || !t.state) continue;
    t.state = applyConfigToState(t.state, cfg);
  }
  updateStatus();
  // 主题/字体等变化会影响 Mermaid 配色，强制重渲染预览。
  renderPreview(true);
}

// 配置写盘去抖：连续按 Ctrl+= 缩放时不必每个按键都写一次磁盘。
let cfgSaveTimer = null;
function saveConfigSoon() {
  clearTimeout(cfgSaveTimer);
  cfgSaveTimer = setTimeout(() => {
    const A = App();
    if (A) A.SaveConfig(cfg).catch(() => {});
  }, 300);
}

function zoom(delta) {
  const base = Number.isFinite(cfg.fontSize) ? cfg.fontSize : BASE_FONT_SIZE;
  cfg.fontSize = Math.min(40, Math.max(9, base + delta));
  applyConfigToView();
  saveConfigSoon();
}

function zoomReset() {
  cfg.fontSize = BASE_FONT_SIZE;
  applyConfigToView();
  saveConfigSoon();
}

function toggleZen() { document.body.classList.toggle("zen"); }

function toggleFullscreen() {
  const A = App();
  fullscreen = !fullscreen;
  if (A) A.ToggleFullscreen(!fullscreen);
}

function toggleWrap() {
  cfg.wrap = !cfg.wrap;
  applyConfigToView();
  saveConfigSoon();
}
function toggleWhitespace() {
  cfg.showWhitespace = !cfg.showWhitespace;
  applyConfigToView();
  saveConfigSoon();
}
function toggleTheme() {
  cfg.theme = cfg.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = cfg.theme;
  applyConfigToView();
  saveConfigSoon();
}

function togglePreview() {
  if (preview) preview.toggle();
}

function toggleOutline() {
  if (outline) outline.toggle();
}

function updateStatus() { if (status) status.update(); }
function renderPreview(force = false) { if (preview) preview.render(force); }

// 恢复默认右键菜单（全部分组 + 显示快捷键）
async function resetContextMenu() {
  const ok = await showModal("将右键菜单恢复为全部显示，确定吗？",
    [{ label: "恢复", primary: true, collect: () => true }, { label: "取消", collect: () => false }]);
  if (!ok) return;
  cfg.contextMenu = normalizeContextMenu(null);
  const A = App();
  if (A) await A.SaveConfig(cfg);
}

// ---------- 设置 ----------
const settingsCtx = {
  getCfg: () => cfg,
  apply: (next) => {
    cfg = next;
    document.body.dataset.theme = cfg.theme;
    applyConfigToView();
  },
  persist: (next) => {
    const A = App();
    return A ? A.SaveConfig(next) : Promise.resolve();
  },
  app: () => App(),
  applyAssoc: async (formats, menu, setDefault) => {
    const A = App();
    if (!A) return;
    await A.ApplyAssoc(formats, menu, setDefault);
    cfg.integrations = { formats, explorerMenu: menu, setDefault };
    await A.SaveConfig(cfg);
  },
};

async function showSettings(tab = "editor") {
  if (!cfg) return;
  await openSettings(settingsCtx, tab);
}

// ---------- 命令面板 / 快速打开 ----------
function showPalette() {
  if (!palette) return;
  palette.show("命令面板 — 输入以过滤，↑↓ 选择，Enter 执行", commandsList());
}

function showQuickOpen() {
  if (!palette) return;
  const seen = new Set();
  const items = [];
  for (const p of cfg.recentFiles || []) {
    const key = pathKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ label: p.split(/[\\/]/).pop(), hint: p, run: () => openByPath(p) });
    }
  }
  for (const t of tabs) {
    const key = pathKey(t.path);
    if (t.path && !seen.has(key)) {
      seen.add(key);
      items.push({ label: t.name, hint: t.path, run: () => openByPath(t.path) });
    }
  }
  palette.show("快速打开 — 最近文件", items);
}

// ---------- 状态同步 ----------
function syncUnsaved() {
  const unsaved = tabs.some(isDirty);
  if (unsaved === lastUnsaved) return;
  lastUnsaved = unsaved;
  const A = App();
  if (A) A.SetUnsaved(unsaved);
}

// 会话/监视同步去抖 400ms：编辑时每敲一个键都调用，直接 IPC + 写盘代价过高。
let sessionTimer = null;
function persistSession() {
  if (!App()) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(flushSession, 400);
}

function flushSession() {
  const A = App();
  if (!A || !ed) return;
  const paths = tabs.filter((t) => t.path).map((t) => t.path);
  const active = tabs.find((t) => t.id === activeId);
  A.SaveSession(paths, active && active.path ? active.path : "").catch(() => {});
  A.SyncWatchers(paths).catch(() => {});
}

async function openByPath(path) {
  const A = App();
  if (!A) return;
  try {
    const p = await A.OpenPath(path);
    if (p) openTab(p);
  } catch (e) {
    await showModal("无法打开文件：" + path + "\n" + ((e && e.message) || e),
      [{ label: "确定", primary: true, collect: () => null }]);
  }
}

// 从搜索结果跳转到指定文件的指定行。
async function openAtLine(path, line) {
  const A = App();
  if (!A) return;
  try {
    const p = await A.OpenPath(path);
    if (!p) return;
    openTab(p);
    const doc = ed.view.state.doc;
    const target = doc.line(Math.min(Math.max(1, line || 1), doc.lines)).from;
    ed.view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
    ed.view.focus();
    updateStatus();
  } catch (e) {
    await showError("无法打开文件：" + path + "\n" + ((e && e.message) || e));
  }
}

// ---------- 快捷键 ----------
// 按注册表匹配按键，避免快捷键与菜单/命令面板再次分叉。
function matchesKey(e, k) {
  if (e.key.toLowerCase() !== k.key.toLowerCase()) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!!k.ctrl !== ctrl) return false;
  if (k.shift !== undefined && !!k.shift !== e.shiftKey) return false;
  if (k.alt !== undefined && !!k.alt !== e.altKey) return false;
  return true;
}

document.addEventListener("keydown", (e) => {
  if (!ed) return;

  // Esc：优先由查找/命令面板/模态框处理，否则合并多光标
  if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const paletteOpen = !$("#palette").classList.contains("hidden");
    const findOpen = find && find.isOpen();
    const searchOpen = searchFiles && searchFiles.isOpen();
    if (!paletteOpen && !findOpen && !searchOpen && ed.view.state.selection.ranges.length > 1) {
      e.preventDefault(); e.stopPropagation();
      collapseCursors(ed.view);
    }
    return;
  }

  for (const c of COMMANDS) {
    if (c.keys && c.keys.some((k) => matchesKey(e, k))) {
      e.preventDefault();
      e.stopPropagation();
      c.run();
      return;
    }
  }
  // Ctrl+Z / Ctrl+Shift+Z 仍在 CodeMirror 默认历史键位中处理。
}, true);

function cycleTab(dir) {
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

// ---------- 拖放 / 退出确认 ----------
onEvent("files:dropped", (paths) => {
  (paths || []).forEach((p) => openByPath(p));
});

// 单实例：第二个进程把命令行文件转发给已运行的窗口。
onEvent("app:open-paths", async () => {
  if (!ed) return; // 启动早期收到时留给 boot 的 TakeStartupFiles 处理
  const A = App();
  if (!A) return;
  try {
    const paths = await A.TakeStartupFiles();
    for (const p of paths) await openByPath(p);
  } catch { /* 忽略转发失败 */ }
});

onEvent("app:confirm-exit", async () => {
  const ok = await showModal("有未保存的更改，是否保存？", [
    {
      label: "全部保存并退出",
      primary: true,
      // 保存过程中用户可能取消“另存为”对话框，此时仍有脏标签，应中止退出。
      collect: async () => {
        await saveAllTabs();
        return !tabs.some(isDirty);
      },
    },
    { label: "不保存退出", collect: () => true },
    { label: "取消", collect: () => false },
  ]);
  if (!ok) return;
  const A = App();
  if (!A) return;
  // 先清除未保存标记，否则退出流程会再次触发 OnBeforeClose，形成确认循环。
  lastUnsaved = false;
  A.SetUnsaved(false);
  A.Quit();
});

// 关闭窗口前尽力保存一次会话（异步 IPC 可能来不及完成，故平时已有去抖落盘）。
window.addEventListener("beforeunload", () => { flushSession(); });

// ---------- 启动 ----------
function showBootError(msg) {
  const host = $("#editor-host");
  if (!host) return;
  host.innerHTML = "";
  const div = document.createElement("div");
  div.className = "boot-error";
  div.textContent = msg;
  host.appendChild(div);
}

async function boot() {
  const A = App();
  if (!A) {
    showBootError("无法连接应用后端（window.go 未注入）。请通过 LitePad.exe 启动，而不是直接打开 HTML。");
    return;
  }
  try {
    cfg = await A.GetConfig();
  } catch (e) {
    showBootError("读取配置失败：" + ((e && e.message) || e));
    return;
  }
  cfg.contextMenu = normalizeContextMenu(cfg.contextMenu);
  document.body.dataset.theme = cfg.theme;

  const host = $("#editor-host");
  ed = {
    view: new EditorView({
      state: EditorState.create({ doc: "", extensions: buildExtensions(cfg, "", onDocUpdate) }),
      parent: host,
    }),
  };
  status = createStatus({
    viewRef: () => ed && ed.view,
    tabRef: () => activeTab(),
    cfgRef: () => cfg,
    onEncoding: switchEncoding,
    onEOL: switchEOL,
    onLanguage: switchLanguage,
    onZoomReset: zoomReset,
  });
  status.init();
  preview = createPreview({
    viewRef: () => ed.view,
    tabRef: () => activeTab(),
  });
  outline = createOutline({
    viewRef: () => ed.view,
    tabRef: () => activeTab(),
    langFor: (path) => langForPath(path),
  });

  blankTab(); // 保底空标签

  // 命令行/文件关联启动带来的文件优先打开
  let startupOpened = false;
  try {
    const files = await A.TakeStartupFiles();
    if (files && files.length) {
      for (const p of files) {
        try {
          const payload = await A.OpenPath(p);
          if (payload) { openTab(payload); startupOpened = true; }
        } catch { /* 忽略无法打开的文件 */ }
      }
    }
  } catch { /* 旧版本绑定无此方法时忽略 */ }

  // 会话恢复
  try {
    const sess = await A.LoadSession();
    if (sess.paths && sess.paths.length > 0) {
      for (const p of sess.paths) {
        try {
          const payload = await A.OpenPath(p);
          if (payload) openTab(payload, { activate: false, fromSession: true });
        } catch { /* 跳过已失效的路径 */ }
      }
      if (tabs.length > 1) {
        tabs.splice(0, 1); // 移除保底空标签
        if (!startupOpened) {
          // 优先按路径恢复活动标签；旧会话只有下标时退回下标逻辑。
          const byPath = sess.activePath
            ? tabs.findIndex((t) => t.path && pathKey(t.path) === pathKey(sess.activePath))
            : -1;
          const idx = byPath >= 0
            ? byPath
            : Math.min(Math.max(0, sess.active || 0), tabs.length - 1);
          activateTab(tabs[Math.max(0, idx)].id);
        }
      }
    }
  } catch { /* 无会话文件 */ }

  // 查找面板与命令面板
  find = createFindPanel({ viewRef: () => ed && ed.view, container: $("#find-panel") });
  palette = createPalette({ container: $("#palette") });
  searchFiles = createSearchFiles({
    app: App,
    getRoot: () => {
      const t = activeTab();
      if (!t || !t.path) return "";
      const i = Math.max(t.path.lastIndexOf("\\"), t.path.lastIndexOf("/"));
      return i > 0 ? t.path.slice(0, i) : "";
    },
    onOpen: openAtLine,
  });

  updateStatus();
  renderPreview();
  renderTabs(true);
  flushSession();
}

boot().catch((e) => {
  console.error(e);
  showBootError("启动失败：" + ((e && e.message) || e));
});
