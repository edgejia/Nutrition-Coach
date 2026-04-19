import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { assetReferences, assets } from "../db/schema.js";

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function extensionFromFilename(filename?: string) {
  if (!filename) {
    return "";
  }
  const ext = path.extname(filename).toLowerCase();
  return ext === "." ? "" : ext;
}

export function makeAssetRef(id: string): string {
  return `asset:${id}`;
}

export function parseAssetRef(ref: string | null | undefined): string | null {
  if (!ref?.startsWith("asset:")) {
    return null;
  }
  const assetId = ref.slice("asset:".length).trim();
  return assetId.length > 0 ? assetId : null;
}

export function buildAssetUrl(id: string): string {
  return `/api/assets/${id}`;
}

export function createAssetService(
  db: AppDatabase,
  opts: { assetsDir: string },
) {
  const assetsRoot = opts.assetsDir;

  function toAbsolutePath(storageKey: string) {
    return path.join(assetsRoot, storageKey);
  }

  return {
    async createAsset(
      deviceId: string,
      input: { stagedPath: string; mimeType: string; originalFilename?: string },
    ) {
      const id = crypto.randomUUID();
      const extension =
        extensionFromFilename(input.originalFilename) || extensionFromMimeType(input.mimeType);
      const storageKey = path.posix.join("meal-images", `${id}${extension}`);
      const durablePath = toAbsolutePath(storageKey);
      const createdAt = new Date().toISOString();

      await mkdir(path.dirname(durablePath), { recursive: true });
      await copyFile(input.stagedPath, durablePath);

      try {
        const fileStat = await stat(durablePath);
        await db.insert(assets).values({
          id,
          deviceId,
          storageKey,
          mimeType: input.mimeType,
          byteSize: fileStat.size,
          createdAt,
        });
      } catch (error) {
        await rm(durablePath, { force: true });
        throw error;
      }

      return {
        id,
        deviceId,
        storageKey,
        mimeType: input.mimeType,
        byteSize: (await stat(durablePath)).size,
        createdAt,
        filePath: durablePath,
      };
    },

    async getOwnedAsset(deviceId: string, assetId: string) {
      const asset = (
        await db
          .select()
          .from(assets)
          .where(and(eq(assets.id, assetId), eq(assets.deviceId, deviceId)))
      )[0];

      if (!asset) {
        return null;
      }

      return {
        ...asset,
        filePath: toAbsolutePath(asset.storageKey),
      };
    },

    async readOwnedAsset(deviceId: string, assetId: string) {
      const asset = await this.getOwnedAsset(deviceId, assetId);
      if (!asset) {
        return null;
      }

      return {
        ...asset,
        bytes: await readFile(asset.filePath),
      };
    },

    async deleteOwnedAsset(deviceId: string, assetId: string) {
      const asset = await this.getOwnedAsset(deviceId, assetId);
      if (!asset) {
        return false;
      }

      await db
        .delete(assets)
        .where(and(eq(assets.id, assetId), eq(assets.deviceId, deviceId)));
      await rm(asset.filePath, { force: true });
      return true;
    },

    async createAssetReference(
      deviceId: string,
      assetId: string,
      ownerType: string,
      ownerId: string,
    ) {
      const createdAt = new Date().toISOString();

      await db.insert(assetReferences).values({
        id: `${ownerType}:${ownerId}:${assetId}`,
        assetId,
        deviceId,
        ownerType,
        ownerId,
        createdAt,
      });

      return {
        id: `${ownerType}:${ownerId}:${assetId}`,
        assetId,
        deviceId,
        ownerType,
        ownerId,
        createdAt,
      };
    },

    async isAssetRefReferenced(assetRef: string) {
      const assetId = parseAssetRef(assetRef);
      if (!assetId) {
        return false;
      }

      const reference = (
        await db
          .select({ id: assetReferences.id })
          .from(assetReferences)
          .where(eq(assetReferences.assetId, assetId))
          .limit(1)
      )[0];

      return Boolean(reference);
    },
  };
}
