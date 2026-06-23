import sharp from "sharp";

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const IMAGE_FORMAT_BY_MIME_TYPE = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_DECODED_IMAGE_PIXELS = 40_000_000;

export async function validateImageBytes(buffer: Buffer, claimedMimeType: string): Promise<boolean> {
  const expectedFormat = IMAGE_FORMAT_BY_MIME_TYPE.get(claimedMimeType);
  if (!expectedFormat) return false;
  try {
    const image = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) return false;
    await image.raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}
