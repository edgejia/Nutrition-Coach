import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { parseAssistantMarkdown, parseAssistantMarkdownInline } = await import("../../client/src/lib/assistant-markdown.js");
const { AssistantMarkdown } = await import("../../client/src/components/AssistantMarkdown.js");

describe("Assistant Markdown", () => {
  it("parses paragraphs and bold text within the approved subset", () => {
    const blocks = parseAssistantMarkdown("先吃 **雞胸肉**。\n晚點補優格。\n\n今天先這樣。");

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "paragraph");
    if (blocks[0]?.type !== "paragraph") {
      throw new Error("expected paragraph block");
    }
    assert.deepEqual(blocks[0].lines[0], [
      { type: "text", text: "先吃 " },
      { type: "bold", text: "雞胸肉" },
      { type: "text", text: "。" },
    ]);
    assert.deepEqual(blocks[0].lines[1], [{ type: "text", text: "晚點補優格。" }]);
  });

  it("parses ordered and unordered lists as dedicated blocks", () => {
    const blocks = parseAssistantMarkdown("1. 雞胸肉\n2. 白飯\n\n- 優格\n- 水果");

    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0], {
      type: "list",
      ordered: true,
      items: [
        [[{ type: "text", text: "雞胸肉" }]],
        [[{ type: "text", text: "白飯" }]],
      ],
    });
    assert.deepEqual(blocks[1], {
      type: "list",
      ordered: false,
      items: [
        [[{ type: "text", text: "優格" }]],
        [[{ type: "text", text: "水果" }]],
      ],
    });
  });

  it("parses supported heading markers as dedicated heading blocks", () => {
    assert.deepEqual(parseAssistantMarkdown("# 早餐"), [
      {
        type: "heading",
        level: 1,
        content: [{ type: "text", text: "早餐" }],
      },
    ]);

    assert.deepEqual(parseAssistantMarkdown("## 午餐\n\n### 點心"), [
      {
        type: "heading",
        level: 2,
        content: [{ type: "text", text: "午餐" }],
      },
      {
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "點心" }],
      },
    ]);
  });

  it("normalizes any deeper markdown headings into the existing h3 visual level", () => {
    assert.deepEqual(parseAssistantMarkdown("#### 過深\n##### 更深\n###### 最深\n####### 超深"), [
      {
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "過深" }],
      },
      {
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "更深" }],
      },
      {
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "最深" }],
      },
      {
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "超深" }],
      },
    ]);
  });

  it("keeps invalid heading-like syntax as plain text", () => {
    const blocks = parseAssistantMarkdown("#NoSpace\n###");

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "paragraph");
    if (blocks[0]?.type !== "paragraph") {
      throw new Error("expected paragraph block");
    }
    assert.deepEqual(blocks[0].lines, [
      [{ type: "text", text: "#NoSpace" }],
      [{ type: "text", text: "###" }],
    ]);
  });

  it("keeps unsupported syntax as plain text instead of interpreting it", () => {
    const inlineTokens = parseAssistantMarkdownInline("<b>bold</b> [連結](https://example.com) # 標題");

    assert.deepEqual(inlineTokens, [
      { type: "text", text: "<b>bold</b> [連結](https://example.com) # 標題" },
    ]);
  });

  it("renders supported headings as semantic tags without leaking raw markers", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMarkdown, { content: "# 早餐" }));

    assert.match(markup, /<h1>早餐<\/h1>/);
    assert.doesNotMatch(markup, /# 早餐/);
  });

  it("preserves source order across headings, paragraphs, and lists", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMarkdown, { content: "## 午餐\n內文\n\n- 優格" }));

    const h2Index = markup.indexOf("<h2>午餐</h2>");
    const paragraphIndex = markup.indexOf("<p>內文</p>");
    const listIndex = markup.indexOf("<ul><li>優格</li></ul>");

    assert.ok(h2Index >= 0);
    assert.ok(paragraphIndex > h2Index);
    assert.ok(listIndex > paragraphIndex);
  });

  it("reuses inline token rendering inside headings", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMarkdown, { content: "### **蛋白質** 估算" }));

    assert.match(markup, /<h3><strong>蛋白質<\/strong> 估算<\/h3>/);
  });

  it("renders any deeper markdown headings as h3 without leaking raw markers", () => {
    const markup = renderToStaticMarkup(createElement(AssistantMarkdown, { content: "####### 點心提醒" }));

    assert.match(markup, /<h3>點心提醒<\/h3>/);
    assert.doesNotMatch(markup, /####### 點心提醒/);
  });

  it("keeps ordered list numbers visibly styled in chat markdown CSS", async () => {
    const cssSource = await readFile(
      fileURLToPath(new URL("../../client/src/app.css", import.meta.url)),
      "utf8",
    );

    assert.match(cssSource, /\.assistant-markdown ol\s*\{[\s\S]*list-style-type:\s*decimal/);
    assert.match(cssSource, /\.assistant-markdown ol\s*\{[\s\S]*padding-left:\s*28px/);
    assert.match(cssSource, /\.assistant-markdown ol > li::marker\s*\{[\s\S]*color:\s*var\(--sp-lime\)/);
    assert.match(cssSource, /\.assistant-markdown ol > li::marker\s*\{[\s\S]*font-weight:\s*800/);
  });
});
