export const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40}$/;

const SOURCE_REVISION_ERROR = "Source revision is unavailable or invalid.";

export function parseSourceRevision(rawValue: unknown): string {
  if (typeof rawValue !== "string" || !SOURCE_REVISION_PATTERN.test(rawValue)) {
    throw new Error(SOURCE_REVISION_ERROR);
  }

  return rawValue;
}
