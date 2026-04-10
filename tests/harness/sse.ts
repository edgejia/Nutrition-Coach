/**
 * Shared SSE parsing helpers for the deterministic verification harness.
 *
 * These helpers are extracted from inline test code so all scenario files
 * can import a stable, tested API instead of duplicating SSE frame parsing.
 */

/**
 * Parse a raw SSE text body into an ordered array of `{ event, data }` pairs.
 *
 * Handles double-newline-separated blocks, each containing one `event:` line
 * and one `data:` line. Blocks missing either field use an empty string.
 */
export function parseSSEEvents(raw: string): Array<{ event: string; data: string }> {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event =
        lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "";
      const data =
        lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "";
      return { event, data };
    });
}

/**
 * Return the ordered list of event names from a raw SSE body.
 * Useful for asserting the exact SSE event sequence a scenario produces.
 *
 * Example: collectEventSequence(raw) => ["status", "chunk", "chunk", "done"]
 */
export function collectEventSequence(raw: string): string[] {
  return parseSSEEvents(raw)
    .map((e) => e.event)
    .filter(Boolean);
}

/**
 * Read chunks from a `ReadableStreamDefaultReader<Uint8Array>` until the
 * accumulated text contains an SSE block with `event: <targetEvent>`, or
 * until `maxReads` chunks have been consumed.
 *
 * Returns the full accumulated text so callers can assert on every event
 * that arrived before and including the target.
 */
export async function readStreamUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  targetEvent: string,
  maxReads = 40,
): Promise<string> {
  const decoder = new TextDecoder();
  let combined = "";
  const needle = `event: ${targetEvent}`;

  for (let i = 0; i < maxReads; i++) {
    const chunk = await reader.read();
    if (chunk.value) {
      combined += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    if (combined.includes(needle)) {
      return combined;
    }
    if (chunk.done) {
      break;
    }
  }

  return combined;
}
