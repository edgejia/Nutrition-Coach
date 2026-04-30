import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

function escapedPattern(source: string) {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

const sources = {
  appCss: await readSource("../../client/src/app.css"),
  indexHtml: await readSource("../../client/index.html"),
};

describe("sport UI source contract", () => {
  it("loads approved sport fonts through the document stylesheet link", () => {
    assert.match(sources.indexHtml, /fonts\.googleapis\.com\/css2\?/);

    for (const font of [
      "family=Bebas+Neue",
      "family=Sora:wght@400;700",
      "family=Inter:wght@400;700",
      "family=JetBrains+Mono:wght@400;700",
      "family=Noto+Sans+TC:wght@400;700",
      "display=swap",
    ]) {
      assert.match(sources.indexHtml, escapedPattern(font));
    }

    for (const blockedWeight of ["wght@300", "wght@500", "wght@600", "wght@800", "wght@900"]) {
      assert.doesNotMatch(sources.indexHtml, escapedPattern(blockedWeight));
    }
  });

  it("defines sport tokens and primitive CSS classes", () => {
    for (const contract of [
      "--sp-bg: #0a0b0d;",
      "--sp-surface: #131418;",
      "--sp-surface-2: #1c1e23;",
      "--sp-surface-3: #25282e;",
      "--sp-line: rgba(255,255,255,.08);",
      "--sp-lime: #d6ff3a;",
      "--sp-red: #ff4d4d;",
      "--sp-amber: #ffb547;",
      "--sp-cyan: #6be3ff;",
      "--sp-font-display",
      "--sp-font-sans",
      "--sp-font-zh",
      "--sp-font-mono",
      ".sp-app-canvas",
      ".sp-screen",
      ".sp-card",
      ".sp-card-flat",
      ".sp-card-glow",
      ".sp-chip",
      ".sp-chip-on",
      ".sp-chip-warn",
      ".sp-chip-good",
      ".sp-chip-zh",
      ".sp-iconbtn",
      ".sp-bar-track",
      ".sp-bar-fill",
      ".sp-receipt",
      ".sp-receipt-head",
      ".sp-receipt-row",
    ]) {
      assert.match(sources.appCss, escapedPattern(contract));
    }
  });

  it("keeps demo globals and frame-only CSS out of production sport CSS", () => {
    for (const blocked of ["@import url(", "IOSDevice", ".sp-device", ".sp-notch", ".sp-statusbar"]) {
      assert.doesNotMatch(sources.appCss, escapedPattern(blocked));
    }
  });
});
