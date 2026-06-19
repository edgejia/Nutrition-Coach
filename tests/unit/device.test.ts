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

  it("creates a maintain device with default targets", async () => {
    const result = await service.createDevice("maintain");
    assert.equal(result.dailyTargets.calories, 2000);
    assert.equal(result.dailyTargets.protein, 150);
  });

  it("creates a device with full intake data", async () => {
    const result = await service.createDevice("fat_loss", {
      sex: "male",
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "花生",
      goalClarification: "不想影響重訓表現",
      bodyFatPercent: 20,
      tdee: 2200,
      advancedNotes: "",
    });

    assert.equal(result.dailyTargets.calories, 1500);

    const device = await service.getDevice(result.deviceId);
    assert.ok(device);
    assert.equal(device.sex, "male");
    assert.equal(device.age, 30);
    assert.equal(device.heightCm, 175);
    assert.equal(device.weightKg, 80);
    assert.equal(device.activityLevel, "moderate");
    assert.equal(device.trainingFrequency, "3_4");
    assert.equal(device.allergies, "花生");
    assert.equal(device.goalClarification, "不想影響重訓表現");
    assert.equal(device.bodyFatPercent, 20);
    assert.equal(device.tdee, 2200);
    assert.equal(device.advancedNotes, "");
    assert.equal(device.coachExplanation, null);
  });

  it("creates a device with only required intake fields", async () => {
    const result = await service.createDevice("muscle_gain", {
      sex: "female",
      age: 25,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "active",
      trainingFrequency: "5_plus",
    });

    assert.equal(result.dailyTargets.calories, 2500);

    const device = await service.getDevice(result.deviceId);
    assert.ok(device);
    assert.equal(device.sex, "female");
    assert.equal(device.age, 25);
    assert.equal(device.heightCm, 165);
    assert.equal(device.weightKg, 58);
    assert.equal(device.activityLevel, "active");
    assert.equal(device.trainingFrequency, "5_plus");
    assert.equal(device.allergies, null);
    assert.equal(device.goalClarification, null);
    assert.equal(device.bodyFatPercent, null);
    assert.equal(device.tdee, null);
    assert.equal(device.advancedNotes, null);
    assert.equal(device.coachExplanation, null);
  });

  it("rejects an invalid goal", async () => {
    await assert.rejects(() => service.createDevice("invalid_goal" as any), { message: /Invalid goal/ });
  });

  it("rejects an invalid goal even when custom targets are provided", async () => {
    const validIntake = {
      sex: "male",
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
    };
    const customTargets = {
      calories: 1900,
      protein: 140,
      carbs: 180,
      fat: 60,
    };

    await assert.rejects(
      () => service.createDevice("invalid_goal" as any, validIntake, customTargets),
      { message: /Invalid goal/ },
    );
  });

  it("gets a device by id", async () => {
    const { deviceId } = await service.createDevice("fat_loss");
    const device = await service.getDevice(deviceId);
    assert.ok(device);
    assert.equal(device.goal, "fat_loss");
    assert.equal(device.sessionVersion, 0);
  });

  it("returns undefined for unknown device", async () => {
    const device = await service.getDevice("nonexistent");
    assert.equal(device, undefined);
  });

  it("increments a device session version monotonically", async () => {
    const { deviceId } = await service.createDevice("fat_loss");

    await service.bumpSessionVersion(deviceId);
    let device = await service.getDevice(deviceId);
    assert.ok(device);
    assert.equal(device.sessionVersion, 1);

    await service.bumpSessionVersion(deviceId);
    device = await service.getDevice(deviceId);
    assert.ok(device);
    assert.equal(device.sessionVersion, 2);
  });

  it("does not create a row when bumping an unknown device session version", async () => {
    await service.bumpSessionVersion("missing-device");

    const device = await service.getDevice("missing-device");
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
