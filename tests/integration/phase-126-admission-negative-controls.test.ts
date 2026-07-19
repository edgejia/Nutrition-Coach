process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  createAdmissionLimiter,
  isAdmissionRejectedError,
} from "../../server/services/admission-limiter.js";
import { validateImageBytes } from "../../server/lib/image-validation.js";

const VALID_INTAKE = {
  goal: "fat_loss",
  sex: "female",
  age: 18,
  heightCm: 165,
  weightKg: 60,
  activityLevel: "moderate",
  trainingFrequency: "3_4",
} as const;

function countDevices(services: AppServices) {
  return (services.db.$client.prepare("SELECT count(*) AS count FROM devices").get() as { count: number }).count;
}

function countRows(services: AppServices, table: "chat_messages" | "assets", deviceId: string) {
  return (services.db.$client
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE device_id = ?`)
    .get(deviceId) as { count: number }).count;
}

function cookieHeader(response: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const values = response.headers["set-cookie"];
  const headers = Array.isArray(values) ? values : values ? [values] : [];
  return headers.map((value) => value.split(";", 1)[0]).join("; ");
}

function textMultipartPayload() {
  const boundary = "phase126boundary";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="message"',
    "",
    "x",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("phase-126 admission negative controls", () => {
  let apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("rejects age 17 before provider invocation or device persistence, while age 18 remains accepted", async () => {
    const minorProvider = new MockLLMProvider();
    let minorServices: AppServices | undefined;
    const minorApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: minorProvider,
      onServicesReady: (services) => {
        minorServices = services;
      },
    });
    apps.push(minorApp);

    const minor = await minorApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { ...VALID_INTAKE, age: 17 },
    });

    assert.equal(minor.statusCode, 400);
    assert.equal(minor.json().error, "VALIDATION_ERROR");
    assert.equal(minorProvider.objectCalls.length, 0);
    assert.ok(minorServices);
    assert.equal(countDevices(minorServices), 0);

    const adultProvider = new MockLLMProvider();
    adultProvider.queueObjectContent(JSON.stringify({
      calories: 1800,
      protein: 120,
      carbs: 210,
      fat: 53,
      coachExplanation: "以穩定赤字開始。",
    }));
    let adultServices: AppServices | undefined;
    const adultApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: adultProvider,
      onServicesReady: (services) => {
        adultServices = services;
      },
    });
    apps.push(adultApp);

    const adult = await adultApp.inject({
      method: "POST",
      url: "/api/device",
      payload: VALID_INTAKE,
    });

    assert.equal(adult.statusCode, 200);
    assert.equal(adultProvider.objectCalls.length, 1);
    assert.ok(adultServices);
    assert.equal(countDevices(adultServices), 1);
  });

  it("returns 429 from exhausted bootstrap admission before provider work and durable side effects", async () => {
    const provider = new MockLLMProvider();
    provider.queueObjectContent(JSON.stringify({
      calories: 1800,
      protein: 120,
      carbs: 210,
      fat: 53,
      coachExplanation: "合成測試資料。",
    }));
    const limiter = createAdmissionLimiter({
      budgets: {
        provider: { maxRequests: 1, maxConcurrent: 1 },
        bootstrap: { maxRequests: 0, maxConcurrent: 0 },
      },
    });
    let services: AppServices | undefined;
    const app = await buildApp({
      dbPath: ":memory:",
      llmProvider: provider,
      admissionLimiter: limiter,
      onServicesReady: (ready) => {
        services = ready;
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: VALID_INTAKE,
    });

    assert.equal(response.statusCode, 429);
    assert.match(String(response.headers["retry-after"]), /^\d+$/);
    assert.equal(provider.objectCalls.length, 0);
    assert.ok(services);
    assert.equal(countDevices(services), 0);
  });

  it("does not reset a stable authorized subject when a valid session version rotates", () => {
    let now = 100_000;
    const limiter = createAdmissionLimiter({
      now: () => now,
      windowMs: 10_000,
      budgets: {
        provider: { maxRequests: 1, maxConcurrent: 1 },
      },
    });

    const first = limiter.tryAcquire("provider", { deviceId: "authorized-device", sessionVersion: 0 });
    assert.equal(first.ok, true);
    if (first.ok) first.permit.release();

    const rotated = limiter.tryAcquire("provider", { deviceId: "authorized-device", sessionVersion: 1 });
    assert.equal(rotated.ok, false);
    if (!rotated.ok) assert.equal(rotated.statusCode, 429);

    now += 10_000;
    const reset = limiter.tryAcquire("provider", { deviceId: "authorized-device", sessionVersion: 1 });
    assert.equal(reset.ok, true);
    if (reset.ok) reset.permit.release();
  });

  it("bounds JSON provider admission after multipart validation and cleans staged uploads on rejection", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-phase126-admission-"));
    const uploadsDir = path.join(tempRoot, "uploads");
    let services: AppServices | undefined;
    const app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      uploadsDir,
      admissionLimiter: createAdmissionLimiter({
        budgets: { provider: { maxRequests: 0, maxConcurrent: 0 } },
      }),
      onServicesReady: (ready) => {
        services = ready;
      },
    });
    apps.push(app);

    try {
      const device = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
      assert.equal(device.statusCode, 200);
      const deviceId = device.json().deviceId as string;
      const beforeMessages = countRows(services!, "chat_messages", deviceId);
      const beforeAssets = countRows(services!, "assets", deviceId);
      const multipart = textMultipartPayload();
      const response = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: cookieHeader(device),
          "content-type": multipart.contentType,
        },
        payload: multipart.body,
      });

      assert.equal(response.statusCode, 429);
      assert.match(String(response.headers["retry-after"]), /^\d+$/);
      assert.equal(countRows(services!, "chat_messages", deviceId), beforeMessages);
      assert.equal(countRows(services!, "assets", deviceId), beforeAssets);
      assert.deepEqual(await readdir(uploadsDir).catch(() => []), []);

      const sse = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: cookieHeader(device),
          accept: "text/event-stream",
          "content-type": multipart.contentType,
        },
        payload: multipart.body,
      });
      assert.equal(sse.statusCode, 429);
      assert.match(String(sse.headers["retry-after"]), /^\d+$/);
      assert.equal(countRows(services!, "chat_messages", deviceId), beforeMessages);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns 429 for decode admission before Sharp work and does not expose a raw failure body", async () => {
    const limiter = createAdmissionLimiter({
      budgets: { decode: { maxRequests: 0, maxConcurrent: 0 } },
    });

    await assert.rejects(
      validateImageBytes(Buffer.from("not-an-image"), "image/jpeg", {
        admissionLimiter: limiter,
        admissionSubject: { deviceId: "authorized-device", sessionVersion: 0 },
      }),
      (error: unknown) => {
        assert.equal(isAdmissionRejectedError(error), true);
        if (isAdmissionRejectedError(error)) {
          assert.equal(error.statusCode, 429);
          assert.match(String(error.retryAfterSeconds), /^\d+$/);
        }
        return true;
      },
    );
  });

  it("releases the decode permit after Sharp rejects bytes", async () => {
    const limiter = createAdmissionLimiter({
      budgets: { decode: { maxRequests: 4, maxConcurrent: 1 } },
    });
    const options = {
      admissionLimiter: limiter,
      admissionSubject: { deviceId: "authorized-device", sessionVersion: 0 },
    } as const;

    assert.equal(await validateImageBytes(Buffer.from("not-an-image"), "image/jpeg", options), false);
    assert.equal(await validateImageBytes(Buffer.from("not-an-image"), "image/jpeg", options), false);
  });

  it("bounds session bootstrap for the cookie-derived subject without letting a version rotation reset it", async () => {
    const limiter = createAdmissionLimiter({
      budgets: { bootstrap: { maxRequests: 1, maxConcurrent: 1 } },
    });
    let services: AppServices | undefined;
    const app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      admissionLimiter: limiter,
      onServicesReady: (ready) => {
        services = ready;
      },
    });
    apps.push(app);

    const device = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    assert.equal(device.statusCode, 200);
    const deviceId = device.json().deviceId as string;
    const cookies = cookieHeader(device);

    const firstSession = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: cookies },
      payload: {},
    });
    assert.equal(firstSession.statusCode, 200);

    await createDeviceService(services!.db).bumpSessionVersion(deviceId);
    const rotated = services!.guestSessionService.issue(deviceId, 1).cookies
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const rejected = await app.inject({
      method: "POST",
      url: "/api/device/session",
      headers: { cookie: rotated },
      payload: {},
    });
    assert.equal(rejected.statusCode, 429);
    assert.match(String(rejected.headers["retry-after"]), /^\d+$/);
    assert.equal(countDevices(services!), 1);
  });
});
