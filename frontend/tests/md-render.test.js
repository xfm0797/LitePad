import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/md-render.js";

test("标题生成锚点，重名自动追加序号", () => {
  const html = renderMarkdown("# 标题\n\n# 标题");
  assert.match(html, /id="标题"/);
  assert.match(html, /id="标题-1"/);
});

test("原始 HTML 一律转义，不执行", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("链接协议白名单拦截 javascript: 与 data:", () => {
  assert.match(renderMarkdown("[x](javascript:alert(1))"), /href="#"/);
  assert.match(renderMarkdown("[x](data:text/html,hi)"), /href="#"/);
  assert.match(renderMarkdown("[x](https://example.com)"), /href="https:\/\/example\.com"/);
});

test("裸 URL 自动链接并剥离尾随标点", () => {
  const html = renderMarkdown("see https://example.com.");
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes("</a>."));
});

test("表格支持左/右对齐", () => {
  const html = renderMarkdown("| a | b |\n| :-- | --: |\n| 1 | 2 |");
  assert.ok(html.includes('style="text-align:left"'));
  assert.ok(html.includes('style="text-align:right"'));
  assert.ok(html.includes("<th"));
});

test("任务列表渲染只读复选框", () => {
  const html = renderMarkdown("- [x] done\n- [ ] todo");
  assert.ok(html.includes('type="checkbox" disabled checked'));
  assert.ok(html.includes('type="checkbox" disabled>'));
});

test("mermaid 围栏输出待渲染占位容器", () => {
  const html = renderMarkdown("```mermaid\ngraph TD;A-->B\n```");
  assert.ok(html.includes('class="md-mermaid"'));
  assert.ok(html.includes('data-mermaid-state="pending"'));
  assert.ok(html.includes("language-mermaid"));
});

test("GFM 行尾双空格生成硬换行", () => {
  const html = renderMarkdown("a  \nb");
  assert.ok(html.includes("a<br>"));
});

test("普通代码块保留语言标识且内容转义", () => {
  const html = renderMarkdown("```js\nif (a < b) {}\n```");
  assert.ok(html.includes('data-lang="js"'));
  assert.ok(html.includes("language-js"));
  assert.ok(html.includes("a &lt; b"));
});

test("setext 标题：=== 为 H1，--- 为 H2", () => {
  const h1 = renderMarkdown("Title\n===");
  assert.match(h1, /<h1[^>]*id=.*Title/);
  const h2 = renderMarkdown("Sub\n---");
  assert.match(h2, /<h2[^>]*id=.*Sub/);
});

test("4 空格缩进代码块（GFM）", () => {
  const html = renderMarkdown("    line1\n    line2\n\npara");
  assert.ok(html.includes("<pre><code>"));
  assert.ok(html.includes("line1"));
  assert.ok(html.includes("<p>para</p>"));
});

test("多反引号行内代码包含单反引号", () => {
  const html = renderMarkdown("use ``code with ` inside`` fine");
  assert.ok(html.includes("<code>code with ` inside</code>"));
  assert.ok(!html.match(/<code>.*<code>/));
});

test("引用式链接：[text][ref] 或 [ref][]", () => {
  const body = renderMarkdown("[Go][golang]\n\n[golang]: https://go.dev \"Go\"");
  assert.match(body, /href="https:\/\/go\.dev"/);

  const body2 = renderMarkdown("[Go][]\n\n[go]: https://go.dev");
  assert.match(body2, /href="https:\/\/go\.dev"/);
});
