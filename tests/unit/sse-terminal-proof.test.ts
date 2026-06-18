process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSSETerminalProof,
  readStreamThroughClose,
  summarizeSSETerminalProof,
} from "../harness/sse.js";

function streamFromFrames(frames: string[], close = true): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      if (close) {
        controller.close();
      }
    },
  });
}

describe("SSE terminal proof", () => {
  test("passes a stream that emits chunk, done, then closes", async () => {
    const collection = await readStreamThroughClose(
      streamFromFrames([
        'event: chunk\ndata: {"token":"hello"}\n\n',
        'event: done\ndata: {"reply":"hello"}\n\n',
      ]).getReader(),
      { maxReads: 10, readTimeoutMs: 1000 },
    );

    const proof = assertSSETerminalProof(collection);

    assert.equal(proof.ok, true);
    assert.equal(proof.evidence.closed, true);
    assert.equal(proof.evidence.firstDoneObserved, true);
    assert.equal(proof.evidence.firstDoneIndex, 1);
    assert.equal(proof.evidence.noPostDoneChunkOrStatus, true);
    assert.equal(typeof proof.evidence.rawLength, "number");
    assert.ok(proof.evidence.rawLength > 0);
  });

  test("fails a post-done chunk terminal violation", async () => {
    const collection = await readStreamThroughClose(
      streamFromFrames([
        'event: chunk\ndata: {"token":"hello"}\n\n',
        'event: done\ndata: {"reply":"hello"}\n\n',
        'event: chunk\ndata: {"token":"late"}\n\n',
      ]).getReader(),
      { maxReads: 10, readTimeoutMs: 1000 },
    );

    const proof = assertSSETerminalProof(collection);

    assert.equal(proof.ok, false);
    assert.equal(proof.error, "SSE emitted chunk/status after first done");
    assert.deepEqual(proof.evidence.terminalViolationEvents, ["chunk"]);
    assert.equal(proof.evidence.noPostDoneChunkOrStatus, false);
  });

  test("fails a post-done status terminal violation", async () => {
    const collection = await readStreamThroughClose(
      streamFromFrames([
        'event: chunk\ndata: {"token":"hello"}\n\n',
        'event: done\ndata: {"reply":"hello"}\n\n',
        "event: status\ndata: late\n\n",
      ]).getReader(),
      { maxReads: 10, readTimeoutMs: 1000 },
    );

    const proof = assertSSETerminalProof(collection);

    assert.equal(proof.ok, false);
    assert.equal(proof.error, "SSE emitted chunk/status after first done");
    assert.deepEqual(proof.evidence.terminalViolationEvents, ["status"]);
    assert.equal(proof.evidence.noPostDoneChunkOrStatus, false);
  });

  test("summarizes structured terminal metadata without raw event payloads", async () => {
    const collection = await readStreamThroughClose(
      streamFromFrames([
        'event: chunk\ndata: {"token":"hello"}\n\n',
        'event: done\ndata: {"reply":"hello"}\n\n',
      ]).getReader(),
      { maxReads: 10, readTimeoutMs: 1000 },
    );

    assert.deepEqual(Object.keys(summarizeSSETerminalProof(collection)).sort(), [
      "closed",
      "firstDoneIndex",
      "firstDoneObserved",
      "noPostDoneChunkOrStatus",
      "nonEmptyChunkBeforeDone",
      "postDoneEventNames",
      "rawLength",
      "readCount",
      "terminalViolationEvents",
    ]);
  });

  test("rejects a stream that never closes within maxReads", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("event: status\ndata: pending\n\n"));
      },
    });

    await assert.rejects(
      () => readStreamThroughClose(stream.getReader(), { maxReads: 2, readTimeoutMs: 1000 }),
      /SSE stream did not close within 2 reads/,
    );
  });
});
