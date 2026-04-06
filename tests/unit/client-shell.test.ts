import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "../../client");
const indexHtmlPath = resolve(clientRoot, "index.html");
const faviconPath = resolve(clientRoot, "public/favicon.svg");

describe("Client shell", () => {
  it("declares an explicit favicon asset", () => {
    const indexHtml = readFileSync(indexHtmlPath, "utf8");

    assert.match(indexHtml, /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/?>/);
    assert.equal(existsSync(faviconPath), true);
  });
});
