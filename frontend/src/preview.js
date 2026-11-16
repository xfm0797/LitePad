// preview.js：Markdown 实时预览窗格。
// 渲染做 250ms 去抖，并在重排后按比例恢复滚动位置，避免每次输入都跳回顶部。
import { renderMarkdown } from "./md-render.js";

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export function createPreview({ viewRef, tabRef }) {
  const pane = document.querySelector("#preview-pane");
  let on = false;
  let timer = null;

  function toggle() {
    on = !on;
    pane.classList.toggle("hidden", !on);
    render();
  }

  function render() {
    if (!on) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tab = tabRef();
      if (!tab) return;
      const doc = viewRef().state.doc;
      if (doc.length > MAX_PREVIEW_BYTES) {
        pane.textContent = "文档超过 2MB，已暂停实时预览以保证编辑流畅。";
        return;
      }
      const prevMax = pane.scrollHeight - pane.clientHeight;
      const ratio = prevMax > 0 ? pane.scrollTop / prevMax : 0;
      pane.innerHTML = renderMarkdown(doc.toString());
      if (ratio > 0) {
        const max = pane.scrollHeight - pane.clientHeight;
        pane.scrollTop = Math.min(max, Math.round(ratio * max));
      }
    }, 250);
  }

  function hide() {
    if (!on) return;
    on = false;
    pane.classList.add("hidden");
  }

  return { toggle, render, hide, isOn: () => on };
}
