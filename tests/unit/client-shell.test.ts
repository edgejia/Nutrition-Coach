import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "../../client");
const indexHtmlPath = resolve(clientRoot, "index.html");
const faviconPath = resolve(clientRoot, "public/favicon.svg");
const manifestPath = resolve(clientRoot, "public/manifest.webmanifest");

describe("Client shell", () => {
  it("asks mobile browsers to resize layout content around virtual keyboards", () => {
    const indexHtml = readFileSync(indexHtmlPath, "utf8");

    assert.match(
      indexHtml,
      /<meta\s+name="viewport"\s+content="[^"]*\binteractive-widget=resizes-content\b[^"]*"\s*\/?>/,
    );
  });

  it("declares an explicit favicon asset", () => {
    const indexHtml = readFileSync(indexHtmlPath, "utf8");

    assert.match(indexHtml, /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/?>/);
    assert.equal(existsSync(faviconPath), true);
  });

  it("links an installable web app manifest that works behind Cloudflare Access", () => {
    const indexHtml = readFileSync(indexHtmlPath, "utf8");

    assert.match(
      indexHtml,
      /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s+crossorigin="use-credentials"\s*\/?>/,
    );
    assert.match(indexHtml, /<link\s+rel="apple-touch-icon"\s+href="\/apple-touch-icon\.png"\s*\/?>/);
    assert.equal(existsSync(resolve(clientRoot, "public/apple-touch-icon.png")), true);
    // Top safe-area insets are not handled in CSS, so the iOS status bar must stay opaque.
    assert.match(indexHtml, /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black"\s*\/?>/);
  });

  it("declares standalone display with existing installable icons", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };

    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.display, "standalone");
    for (const size of ["192x192", "512x512"]) {
      assert.ok(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === "any"), `missing ${size} icon`);
    }
    assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"), "missing maskable icon");
    for (const icon of manifest.icons) {
      assert.equal(existsSync(resolve(clientRoot, "public", icon.src.replace(/^\//, ""))), true, `${icon.src} missing`);
    }
  });
});
