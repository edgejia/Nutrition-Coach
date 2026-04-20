import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getLiveUpdateSources,
  shouldFollowLatestOnLiveUpdate,
  shouldFollowLatestOnPersistedHistoryRefresh,
  shouldFollowLatestOnScreenEntry,
  shouldFollowLatestOnUploadStart,
  type LiveUpdateSnapshot,
} from "../../client/src/lib/chat-scroll.js";

function buildSnapshot(overrides: Partial<LiveUpdateSnapshot> = {}): LiveUpdateSnapshot {
  return {
    messageCount: 1,
    lastMessageId: "user-1",
    lastMessageRole: "user",
    lastMessageHasImagePreview: false,
    provisionalId: "prov-1",
    provisionalStatusLabel: "分析圖片中...",
    provisionalContentLength: 0,
    ...overrides,
  };
}

describe("chat-scroll live update triggers", () => {
  it("treats existing-history screen entry as an attached follow decision", () => {
    assert.equal(
      shouldFollowLatestOnScreenEntry({
        mode: "attached",
        snapshot: {
          messageCount: 3,
          provisionalId: null,
        },
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnScreenEntry({
        mode: "attached",
        snapshot: {
          messageCount: 0,
          provisionalId: null,
        },
      }),
      false,
    );
  });

  it("treats persisted-session history refresh as a follow decision after re-entry", () => {
    assert.equal(
      shouldFollowLatestOnPersistedHistoryRefresh({
        mode: "attached",
        snapshot: {
          hadMessagesOnEntry: true,
          messageCount: 3,
          provisionalId: null,
        },
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnPersistedHistoryRefresh({
        mode: "attached",
        snapshot: {
          hadMessagesOnEntry: false,
          messageCount: 3,
          provisionalId: null,
        },
      }),
      false,
    );
  });

  it("treats a fresh image upload from the bottom as its own attached follow decision", () => {
    assert.equal(
      shouldFollowLatestOnUploadStart({
        mode: "attached",
        snapshot: {
          hasImage: true,
        },
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnUploadStart({
        mode: "attached",
        snapshot: {
          hasImage: false,
        },
      }),
      false,
    );

    assert.equal(
      shouldFollowLatestOnUploadStart({
        mode: "detached",
        snapshot: {
          hasImage: true,
        },
      }),
      false,
    );
  });

  it("treats the first non-empty history hydrate as an attached follow source", () => {
    const previous = buildSnapshot({
      messageCount: 0,
      lastMessageId: null,
      lastMessageRole: null,
      provisionalId: null,
      provisionalStatusLabel: "",
      provisionalContentLength: 0,
    });
    const next = buildSnapshot({
      messageCount: 3,
      lastMessageId: "assistant-3",
      lastMessageRole: "assistant",
      provisionalId: null,
      provisionalStatusLabel: "",
    });

    assert.deepEqual(getLiveUpdateSources(previous, next), ["history-hydrate"]);
  });

  it("detects statusLabel-only updates without requiring token growth", () => {
    const previous = buildSnapshot({ provisionalStatusLabel: "分析圖片中..." });
    const next = buildSnapshot({ provisionalStatusLabel: "記錄餐點中..." });

    assert.deepEqual(getLiveUpdateSources(previous, next), ["status-label"]);
  });

  it("detects provisional commit when the final assistant message replaces the provisional bubble", () => {
    const previous = buildSnapshot();
    const next = buildSnapshot({
      messageCount: 2,
      lastMessageId: "assistant-2",
      lastMessageRole: "assistant",
      provisionalId: null,
      provisionalStatusLabel: "",
    });

    assert.deepEqual(getLiveUpdateSources(previous, next), ["provisional-commit"]);
  });

  it("detects local preview insertion when a new user bubble with an image preview is appended", () => {
    const previous = buildSnapshot({ provisionalId: null, provisionalStatusLabel: "" });
    const next = buildSnapshot({
      messageCount: 2,
      lastMessageId: "user-2",
      lastMessageRole: "user",
      lastMessageHasImagePreview: true,
      provisionalId: null,
      provisionalStatusLabel: "",
    });

    assert.deepEqual(getLiveUpdateSources(previous, next), ["user-message-append", "local-preview"]);
  });

  it("follows statusLabel-only and resize-driven updates while attached", () => {
    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "attached",
        source: "history-hydrate",
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "attached",
        source: "status-label",
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "attached",
        source: "content-resize",
      }),
      true,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "attached",
        source: "image-settle",
      }),
      true,
    );
  });

  it("does not follow observer-driven or status updates while detached", () => {
    assert.equal(
      shouldFollowLatestOnScreenEntry({
        mode: "detached",
        snapshot: {
          messageCount: 3,
          provisionalId: null,
        },
      }),
      false,
    );

    assert.equal(
      shouldFollowLatestOnPersistedHistoryRefresh({
        mode: "detached",
        snapshot: {
          hadMessagesOnEntry: true,
          messageCount: 3,
          provisionalId: null,
        },
      }),
      false,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "detached",
        source: "container-resize",
      }),
      false,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "detached",
        source: "status-label",
      }),
      false,
    );

    assert.equal(
      shouldFollowLatestOnLiveUpdate({
        mode: "detached",
        source: "image-settle",
      }),
      false,
    );
  });
});
