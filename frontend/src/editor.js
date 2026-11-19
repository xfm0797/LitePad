// editor.js：扩展构建、EditorView 创建与配置热更新。
// 配置项（主题/字体/换行/缩进/空白字符/语言）全部放在 Compartment 中，
// 变更时只 dispatch 重配置 effect，避免重建 state —— 撤销历史与光标得以保留，
// 同时可同步到所有后台标签。
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightWhitespace } from "@codemirror/view";
import { rectangularSelection, crosshairCursor } from "@codemirror/rectangular-selection";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search } from "@codemirror/search";
import { indentUnit, bracketMatching } from "@codemirror/language";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { closeBrackets } from "@codemirror/autocomplete";
import { bookmarkGutter } from "./bookmarks.js";

import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";

// 语言解析器映射（标识与 core.DetectLanguage 保持一致）。
const LANGUAGES = {
  go: () => go(),
  python: () => python(),
  javascript: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  markdown: () => markdown(),
  html: () => html(),
  xml: () => xml(),
  css: () => css(),
  cpp: () => cpp(),
  yaml: () => yaml(),
  sql: () => sql(),
};

const LANG_LABELS = {
  go: "Go", python: "Python", javascript: "JavaScript", json: "JSON",
  markdown: "Markdown", html: "HTML", xml: "XML", css: "CSS", cpp: "C/C++",
  yaml: "YAML", sql: "SQL", "": "纯文本",
};

// 按扩展名推断语言标识（与 Go 侧 core.DetectLanguage 保持一致的兜底）。
export function langForPath(path) {
  if (!path) return "";
  const ext = path.split(".").pop().toLowerCase();
  const map = {
    go: "go",
    py: "python", pyw: "python", pyi: "python",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "javascript", tsx: "javascript", mts: "javascript", cts: "javascript",
    json: "json", jsonc: "json", json5: "json",
    md: "markdown", markdown: "markdown", mkd: "markdown",
    html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
    xml: "xml", svg: "xml", xsl: "xml", xslt: "xml", plist: "xml",
    csproj: "xml", vbproj: "xml", resx: "xml", config: "xml",
    c: "cpp", h: "cpp", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
    css: "css", scss: "css", less: "css",
    yaml: "yaml", yml: "yaml",
    sql: "sql",
  };
  return map[ext] || "";
}

export function langLabel(id) { return LANG_LABELS[id] || "纯文本"; }

// 供「切换语言」下拉使用的选项列表（空串表示纯文本）。
export function languageOptions() {
  return [{ id: "", label: "纯文本" }].concat(
    Object.keys(LANGUAGES).map((id) => ({ id, label: LANG_LABELS[id] || id })),
  );
}

function langSupport(id) {
  const loader = LANGUAGES[id];
  return loader ? loader() : [];
}

// 所有可变配置项共享同一组 Compartment 实例（可跨多个 EditorState 复用）。
const themeComp = new Compartment();
const wrapComp = new Compartment();
const tabSizeComp = new Compartment();
const indentComp = new Compartment();
const wsComp = new Compartment();
const langComp = new Compartment();

function themeExt(cfg) {
  const base = EditorView.theme({
    "&": { color: cfg.theme === "dark" ? "#d4d4d4" : "#1e1e1e", backgroundColor: cfg.theme === "dark" ? "#1e1e1e" : "#ffffff" },
    ".cm-content": { fontFamily: cfg.fontFamily, fontSize: cfg.fontSize + "px" },
    ".cm-gutters": {
      backgroundColor: cfg.theme === "dark" ? "#252526" : "#f3f3f3",
      color: cfg.theme === "dark" ? "#858585" : "#999999",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: cfg.theme === "dark" ? "#2d2d2d" : "#e8e8e8" },
    ".cm-activeLine": { backgroundColor: cfg.theme === "dark" ? "rgba(76,139,245,0.08)" : "rgba(37,99,235,0.05)" },
    ".cm-cursor": { borderLeftColor: cfg.theme === "dark" ? "#4c8bf5" : "#2563eb" },
  }, { dark: cfg.theme === "dark" });
  // 暗色主题下叠加 oneDark 的语法高亮配色
  return cfg.theme === "dark" ? [oneDark, base] : base;
}

// 构建扩展集合（basicSetup 已含行号/历史/括号匹配/选区匹配/快捷键，此处不再重复）。
export function buildExtensions(cfg, language, onUpdate) {
  return [
    basicSetup,
    search(), // SearchQuery 状态：查找面板高亮与 setSearchQuery 依赖它
    bookmarkGutter(), // 行书签 gutter + StateField
    rectangularSelection({ eventFilter: (e) => e.altKey && !e.shiftKey }), // Alt+拖拽 矩形选区
    crosshairCursor({ key: "Alt" }),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey), // Alt+点击 添加多光标
    keymap.of([indentWithTab]),
    wsComp.of(cfg.showWhitespace ? highlightWhitespace() : []),
    langComp.of(langSupport(language)),
    themeComp.of(themeExt(cfg)),
    wrapComp.of(cfg.wrap ? EditorView.lineWrapping : []),
    tabSizeComp.of(EditorState.tabSize.of(cfg.tabSize)),
    indentComp.of(indentUnit.of(" ".repeat(cfg.tabSize))),
    EditorView.updateListener.of(onUpdate),
  ];
}

// 语言切换 effect（打开/另存为/重命名后按新扩展名重设高亮）。
export function langEffect(language) {
  return langComp.reconfigure(langSupport(language));
}

// 配置变更 effect 集合：除语言外的公共配置项。
export function configEffects(cfg) {
  return [
    themeComp.reconfigure(themeExt(cfg)),
    wrapComp.reconfigure(cfg.wrap ? EditorView.lineWrapping : []),
    tabSizeComp.reconfigure(EditorState.tabSize.of(cfg.tabSize)),
    indentComp.reconfigure(indentUnit.of(" ".repeat(cfg.tabSize))),
    wsComp.reconfigure(cfg.showWhitespace ? highlightWhitespace() : []),
  ];
}

// 对任意 state 应用配置（后台标签用），返回新的 state，保留其历史与光标。
export function applyConfigToState(state, cfg) {
  return state.update({ effects: configEffects(cfg) }).state;
}

// 兼容入口：对视图应用配置（保留撤销历史，不再重建 state）。
export function applyConfigToView(view, cfg) {
  view.dispatch({ effects: configEffects(cfg) });
}

export { EditorState };
