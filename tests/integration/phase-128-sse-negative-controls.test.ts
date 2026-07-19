import assert from "node:assert/strict";
import test from "node:test";
import { assertSSETerminalProof, readStreamThroughClose } from "../harness/sse.js";

function streamFromFrames(frames: string[], close = true): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      if (close) controller.close();
    },
  });
}

test("Phase 128 SSE controls accept only a complete single-terminal stream", async () => {
  const valid = await readStreamThroughClose(streamFromFrames([
    "event: status\ndata: processing\n\n",
    'event: chunk\ndata: {"token":"hello"}\n\n',
    "event: done\ndata: {}\n\n",
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  const validProof = assertSSETerminalProof(valid);
  assert.equal(validProof.ok, true);
  assert.equal(validProof.evidence.doneCount, 1);

  const lateChunk = await readStreamThroughClose(streamFromFrames([
    'event: chunk\ndata: {"token":"hello"}\n\n',
    "event: done\ndata: {}\n\n",
    'event: chunk\ndata: {"token":"late"}\n\n',
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  const lateChunkProof = assertSSETerminalProof(lateChunk);
  assert.equal(lateChunkProof.ok, false);
  assert.deepEqual(lateChunkProof.evidence.terminalViolationEvents, ["chunk"]);

  const late = await readStreamThroughClose(streamFromFrames([
    'event: chunk\ndata: {"token":"hello"}\n\n',
    "event: done\ndata: {}\n\n",
    "event: status\ndata: late\n\n",
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  assert.equal(assertSSETerminalProof(late).ok, false);

  const duplicate = await readStreamThroughClose(streamFromFrames([
    'event: chunk\ndata: {"token":"hello"}\n\n',
    "event: done\ndata: {}\n\n",
    "event: done\ndata: {}\n\n",
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  const duplicateProof = assertSSETerminalProof(duplicate);
  assert.equal(duplicateProof.ok, false);
  assert.equal(duplicateProof.evidence.doneCount, 2);

  const missing = await readStreamThroughClose(streamFromFrames([
    'event: chunk\ndata: {"token":"hello"}\n\n',
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  assert.equal(assertSSETerminalProof(missing).ok, false);

  const doneWithoutContent = await readStreamThroughClose(streamFromFrames([
    "event: status\ndata: processing\n\n",
    "event: done\ndata: {}\n\n",
  ]).getReader(), { maxReads: 10, readTimeoutMs: 1000 });
  const doneWithoutContentProof = assertSSETerminalProof(doneWithoutContent);
  assert.equal(doneWithoutContentProof.ok, false);
  assert.equal(doneWithoutContentProof.evidence.nonEmptyChunkBeforeDone, false);

  const encoder = new TextEncoder();
  let pulls = 0;
  const neverClose = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      } else {
        controller.enqueue(encoder.encode("event: status\ndata: pending\n\n"));
      }
    },
  });
  const neverCloseReader = neverClose.getReader();
  try {
    await assert.rejects(
      () => readStreamThroughClose(neverCloseReader, { maxReads: 2, readTimeoutMs: 1000 }),
      /SSE stream did not close within 2 reads/,
    );
  } finally {
    await neverCloseReader.cancel();
  }
});
