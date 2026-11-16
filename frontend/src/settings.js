// settings.js：设置对话框（编辑器 / 右键菜单 / 文件关联）。
// 通过 ctx 注入宿主能力，避免与 main.js 形成循环依赖。
import { showModal, showError } from "./dialogs.js";
import { editorMenuItems, normalizeContextMenu, CTX_GROUPS } from "./ctxmenu.js";

const CTX_LABELS = {
  clipboard: "剪贴板（撤销/剪切/复制/粘贴/全选）",
  lines: "行操作（复制行/删除行/上下移/排序/去重）",
  transform: "文本转换（大小写/Tab 转换/插入时间）",
  navigate: "查找与书签（查找/替换/转到行/书签）",
  view: "显示（换行/空白字符/预览/缩放）",
  file: "文件（保存/另存为/路径/关闭标签）",
};

// 常用关联格式（设置页「常用格式」按钮）
const COMMON_FORMATS = [
  ".txt", ".md", ".log", ".json", ".ini", ".yml", ".yaml", ".csv", ".xml",
  ".go", ".py", ".js", ".ts", ".html", ".css",
];

// openSettings 返回后由 main.js 负责持久化后的界面同步工作。
// ctx: { getCfg, apply(next), persist(next), app(), applyAssoc(formats, menu, setDefault) }
export async function openSettings(ctx, initialTab = "editor") {
  const cur = ctx.getCfg();
  const prefs = normalizeContextMenu(cur.contextMenu);
  let assocStatus = { supported: true, formats: [], defaultFormats: [], explorerMenu: false };
  let assocDirty = false;

  const result = await showModal("设置", [
    {
      label: "确定", primary: true,
      collect: (b) => ({
        fontFamily: b.querySelector("#set-font").value.trim() || cur.fontFamily,
        fontSize: parseInt(b.querySelector("#set-size").value, 10) || cur.fontSize,
        tabSize: parseInt(b.querySelector("#set-tab").value, 10) || cur.tabSize,
        theme: b.querySelector("#set-theme").value,
        wrap: b.querySelector("#set-wrap").checked,
        showWhitespace: b.querySelector("#set-ws").checked,
        contextMenu: {
          showShortcut: b.querySelector('[data-ctx="showShortcut"]').checked,
          ...Object.fromEntries(CTX_GROUPS.map((g) => [g.key, b.querySelector(`[data-ctx="${g.key}"]`).checked])),
        },
        assoc: {
          dirty: assocDirty,
          formats: [...b.querySelectorAll("[data-fmt]:checked")].map((e) => e.dataset.fmt),
          menu: b.querySelector("#assoc-menu").checked,
          setDefault: b.querySelector("#assoc-default").checked,
        },
      }),
    },
    { label: "取消", collect: () => null },
  ], (b) => {
    b.innerHTML = `
      <div id="set-tabs">
        <button data-tab="editor" class="active">编辑器</button>
        <button data-tab="ctx">右键菜单</button>
        <button data-tab="assoc">文件关联</button>
        <button data-tab="about">关于</button>
      </div>
      <div class="set-pane" data-pane="editor">
        <label>字体 <input type="text" id="set-font"></label>
        <label>字号(px) <input type="number" id="set-size" min="9" max="40"></label>
        <label>缩进宽度 <input type="number" id="set-tab" min="1" max="8"></label>
        <label>主题 <select id="set-theme"><option value="light">亮色</option><option value="dark">暗色</option></select></label>
        <label>自动换行 <input type="checkbox" id="set-wrap"></label>
        <label>显示空白字符 <input type="checkbox" id="set-ws"></label>
      </div>
      <div class="set-pane hidden" data-pane="ctx">
        <p class="hint">勾选需要在编辑器右键菜单中显示的分组：</p>
        <div class="ctx-opts">
          ${CTX_GROUPS.map((g) => `<label class="chk"><input type="checkbox" data-ctx="${g.key}"> ${CTX_LABELS[g.key]}</label>`).join("")}
          <label class="chk"><input type="checkbox" data-ctx="showShortcut"> 显示快捷键提示</label>
        </div>
        <div class="set-actions">
          <button id="ctx-all">全选</button>
          <button id="ctx-none">全不选</button>
          <button id="ctx-preview">预览菜单项</button>
        </div>
        <p class="hint" id="ctx-preview-out"></p>
      </div>
      <div class="set-pane hidden" data-pane="assoc">
        <p class="hint" id="assoc-status">正在读取系统状态…</p>
        <div class="assoc-grid" id="assoc-grid"><span class="hint">加载中…</span></div>
        <div class="set-actions">
          <button id="assoc-all">全选</button>
          <button id="assoc-none">清空</button>
          <button id="assoc-common">常用格式</button>
          <button id="assoc-clear">移除全部关联</button>
        </div>
        <label class="chk"><input type="checkbox" id="assoc-menu"> 添加到资源管理器右键菜单（“用 LitePad 打开”）</label>
        <label class="chk"><input type="checkbox" id="assoc-default"> 同时设为这些格式的默认打开方式</label>
        <p class="hint">关联写入当前用户注册表（HKCU），无需管理员权限。Windows 10/11 若已为某格式指定默认应用，需在「设置 → 默认应用」中确认切换。</p>
      </div>
      <div class="set-pane hidden" data-pane="about">
        <div class="about-brand">
          <span class="about-name" id="about-name">LitePad</span>
          <span class="about-ver" id="about-ver">正在读取版本…</span>
        </div>
        <p class="about-intro">LitePad 是一款面向 Windows 的轻量级文本编辑器，定位是打开即用的日常文本与代码查看、编辑工具：启动快、占用低，内置多标签、语法高亮、查找替换、Markdown 实时预览与常用文本转换工具，既可替代系统记事本，也适合随手查看和修改源码、日志与配置文件。</p>
        <div class="about-meta">
          <div class="about-row"><span class="about-key">开发者</span><a class="about-link" data-url="https://www.lovou.pw">XFM</a></div>
          <div class="about-row"><span class="about-key">版权</span><span id="about-copy">Copyright © 2026</span></div>
        </div>
        <p class="hint">点击开发者名称，将使用系统默认浏览器打开其主页。</p>
      </div>`;

    // 用 DOM 赋值而不是把配置拼进 HTML：字体名等字段来自用户输入，拼字符串会破坏属性结构。
    b.querySelector("#set-font").value = cur.fontFamily;
    b.querySelector("#set-size").value = cur.fontSize;
    b.querySelector("#set-tab").value = cur.tabSize;
    b.querySelector("#set-theme").value = cur.theme;
    b.querySelector("#set-wrap").checked = !!cur.wrap;
    b.querySelector("#set-ws").checked = !!cur.showWhitespace;
    CTX_GROUPS.forEach((g) => {
      b.querySelector(`[data-ctx="${g.key}"]`).checked = !!prefs[g.key];
    });
    b.querySelector('[data-ctx="showShortcut"]').checked = !!prefs.showShortcut;

    // 标签页切换
    const tabBtns = [...b.querySelectorAll("#set-tabs button")];
    const showPane = (name) => {
      tabBtns.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
      b.querySelectorAll(".set-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
    };
    tabBtns.forEach((t) => t.addEventListener("click", () => showPane(t.dataset.tab)));
    showPane(initialTab);

    // 右键菜单分组操作
    const ctxBoxes = () => [...b.querySelectorAll("[data-ctx]")];
    b.querySelector("#ctx-all").addEventListener("click", () => ctxBoxes().forEach((e) => { e.checked = true; }));
    b.querySelector("#ctx-none").addEventListener("click", () => ctxBoxes().forEach((e) => { e.checked = false; }));
    b.querySelector("#ctx-preview").addEventListener("click", () => {
      const preview = {
        showShortcut: b.querySelector('[data-ctx="showShortcut"]').checked,
        ...Object.fromEntries(CTX_GROUPS.map((g) => [g.key, b.querySelector(`[data-ctx="${g.key}"]`).checked])),
      };
      const items = editorMenuItems(preview, { hasPath: true });
      b.querySelector("#ctx-preview-out").textContent =
        "当前菜单顺序：" + items.filter((i) => !i.sep).map((i) => i.label).join(" · ");
    });

    // 文件关联：读取注册表真实状态后填充
    (async () => {
      const A = ctx.app();
      if (!A) return;
      let formats = [];
      try {
        formats = await A.AssocFormats();
      } catch { formats = []; }
      try {
        assocStatus = await A.GetAssocStatus();
      } catch (e) {
        b.querySelector("#assoc-status").textContent = "无法读取注册表状态：" + ((e && e.message) || e);
      }
      const linked = new Set((assocStatus.formats || []).map((s) => s.toLowerCase()));
      b.querySelector("#assoc-grid").innerHTML = formats
        .map((f) => `<label class="chk fmt"><input type="checkbox" data-fmt="${f}" ${linked.has(f) ? "checked" : ""}> ${f}</label>`)
        .join("");
      b.querySelector("#assoc-menu").checked = !!assocStatus.explorerMenu;
      // 回显「设为默认」：优先用注册表实际状态，其次用上次保存的偏好
      const anyDefault = (assocStatus.defaultFormats || []).length > 0;
      b.querySelector("#assoc-default").checked = anyDefault || !!cur.integrations?.setDefault;
      const sup = assocStatus.supported !== false;
      b.querySelector("#assoc-status").textContent = sup
        ? `已关联 ${linked.size} 种格式${anyDefault ? `（其中 ${assocStatus.defaultFormats.length} 种为默认打开方式）` : ""}`
        : "当前平台不支持文件关联（仅 Windows 可用）";
      if (!sup) b.querySelectorAll("[data-fmt], #assoc-menu, #assoc-default").forEach((e) => { e.disabled = true; });

      const mark = () => { assocDirty = true; };
      const fmtBoxes = () => [...b.querySelectorAll("[data-fmt]")];
      fmtBoxes().forEach((e) => e.addEventListener("change", mark));
      b.querySelector("#assoc-menu").addEventListener("change", mark);
      b.querySelector("#assoc-default").addEventListener("change", mark);
      b.querySelector("#assoc-all").addEventListener("click", () => { fmtBoxes().forEach((e) => { e.checked = true; }); mark(); });
      b.querySelector("#assoc-none").addEventListener("click", () => { fmtBoxes().forEach((e) => { e.checked = false; }); mark(); });
      b.querySelector("#assoc-common").addEventListener("click", () => {
        fmtBoxes().forEach((e) => { e.checked = COMMON_FORMATS.includes(e.dataset.fmt); });
        mark();
      });
      b.querySelector("#assoc-clear").addEventListener("click", async () => {
        try {
          await A.ClearAssoc();
          fmtBoxes().forEach((e) => { e.checked = false; });
          b.querySelector("#assoc-menu").checked = false;
          b.querySelector("#assoc-default").checked = false;
          assocDirty = false;
          b.querySelector("#assoc-status").textContent = "已移除全部关联与右键菜单";
        } catch (e) {
          await showError("移除失败：" + ((e && e.message) || e));
        }
      });
    })();

    // 关于页：链接一律交给系统默认浏览器打开，版本号由主进程读取 wails.json。
    b.querySelectorAll(".about-link").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const A = ctx.app();
        const url = el.dataset.url;
        if (A && url) A.OpenExternal(url).catch(() => {});
      });
    });
    (async () => {
      const ver = b.querySelector("#about-ver");
      const A = ctx.app();
      if (!A) { ver.textContent = "版本 未知"; return; }
      try {
        const info = await A.GetAppInfo();
        if (!info) return;
        if (info.name) b.querySelector("#about-name").textContent = info.name;
        ver.textContent = "版本 " + (info.version || "未知");
        if (info.copyright) b.querySelector("#about-copy").textContent = info.copyright;
      } catch {
        ver.textContent = "版本 未知";
      }
    })();
  }, { wide: true });

  if (!result) return;

  const next = {
    ...cur,
    fontFamily: result.fontFamily,
    fontSize: result.fontSize,
    tabSize: result.tabSize,
    theme: result.theme,
    wrap: result.wrap,
    showWhitespace: result.showWhitespace,
    contextMenu: normalizeContextMenu(result.contextMenu),
  };
  ctx.apply(next);
  try {
    await ctx.persist(next);
    if (result.assoc && result.assoc.dirty) {
      await ctx.applyAssoc(result.assoc.formats, result.assoc.menu, result.assoc.setDefault);
    }
  } catch (e) {
    await showError("保存设置失败：" + ((e && e.message) || e));
  }
}
