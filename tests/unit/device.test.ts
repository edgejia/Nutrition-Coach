// tests/unit/device.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";

describe("DeviceService", () => {
  let service: ReturnType<typeof createDeviceService>;

  beforeEach(() => {
    const db = createDb(":memory:");
    service = createDeviceService(db);
  });

  it("creates a fat_loss device with default targets", async () => {
    const result = await service.createDevice("fat_loss");
    assert.ok(result.deviceId);
    assert.equal(result.dailyTargets.calories, 1500);
    assert.equal(result.dailyTargets.protein, 120);
    assert.equal(result.dailyTargets.carbs, 150);
    assert.equal(result.dailyTargets.fat, 50);
  });

  it("creates a muscle_gain device with default targets", async () => {
    const result = await service.createDevice("muscle_gain");
    assert.equal(result.dailyTargets.calories, 2500);
    assert.equal(result.dailyTargets.protein, 180);
  });

  it("rejects an invalid goal", async () => {
    await assert.rejects(() => service.createDevice("invalid_goal" as any), { message: /Invalid goal/ });
  });

  it("gets a device by id", async () => {
    const { deviceId } = await service.createDevice("fat_loss");
    const device = await service.getDevice(deviceId);
    assert.ok(device);
    assert.equal(device.goal, "fat_loss");
  });

  it("returns undefined for unknown device", async () => {
    const device = await service.getDevice("nonexistent");
    assert.equal(device, undefined);
  });

  it("updates daily goals partially", async () => {
    const { deviceId } = await service.createDevice("fat_loss");
    const updated = await service.updateGoals(deviceId, { protein: 150, calories: 1800 });
    assert.equal(updated.protein, 150);
    assert.equal(updated.calories, 1800);
    assert.equal(updated.carbs, 150); // unchanged
    assert.equal(updated.fat, 50);    // unchanged
  });
});
