// tools.js：内置工具箱——JSON / Base64 / URL / 时间戳 / 正则测试器。
// 所有操作作用于选区（无选区则全文），通过 CodeMirror 事务提交，保留撤销历史。
import { showModal, showError } from "./dialogs.js";

function getWorkText(view) {
  const sel = view.state.selection.main;
  if (sel.empty) {
    return { from: 0, to: view.state.doc.length, text: view.state.doc.toString(), whole: true };
  }
  return { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to), whole: false };
}

function replaceWorkText(view, w, newText) {
  view.dispatch({ changes: { from: w.from, to: w.to, insert: newText } });
}

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function toolJSON(view, compact) {
  const w = getWorkText(view);
  try {
    const obj = JSON.parse(w.text);
    replaceWorkText(view, w, compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2));
  } catch (e) {
    await showError("JSON 解析失败：" + e.message);
  }
}

export async function toolBase64(view, decode) {
  const w = getWorkText(view);
  try {
    if (decode) {
      const bin = atob(w.text.replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      replaceWorkText(view, w, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } else {
      replaceWorkText(view, w, bytesToBase64(new TextEncoder().encode(w.text)));
    }
  } catch {
    await showError("Base64 转换失败：输入不是合法的编码数据");
  }
}

export async function toolURL(view, decode) {
  const w = getWorkText(view);
  try {
    replaceWorkText(view, w, decode ? decodeURIComponent(w.text) : encodeURIComponent(w.text));
  } catch (e) {
    await showError("URL 转换失败：" + e.message);
  }
}

// 时间戳 ↔ 日期互转（秒/毫秒自动识别）
export async function toolTimestamp(view) {
  const w = getWorkText(view);
  const text = w.text.trim();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  if (/^\d{10}$/.test(text)) {
    replaceWorkText(view, w, fmt(parseInt(text, 10) * 1000));
  } else if (/^\d{13}$/.test(text)) {
    replaceWorkText(view, w, fmt(parseInt(text, 10)));
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const ts = Math.floor(new Date(text.replace(" ", "T")).getTime() / 1000);
    if (Number.isNaN(ts)) {
      await showError("日期格式无效，应为 YYYY-MM-DD HH:mm:ss");
      return;
    }
    replaceWorkText(view, w, String(ts));
  } else {
    await showError("无法识别：选区应为 10/13 位时间戳，或「YYYY-MM-DD HH:mm:ss」格式日期");
  }
}

// 正则测试器：对选区或全文前 2000 字符实时匹配。
export async function showRegexTester(view) {
  const w = getWorkText(view);
  const sample = w.text.length > 2000 ? w.text.slice(0, 2000) + "\n…（已截断，仅显示前 2000 字符）" : w.text;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await showModal("正则测试器（对选区或全文前 2000 字符）", [
    { label: "关闭", primary: true, collect: () => null },
  ], (b) => {
    b.innerHTML = `
      <label style="flex-direction:column; align-items:stretch;">正则表达式（如 \\d+、[A-Z]\\w*）<input type="text" id="rt-pattern" placeholder="输入正则…"></label>
      <div style="font-size:12px; opacity:.6; margin:6px 0 2px;">样本</div>
      <pre style="max-height:110px; overflow:auto; background:var(--bg); border:1px solid var(--border); padding:8px; font-size:12px;">${esc(sample)}</pre>
      <div style="font-size:12px; opacity:.6; margin:6px 0 2px;">匹配结果</div>
      <div id="rt-result" style="max-height:140px; overflow:auto; background:var(--bg); border:1px solid var(--border); padding:8px; font-size:12px;">等待输入…</div>`;
    const input = b.querySelector("#rt-pattern");
    const result = b.querySelector("#rt-result");
    input.addEventListener("input", () => {
      if (input.value === "") { result.textContent = "等待输入…"; return; }
      try {
        const re = new RegExp(input.value, "gm");
        const matches = [...sample.matchAll(re)];
        result.innerHTML = matches.length === 0
          ? "无匹配"
          : `共 <strong>${matches.length}</strong> 处匹配<br>` +
            matches.slice(0, 20).map((m) => `· 「${esc(m[0])}」${m[1] !== undefined ? `（组1: ${esc(m[1])}）` : ""}`).join("<br>");
      } catch (e) {
        result.textContent = "正则无效：" + e.message;
      }
    });
    input.focus();
  });
}
