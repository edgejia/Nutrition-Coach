import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateImageBytes } from "../../server/lib/image-validation.js";
import {
  validJpegBytes,
  validPngBytes,
  validWebpBytes,
} from "../fixtures/image-bytes.js";

function fixtureBuffer(bytes: ArrayBuffer): Buffer {
  return Buffer.from(bytes);
}

function assertCheck(label: string, actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    assert.fail(`native compatibility check failed: ${label}`);
  }
}

describe("sharp native compatibility", () => {
  it("sharp accepts generated jpeg/png/webp", async () => {
    await assertCheck(
      "sharp accepts generated jpeg",
      await validateImageBytes(fixtureBuffer(validJpegBytes()), "image/jpeg"),
      true,
    );
    await assertCheck(
      "sharp accepts generated png",
      await validateImageBytes(fixtureBuffer(validPngBytes()), "image/png"),
      true,
    );
    await assertCheck(
      "sharp accepts generated webp",
      await validateImageBytes(fixtureBuffer(validWebpBytes()), "image/webp"),
      true,
    );
  });

  it("sharp rejects non-image bytes", async () => {
    await assertCheck(
      "sharp rejects non-image bytes",
      await validateImageBytes(Buffer.from("not an image", "utf8"), "image/jpeg"),
      false,
    );
  });

  it("sharp rejects jpeg-as-png", async () => {
    await assertCheck(
      "sharp rejects jpeg-as-png",
      await validateImageBytes(fixtureBuffer(validJpegBytes()), "image/png"),
      false,
    );
  });

  it("sharp rejects png-as-jpeg", async () => {
    await assertCheck(
      "sharp rejects png-as-jpeg",
      await validateImageBytes(fixtureBuffer(validPngBytes()), "image/jpeg"),
      false,
    );
  });

  it("sharp rejects webp-as-jpeg", async () => {
    await assertCheck(
      "sharp rejects webp-as-jpeg",
      await validateImageBytes(fixtureBuffer(validWebpBytes()), "image/jpeg"),
      false,
    );
  });
});

describe("better-sqlite3 native compatibility", () => {
  it("migrates, writes, closes, reopens, and reads grouped meal data", async () => {
    assert.fail("native sqlite file-backed persistence proof not implemented");
  });
});
