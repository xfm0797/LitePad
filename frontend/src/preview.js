// preview.js：Markdown 实时预览窗格。
// 渲染做 250ms 去抖，并在重排后按比例恢复滚动位置，避免每次输入都跳回顶部。
// Mermaid 图表先在游离容器里异步渲染完成，再整体替换 DOM，
// 因此异步渲染不会造成预览闪烁或滚动跳动。
import { renderMarkdown } from "./md-render.js";

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
// Mermaid 体积较大，按需加载本地打包资源（frontend/public/vendor/mermaid.min.js），不联网。
const MERMAID_SCRIPT = "vendor/mermaid.min.js";

let mermaidLib = null;
let mermaidLoading = null;
let diagramSeq = 0;
// 串行执行渲染任务：Mermaid 的 render 依赖全局配置，不能并发调用。
let renderChain = Promise.resolve();
// 上次渲染的文档快照（Text 不可变，可用引用判断内容是否变化）。
let lastDoc = null;

function loadMermaid() {
  if (mermaidLib) return Promise.resolve(mermaidLib);
  if (mermaidLoading) return mermaidLoading;
  mermaidLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MERMAID_SCRIPT;
    s.async = true;
    s.onload = () => {
      if (window.mermaid) {
        mermaidLib = window.mermaid;
        resolve(mermaidLib);
      } else {
        reject(new Error("Mermaid 脚本已加载但未初始化"));
      }
    };
    s.onerror = () => reject(new Error("无法加载本地 Mermaid 资源"));
    document.head.appendChild(s);
  }).catch((e) => {
    mermaidLoading = null; // 允许下次重试
    throw e;
  });
  return mermaidLoading;
}

// 从主题变量生成 Mermaid 配色，亮/暗主题切换后重新渲染即可跟随。
function mermaidTheme() {
  const cs = getComputedStyle(document.body);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const dark = document.body.dataset.theme === "dark";
  return {
    darkMode: dark,
    background: v("--bg", "#ffffff"),
    primaryColor: v("--panel", "#f3f3f3"),
    primaryTextColor: v("--fg", "#1e1e1e"),
    primaryBorderColor: v("--border", "#d0d0d0"),
    secondaryColor: v("--panel", "#f3f3f3"),
    tertiaryColor: v("--bg", "#ffffff"),
    lineColor: v("--accent", "#2563eb"),
    textColor: v("--fg", "#1e1e1e"),
    mainBkg: v("--panel", "#f3f3f3"),
    nodeBorder: v("--border", "#d0d0d0"),
    clusterBkg: v("--bg", "#ffffff"),
    clusterBorder: v("--border", "#d0d0d0"),
    titleColor: v("--fg", "#1e1e1e"),
    edgeLabelBackground: v("--bg", "#ffffff"),
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    fontSize: "13px",
  };
}

// 错误信息取首行并截断，避免把整段解析栈塞进预览。
function shortError(e) {
  const raw = (e && (e.message || e.str)) || String(e || "");
  const line = String(raw).split("\n").find((s) => s.trim()) || "语法错误";
  return line.length > 240 ? line.slice(0, 240) + "…" : line;
}

function markError(block, err) {
  block.dataset.mermaidState = "error";
  const msg = block.querySelector(".md-mermaid-msg");
  if (msg) {
    msg.hidden = false;
    msg.textContent = "Mermaid 渲染失败：" + shortError(err);
  }
}

// 渲染失败时 Mermaid 可能在 body 留下临时节点，清掉以免污染页面。
function cleanupStray(id) {
  for (const nodeId of [id, "d" + id]) {
    const el = document.getElementById(nodeId);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
}

async function renderMermaidBlocks(root) {
  const blocks = Array.from(root.querySelectorAll('.md-mermaid[data-mermaid-state="pending"]'));
  if (!blocks.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (e) {
    blocks.forEach((b) => markError(b, e));
    return;
  }
  const themeVars = mermaidTheme();
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict", // 禁止点击回调与原始 HTML 标签
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: themeVars,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      pie: { useMaxWidth: true },
      class: { useMaxWidth: true },
      state: { useMaxWidth: true },
      er: { useMaxWidth: true },
    });
  } catch {
    // 配置异常不阻断，继续尝试按默认配置渲染
  }
  for (const block of blocks) {
    const code = block.querySelector("code");
    const src = code ? code.textContent : "";
    const id = `litepad-mermaid-${++diagramSeq}`;
    try {
      const { svg } = await mermaid.render(id, src);
      block.innerHTML = svg + mermaidToolbar();
      block.dataset.mermaidState = "done";
      wireMermaidToolbar(block);
    } catch (e) {
      cleanupStray(id);
      markError(block, e);
    }
  }
}

function mermaidToolbar() {
  return `<div class="md-mermaid-toolbar">
    <button title="缩小" data-zoom="-">-</button>
    <button title="放大" data-zoom="+">+</button>
    <button title="还原" data-zoom="1">1:1</button>
    <button title="下载 SVG" data-download="svg">↓</button>
  </div>`;
}

function wireMermaidToolbar(block) {
  let scale = 1;
  const svg = block.querySelector("svg");
  const bar = block.querySelector(".md-mermaid-toolbar");
  if (!svg || !bar) return;

  function apply() {
    svg.style.transformOrigin = "center center";
    svg.style.transform = `scale(${scale})`;
    svg.style.transition = "transform .12s ease";
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.zoom === "+") scale = Math.min(4, +(scale + 0.2).toFixed(2));
    else if (btn.dataset.zoom === "-") scale = Math.max(0.3, +(scale - 0.2).toFixed(2));
    else if (btn.dataset.zoom === "1") scale = 1;
    else if (btn.dataset.download === "svg") {
      const serializer = new XMLSerializer();
      const blob = new Blob([serializer.serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `diagram-${Date.now()}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    apply();
  });

  // Ctrl/⌘ + 鼠标滚轮缩放，方向与浏览器默认一致
  block.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    scale = Math.max(0.3, Math.min(4, +(scale + delta).toFixed(2)));
    apply();
  }, { passive: false });
}

export function createPreview({ viewRef, tabRef }) {
  const pane = document.querySelector("#preview-pane");
  let on = false;
  let timer = null;
  let gen = 0;
  let pendingForce = false;

  // 预览内链接：锚点在窗格内滚动，http/https 交给系统浏览器，其余一律拦截。
  // 否则 WebView2 可能把整个应用导航到目标页面，或打开空白窗口。
  pane.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || !pane.contains(a)) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#")) {
      const target = href.length > 1 ? document.getElementById(href.slice(1)) : null;
      if (target && pane.contains(target)) target.scrollIntoView({ block: "start" });
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      const A = window.go && window.go.main && window.go.main.App;
      if (A && typeof A.OpenExternal === "function") A.OpenExternal(href).catch(() => {});
    }
  });

  function toggle() {
    on = !on;
    pane.classList.toggle("hidden", !on);
    render();
  }

  function render(force = false) {
    // 强制刷新标记要跨过去抖窗口累积，避免紧跟着的普通渲染把主题刷新吞掉。
    pendingForce = pendingForce || force;
    clearTimeout(timer);
    if (!on) return;
    const myGen = ++gen;
    timer = setTimeout(() => {
      const forced = pendingForce;
      pendingForce = false;
      renderChain = renderChain
        .then(() => performRender(myGen, forced))
        .catch(() => {});
    }, 250);
  }

  async function performRender(myGen, force) {
    // 期间又触发了新一轮渲染或已关闭预览，直接丢弃本次结果
    if (!on || myGen !== gen) return;
    const tab = tabRef();
    if (!tab) return;
    const doc = viewRef().state.doc;
    // 文档未变化且不是强制刷新（如主题切换）：无需重复解析与重建 DOM。
    if (!force && doc === lastDoc) return;
    if (doc.length > MAX_PREVIEW_BYTES) {
      lastDoc = doc;
      pane.textContent = "文档超过 2MB，已暂停实时预览以保证编辑流畅。";
      return;
    }

    const staging = document.createElement("div");
    staging.innerHTML = renderMarkdown(doc.toString());
    if (staging.querySelector(".md-mermaid")) {
      await renderMermaidBlocks(staging);
    }
    if (!on || myGen !== gen) return;

    // 滚动位置按比例恢复（与改动前一致）
    const prevMax = pane.scrollHeight - pane.clientHeight;
    const ratio = prevMax > 0 ? pane.scrollTop / prevMax : 0;
    pane.replaceChildren(...Array.from(staging.childNodes));
    lastDoc = doc;
    if (ratio > 0) {
      const max = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.min(max, Math.round(ratio * max));
    }
  }

  function hide() {
    if (!on) return;
    on = false;
    gen++;
    pane.classList.add("hidden");
  }

  return { toggle, render, hide, isOn: () => on };
}
