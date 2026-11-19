// md-render.js：轻量 Markdown → HTML 渲染器（零依赖，GFM 常用语法，输出已转义防注入）。
// 支持：标题（ATX + setext）、表格（含对齐）、任务列表、删除线、自动链接、
// 围栏与缩进代码块、多反引号行内代码、引用式链接、引用、嵌套列表、GFM 软/硬换行；
// mermaid 围栏输出占位容器交给 preview.js 渲染。原始 HTML 一律转义，不执行。

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 链接协议白名单：阻止 javascript: / data: / vbscript: 等可执行协议
function safeUrl(url) {
  const u = url.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "#"; // 其他绝对协议一律拦截
  return u; // 相对路径
}

// 标题文本 → GFM 风格锚点 id（保留中英文、数字、下划线、连字符，重复时追加序号）
function makeSlug(text, state) {
  const base = text
    .toLowerCase()
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-") || "section";
  const n = state.slugs.get(base) || 0;
  state.slugs.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

// 多反引号行内代码：``code with ` inside``
function inlineCodeStash(md) {
  const stash = [];
  let s = md;
  // 先处理多反引号行内代码（`` ``），内部允许出现单反引号
  s = s.replace(/(`{2,})([\s\S]+?)\1/g, (m, fence, code) => {
    stash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0001${stash.length - 1}\u0001`;
  });
  // 单反引号行内代码（此时多反引号已替换为占位符，不会再被误匹配）
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    stash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0001${stash.length - 1}\u0001`;
  });
  return { stash, body: s };
}

// 行内语法：图片、链接、尖括号自动链接、删除线、粗斜体、裸 URL/邮箱
function applyInlineSyntax(s, stash) {
  const hold = (html) => {
    stash.push(html);
    return `\u0001${stash.length - 1}\u0001`;
  };

  // 图片：沿用原有的安全占位展示，不加载外链资源
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, alt) =>
    hold(`<span class="md-img-alt">🖼 ${alt}</span>`));

  // 普通链接（目标允许一层成对括号，如 Wikipedia 链接）
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, text, url) =>
    hold(`<a href="${safeUrl(url)}" target="_blank" rel="noreferrer noopener">${text}</a>`));

  // 引用式链接：`[text][ref]` 或 `[ref][]`
  s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text, ref) => {
    const key = ref.trim() || text.trim();
    const target = _linkRefs.get(key.toLowerCase());
    if (target) {
      return hold(`<a href="${safeUrl(target)}" target="_blank" rel="noreferrer noopener">${text}</a>`);
    }
    return m; // 找不到引用时原样保留
  });

  // 尖括号自动链接：<https://…> 与 <a@b.com>
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (m, url) =>
    hold(`<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`));
  s = s.replace(/&lt;([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})&gt;/g, (m, mail) =>
    hold(`<a href="mailto:${mail}">${mail}</a>`));

  // 删除线、粗体、斜体
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__([^_\n]+)__(?![\w])/g, "$1<strong>$2</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?![\w])/g, "$1<em>$2</em>");

  // 裸 URL：去掉尾随的标点
  s = s.replace(/(^|[\s(（【>])(https?:\/\/[^\s<]+)/g, (m, pre, url) => {
    let trail = "";
    const t = url.match(/[.,;:!?，。；：！？]+$/);
    if (t) {
      trail = t[0];
      url = url.slice(0, -trail.length);
    }
    return `${pre}${hold(`<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`)}${trail}`;
  });

  // 裸邮箱
  s = s.replace(/(^|[\s(（【])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m, pre, mail) =>
    `${pre}${hold(`<a href="mailto:${mail}">${mail}</a>`)}`);

  return s.replace(/\u0001(\d+)\u0001/g, (m, n) => stash[+n]);
}

// _linkRefs 是本次渲染的引用式链接声明表，在 parseReferenceLinks 中填充
let _linkRefs = new Map();

// 行内渲染入口：先处理代码（占位），再套其余语法，最后还原代码
function inline(md, state) {
  const { stash, body } = inlineCodeStash(escapeHtml(md));
  return applyInlineSyntax(body, stash);
}

// 段落/引用内换行：GFM 软换行按普通换行处理，行尾两空格或反斜杠才是硬换行
function renderInlineBlock(text, state) {
  const lines = text.split("\n");
  return lines
    .map((l, idx) => {
      const hard = / {2,}$/.test(l) || /\\$/.test(l);
      const clean = l.replace(/ {2,}$/, "").replace(/\\$/, "");
      return inline(clean, state) + (hard && idx < lines.length - 1 ? "<br>" : "");
    })
    .join("\n");
}

function indentOf(line) {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}

function isBlockStart(line) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^\s*(`{3,}|~{3,})/.test(line) ||
    /^\s{0,3}>/.test(line) ||
    /^\s*([-+*]|\d+[.)])\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s{4,}\S/.test(line) // 4 空格缩进代码块
  );
}

// 引用式链接声明：`[id]: url "title"`（title 可选）
const _linkRefRe = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)|\s+'([^']*)|\s+\(([^)]*)\))?\s*$/;

function isLinkRefDecl(line) { return _linkRefRe.test(line); }

function parseLinkRefDecls(lines, state) {
  const refs = new Map();
  for (const l of lines) {
    const m = l.match(_linkRefRe);
    if (m) refs.set(m[1].toLowerCase(), m[2]);
  }
  _linkRefs = refs;
}

// 拆表格行：支持 \| 转义，忽略首尾竖线
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
      continue;
    }
    if (s[k] === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length || !lines[i].includes("|")) return false;
  const delims = splitRow(lines[i + 1]);
  if (!delims.length || !delims.every((c) => /^:?-+:?$/.test(c))) return false;
  return splitRow(lines[i]).length === delims.length;
}

// setext 标题检测：行不为空，下一行全是 = 或 -，且至少 3 个
function isSetextStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  const title = lines[i];
  const under = lines[i + 1].trim();
  if (!title.trim()) return false;
  return /^={3,}\s*$/.test(under) || /^-{3,}\s*$/.test(under);
}

function renderTable(lines, i, state) {
  const header = splitRow(lines[i]);
  const delims = splitRow(lines[i + 1]);
  const aligns = delims.map((d) => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  i += 2;
  const rows = [];
  while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  const cell = (tag, text, idx) => {
    const style = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
    return `<${tag}${style}>${inline(text, state)}</${tag}>`;
  };
  const head = `<thead><tr>${header.map((c, idx) => cell("th", c, idx)).join("")}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows
        .map((r) => `<tr>${header.map((_, idx) => cell("td", r[idx] || "", idx)).join("")}</tr>`)
        .join("")}</tbody>`
    : "";
  return { html: `<div class="md-table-wrap"><table>${head}${body}</table></div>`, next: i };
}

// 列表（支持缩进嵌套与任务项）
function parseList(lines, start, state) {
  const first = lines[start].match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const itemRe = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-+*]\s+(.*)$/;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(itemRe);
    if (!m || m[1].length !== baseIndent) break;
    const text = m[2];
    i++;

    // 收集该列表项的续行（缩进更深），空行后仍是缩进内容时继续
    const cont = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && indentOf(lines[j]) > baseIndent) {
          for (let k = i; k < j; k++) cont.push("");
          i = j;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind > baseIndent) {
        cont.push(l.slice(Math.min(ind, baseIndent + 2)));
        i++;
        continue;
      }
      break;
    }

    // 续行拆成文字部分与嵌套块
    const textLines = [];
    let nestedAt = cont.length;
    for (let k = 0; k < cont.length; k++) {
      if (/^\s*([-+*]|\d+[.)])\s+/.test(cont[k])) {
        nestedAt = k;
        break;
      }
      if (cont[k].trim() !== "") textLines.push(cont[k]);
    }
    const nested = cont.slice(nestedAt);

    const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
    let body;
    if (task) {
      const checked = task[1].toLowerCase() === "x";
      body =
        `<input type="checkbox" disabled${checked ? " checked" : ""}> ` +
        renderInlineBlock([task[2].trim(), ...textLines].join("\n"), state);
    } else {
      body = renderInlineBlock([text.trim(), ...textLines].join("\n"), state);
    }
    if (nested.length) body += renderBlocks(nested, state);
    items.push(`<li${task ? ' class="md-task"' : ""}>${body}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : "";
  return { html: `<${tag}${startAttr}>\n${items.join("\n")}\n</${tag}>`, next: i };
}

function renderBlocks(lines, state) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 4 空格缩进代码块（要排除列表项缩进的情况：列表项本身以 -/*1. 等开头）
    if (/^\s{4,}\S/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s{4,}/.test(lines[i]) || lines[i].trim() === "")) {
        buf.push(lines[i].replace(/^\s{0,4}/, ""));
        i++;
        // 如果遇到空行后下一行又不是缩进，则停止（空行是代码块的分隔）
        if (buf[buf.length - 1].trim() === "" && i < lines.length && !/^\s{4,}/.test(lines[i])) {
          // 空行不算在代码块内（除非整段都是空行）
          while (buf.length && buf[buf.length - 1].trim() === "") buf.pop();
          break;
        }
      }
      if (buf.length) out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 围栏代码块（``` 或 ~~~，可带语言标识）
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^`]*)$/);
    if (fence) {
      const marker = fence[1];
      const info = (fence[2].trim().split(/\s+/)[0] || "").replace(/[^\w+#.-]/g, "");
      const buf = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      const src = buf.join("\n");
      // mermaid 围栏输出占位容器，由 preview.js 异步替换为图表
      if (info.toLowerCase() === "mermaid") {
        out.push(
          `<div class="md-mermaid" data-mermaid-state="pending">` +
            `<pre class="md-mermaid-src" data-lang="mermaid"><code class="language-mermaid">${escapeHtml(src)}</code></pre>` +
            `<div class="md-mermaid-msg" hidden></div>` +
            `</div>`,
        );
        continue;
      }
      const cls = info ? ` class="language-${info}"` : "";
      const attr = info ? ` data-lang="${info}"` : "";
      out.push(`<pre${attr}><code${cls}>${escapeHtml(src)}</code></pre>`);
      continue;
    }

    // setext 标题
    if (isSetextStart(lines, i)) {
      const under = lines[i + 1].trim();
      const level = /^={3,}/.test(under) ? 1 : 2;
      const slug = makeSlug(lines[i].trim(), state);
      out.push(`<h${level} id="${slug}">${inline(lines[i].trim(), state)}</h${level}>`);
      i += 2;
      continue;
    }

    // ATX 标题（生成锚点 id）
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const slug = makeSlug(h[2], state);
      out.push(`<h${level} id="${slug}">${inline(h[2], state)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // 引用式链接声明：忽略（已在渲染前收集过）
    if (isLinkRefDecl(line)) { i++; continue; }

    // 表格
    if (isTableStart(lines, i)) {
      const t = renderTable(lines, i, state);
      out.push(t.html);
      i = t.next;
      continue;
    }

    // 引用块（内部按完整块级语法递归渲染）
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>\n${renderBlocks(buf, state)}\n</blockquote>`);
      continue;
    }

    // 列表（含嵌套）
    if (/^\s*([-+*]|\d+[.)])\s+/.test(line)) {
      const list = parseList(lines, i, state);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 段落
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isBlockStart(lines[i]) &&
      !isSetextStart(lines, i) &&
      !isLinkRefDecl(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInlineBlock(buf.join("\n"), state)}</p>`);
  }

  return out.join("\n");
}

// 渲染整个文档
export function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const state = { slugs: new Map() };
  parseLinkRefDecls(lines, state);
  const html = renderBlocks(lines, state);
  _linkRefs = new Map(); // 避免残留
  return html;
}
