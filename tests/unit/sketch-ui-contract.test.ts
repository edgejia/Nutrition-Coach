import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

const sources = {
  appCss: await readSource("../../client/src/app.css"),
  sketchPrimitives: await readSource("../../client/src/components/SketchPrimitives.tsx"),
  sketchIcons: await readSource("../../client/src/components/SketchIcons.tsx"),
};

describe("sketch UI source contract", () => {
  it("defines exact sketch tokens and primitive classes", () => {
    for (const token of [
      "--sk-paper: #fbf9f4;",
      "--sk-ink: #1a1612;",
      "--sk-paper-warm: #f4ede0;",
      "--sk-accent: oklch(0.68 0.14 38);",
      ".sk-app-canvas",
      ".sk-box",
      ".sk-box-soft",
      ".sk-pill",
      ".sk-progress",
      ".sk-ring-label",
    ]) {
      assert.match(sources.appCss, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps prototype-only frame chrome and CDN imports out of production CSS", () => {
    for (const blocked of ["@import url(", ".sk-frame", ".sk-notch", ".sk-statusbar", ".sk-anno", "data-anno"]) {
      assert.doesNotMatch(sources.appCss, new RegExp(blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("exports sketch primitives with clamped numeric components", () => {
    assert.match(sources.sketchPrimitives, /export function SketchRing/);
    assert.match(sources.sketchPrimitives, /export function SecondaryHeader/);
    assert.match(sources.sketchPrimitives, /Math\.max\(0, Math\.min\(1, value\)\)/);
  });

  it("exports local outline SVG icons without public icon assets", async () => {
    for (const iconExport of [
      "HomeIcon",
      "MessageCircleIcon",
      "CalendarDaysIcon",
      "SettingsIcon",
      "CameraIcon",
      "SendIcon",
      "ChevronLeftIcon",
    ]) {
      assert.match(sources.sketchIcons, new RegExp(`export function ${iconExport}`));
    }
    assert.match(sources.sketchIcons, /strokeWidth=\{1\.8\}/);

    const publicEntries = await readdir(sourcePath("../../client/public"));
    assert.deepEqual(
      publicEntries.filter((entry) => entry !== "favicon.svg" && entry.toLowerCase().includes("icon") && entry.endsWith(".svg")),
      [],
      "client/public should not contain Phase 31 public icon SVG assets",
    );
  });
});
