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

async function readOptionalSource(relativePath: string) {
  try {
    return await readSource(relativePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function escapedPattern(source: string) {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

const sources = {
  appCss: await readSource("../../client/src/app.css"),
  indexHtml: await readSource("../../client/index.html"),
  sportIcons: await readOptionalSource("../../client/src/components/SportIcons.tsx"),
  sportPrimitives: await readOptionalSource("../../client/src/components/SportPrimitives.tsx"),
};

describe("sport UI source contract", () => {
  it("loads approved sport fonts through the document stylesheet link", () => {
    assert.match(sources.indexHtml, /fonts\.googleapis\.com\/css2\?/);

    for (const font of [
      "family=Architects+Daughter",
      "family=Bebas+Neue",
      "family=Bricolage+Grotesque:wght@400;700",
      "family=Caveat:wght@400;700",
      "family=Inter:wght@400;700",
      "family=JetBrains+Mono:wght@400;700",
      "family=Manrope:wght@400;700",
      "family=Noto+Sans+TC:wght@400;700",
      "family=Sora:wght@400;700",
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
      ".sp-bar-fill-cyan",
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

  it("exports typed sport primitives with clamped progress and production classes", () => {
    for (const primitiveExport of [
      "SportScreen",
      "SportCard",
      "SportChip",
      "SportIconButton",
      "SportProgressBar",
      "SportRing",
      "SportReceipt",
    ]) {
      assert.match(sources.sportPrimitives, new RegExp(`export function ${primitiveExport}`));
    }

    assert.match(sources.sportPrimitives, /function clampUnit\(value: number\)/);
    assert.match(sources.sportPrimitives, /Math\.max\(0, Math\.min\(1, value\)\)/);
    assert.match(sources.sportPrimitives, /"aria-label": string/);

    for (const className of [
      "sp-screen",
      "sp-card",
      "sp-card-flat",
      "sp-card-glow",
      "sp-chip",
      "sp-chip-zh",
      "sp-iconbtn",
      "sp-bar-track",
      "sp-bar-fill",
      "sp-bar-fill-cyan",
      "sp-receipt",
    ]) {
      assert.match(sources.sportPrimitives, escapedPattern(className));
    }

    assert.doesNotMatch(sources.sportPrimitives, /window\./);
  });

  it("exports typed sport icons without demo globals or public SVG imports", () => {
    assert.match(sources.sportIcons, /export interface SportIconProps/);
    assert.match(sources.sportIcons, /viewBox="0 0 24 24"/);
    assert.match(sources.sportIcons, /stroke="currentColor"/);
    assert.match(sources.sportIcons, /strokeLinecap="round"/);
    assert.match(sources.sportIcons, /strokeLinejoin="round"/);
    assert.match(sources.sportIcons, /stroke = 1\.6/);
    assert.match(sources.sportIcons, /aria-hidden.*true/s);

    for (const iconExport of [
      "SportHomeIcon",
      "SportChatIcon",
      "SportHistoryIcon",
      "SportCameraIcon",
      "SportSendIcon",
      "SportSettingsIcon",
      "SportChevronLeftIcon",
      "SportChevronRightIcon",
      "SportFlameIcon",
      "SportBoltIcon",
      "SportPlusIcon",
      "SportCloseIcon",
    ]) {
      assert.match(sources.sportIcons, new RegExp(`export function ${iconExport}`));
    }

    for (const blocked of ["Object.assign(window", "window.", ".svg"]) {
      assert.doesNotMatch(sources.sportIcons, escapedPattern(blocked));
    }
  });
});
