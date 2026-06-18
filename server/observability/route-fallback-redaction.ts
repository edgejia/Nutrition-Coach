const SAFE_ROUTE_ERROR_TEXT = /^[A-Za-z0-9 .:_/-]+$/;
const ROUTE_ERROR_NAME_LIMIT = 80;
const ROUTE_ERROR_MESSAGE_LIMIT = 160;
const UNSAFE_ROUTE_ERROR_TERMS = [
  "prompt",
  "message",
  "messages",
  "user",
  "nutrition",
  "provider",
  "body",
  "header",
  "authorization",
  "bearer",
  "tool",
  "payload",
  "guest_session",
  "session",
  "cookie",
  "image",
  "data:image",
  "assistant",
  "final reply",
  "stack",
  "cause",
  "device",
  "upload",
] as const;

export function sanitizeRouteFallbackCatchField(value: string | undefined, limit: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const rawText = value.trim();
  if (!rawText || !SAFE_ROUTE_ERROR_TEXT.test(rawText)) {
    return undefined;
  }
  const lower = rawText.toLowerCase();
  if (UNSAFE_ROUTE_ERROR_TERMS.some((term) => lower.includes(term))) {
    return undefined;
  }
  return rawText.slice(0, limit).trim();
}

export function sanitizeRouteFallbackCatchFields(params: {
  errorName?: string;
  errorMessage?: string;
}): { errorName?: string; errorMessage?: string } {
  const errorName = sanitizeRouteFallbackCatchField(params.errorName, ROUTE_ERROR_NAME_LIMIT);
  const errorMessage = sanitizeRouteFallbackCatchField(params.errorMessage, ROUTE_ERROR_MESSAGE_LIMIT);

  return {
    ...(errorName !== undefined ? { errorName } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}
