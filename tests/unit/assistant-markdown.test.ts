import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseAssistantMarkdown, parseAssistantMarkdownInline } = await import("../../client/src/lib/assistant-markdown.js");

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

  it("keeps unsupported syntax as plain text instead of interpreting it", () => {
    const inlineTokens = parseAssistantMarkdownInline("<b>bold</b> [連結](https://example.com) # 標題");

    assert.deepEqual(inlineTokens, [
      { type: "text", text: "<b>bold</b> [連結](https://example.com) # 標題" },
    ]);
  });
});
