import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import {
  buildAssetUrl,
  createAssetService,
  makeAssetRef,
  parseAssetRef,
} from "../../server/services/assets.js";

describe("AssetService", () => {
  let db: ReturnType<typeof createDb> & { $client: { close(): void } };
  let assetsDir: string;
  let stagingDir: string;
  let deviceId: string;
  let assetService: ReturnType<typeof createAssetService>;

  beforeEach(async () => {
    db = createDb(":memory:") as ReturnType<typeof createDb> & { $client: { close(): void } };
    assetsDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-assets-"));
    stagingDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-staging-"));
    const deviceService = createDeviceService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    assetService = createAssetService(db, { assetsDir });
  });

  afterEach(async () => {
    db.$client.close();
    await rm(assetsDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  });

  it("creates durable assets and stores metadata outside the staging directory", async () => {
    const stagedPath = path.join(stagingDir, "meal.jpg");
    await writeFile(stagedPath, Buffer.from("meal-image"));

    const asset = await assetService.createAsset(deviceId, {
      stagedPath,
      mimeType: "image/jpeg",
      originalFilename: "meal.jpg",
    });

    assert.match(asset.storageKey, /^meal-images\//);
    assert.equal(makeAssetRef(asset.id), `asset:${asset.id}`);
    assert.equal(buildAssetUrl(asset.id), `/api/assets/${asset.id}`);
    assert.ok(asset.filePath.startsWith(assetsDir));
    assert.ok(!asset.filePath.startsWith(stagingDir));
    assert.equal((await stat(asset.filePath)).size, "meal-image".length);
  });

  it("parses only asset refs and rejects raw /uploads/ paths", () => {
    assert.equal(parseAssetRef("asset:abc123"), "abc123");
    assert.equal(parseAssetRef("/uploads/meal.jpg"), null);
    assert.equal(parseAssetRef("server/uploads/meal.jpg"), null);
    assert.equal(parseAssetRef(null), null);
  });

  it("deletes both the metadata row and durable file", async () => {
    const stagedPath = path.join(stagingDir, "meal.png");
    await writeFile(stagedPath, Buffer.from("png-image"));

    const asset = await assetService.createAsset(deviceId, {
      stagedPath,
      mimeType: "image/png",
      originalFilename: "meal.png",
    });

    const deleted = await assetService.deleteOwnedAsset(deviceId, asset.id);
    assert.equal(deleted, true);
    assert.equal(await assetService.getOwnedAsset(deviceId, asset.id), null);
    await assert.rejects(() => access(asset.filePath));
  });
});
