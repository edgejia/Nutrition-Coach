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

export interface CollectedSSEStream {
  raw: string;
  events: Array<{ event: string; data: string }>;
  closed: boolean;
  firstDoneIndex: number;
  eventsAfterFirstDone: Array<{ event: string; data: string }>;
  nonEmptyChunkBeforeDone: boolean;
  reads: number;
}

export interface SSETerminalProofEvidence {
  closed: boolean;
  firstDoneObserved: boolean;
  firstDoneIndex: number;
  noPostDoneChunkOrStatus: boolean;
  postDoneEventNames: string[];
  terminalViolationEvents: string[];
  nonEmptyChunkBeforeDone: boolean;
  readCount: number;
  rawLength: number;
}

export type SSETerminalProofResult =
  | { ok: true; evidence: SSETerminalProofEvidence }
  | { ok: false; error: string; evidence: SSETerminalProofEvidence };

export async function readStreamThroughClose(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: { maxReads?: number; readTimeoutMs?: number } = {},
): Promise<CollectedSSEStream> {
  const decoder = new TextDecoder();
  const maxReads = options.maxReads ?? 80;
  const readTimeoutMs = options.readTimeoutMs ?? 5000;
  let raw = "";

  for (let reads = 0; reads < maxReads; reads += 1) {
    const chunk = await readWithTimeout(reader, readTimeoutMs);
    if (chunk.value) {
      raw += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    if (chunk.done) {
      raw += decoder.decode();
      return summarizeCollectedSSE(raw, true, reads + 1);
    }
  }

  throw new Error(`SSE stream did not close within ${maxReads} reads`);
}

export function summarizeSSETerminalProof(collection: CollectedSSEStream): SSETerminalProofEvidence {
  const postDoneEventNames = collection.eventsAfterFirstDone.map((event) => event.event);
  const terminalViolationEvents = postDoneEventNames.filter(
    (eventName) => eventName === "chunk" || eventName === "status",
  );
  return {
    closed: collection.closed,
    firstDoneObserved: collection.firstDoneIndex !== -1,
    firstDoneIndex: collection.firstDoneIndex,
    noPostDoneChunkOrStatus: terminalViolationEvents.length === 0,
    postDoneEventNames,
    terminalViolationEvents,
    nonEmptyChunkBeforeDone: collection.nonEmptyChunkBeforeDone,
    readCount: collection.reads,
    rawLength: collection.raw.length,
  };
}

export function assertSSETerminalProof(collection: CollectedSSEStream): SSETerminalProofResult {
  const evidence = summarizeSSETerminalProof(collection);
  if (!evidence.closed) {
    return { ok: false, error: "SSE stream close was not observed", evidence };
  }
  if (!evidence.firstDoneObserved) {
    return { ok: false, error: "SSE stream did not include done", evidence };
  }
  if (!evidence.noPostDoneChunkOrStatus) {
    return { ok: false, error: "SSE emitted chunk/status after first done", evidence };
  }
  return { ok: true, evidence };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  readTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`SSE stream read timed out after ${readTimeoutMs}ms`)),
          readTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function summarizeCollectedSSE(raw: string, closed: boolean, reads: number): CollectedSSEStream {
  const events = parseSSEEvents(raw);
  const firstDoneIndex = events.findIndex((event) => event.event === "done");
  const eventsBeforeDone = firstDoneIndex === -1 ? events : events.slice(0, firstDoneIndex);
  return {
    raw,
    events,
    closed,
    firstDoneIndex,
    eventsAfterFirstDone: firstDoneIndex === -1 ? [] : events.slice(firstDoneIndex + 1),
    nonEmptyChunkBeforeDone: eventsBeforeDone.some((event) => {
      if (event.event !== "chunk") {
        return false;
      }
      try {
        const parsed = JSON.parse(event.data) as { token?: unknown };
        return typeof parsed.token === "string" && parsed.token.trim().length > 0;
      } catch {
        return false;
      }
    }),
    reads,
  };
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
