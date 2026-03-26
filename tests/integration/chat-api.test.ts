import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

describe("Chat API", () => {
  let app: FastifyInstance;
  let deviceId: string;

  beforeEach(async () => {
    app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  it("POST /api/chat accepts multipart text-only requests", async () => {
    const address = await app.listen({ port: 0 });
    try {
      const form = new FormData();
      form.append("message", "我吃了蘋果");

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.reply);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat accepts multipart image upload", async () => {
    const address = await app.listen({ port: 0 });
    try {
      const form = new FormData();
      form.append("message", "");
      form.append("image", new Blob(["fake image"], { type: "image/png" }), "meal.png");

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.reply);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat rejects invalid image types", async () => {
    const address = await app.listen({ port: 0 });
    try {
      const form = new FormData();
      form.append("message", "");
      form.append("image", new Blob(["not an image"], { type: "text/plain" }), "meal.txt");

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      assert.equal(res.status, 400);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat rejects images larger than 5MB", async () => {
    const address = await app.listen({ port: 0 });
    try {
      const form = new FormData();
      form.append("message", "");
      form.append("image", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }), "too-big.png");

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      assert.equal(res.status, 400);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat returns 401 without device id", async () => {
    const address = await app.listen({ port: 0 });
    try {
      const form = new FormData();
      form.append("message", "hello");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        body: form,
      });
      assert.equal(res.status, 401);
    } finally {
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("GET /api/chat/history returns messages", async () => {
    const address = await app.listen({ port: 0 });
    const form = new FormData();
    form.append("message", "你好");
    await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(res.statusCode, 200);
    const { messages } = res.json();
    assert.ok(messages.length >= 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");
  });

  it("GET /api/chat/history rejects invalid limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=0",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(res.statusCode, 400);
  });
});
