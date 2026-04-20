import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveFollowModeOnScroll,
  isNearLatestAnchor,
  shouldShowJumpToLatest,
} from "../../client/src/lib/chat-scroll.js";

describe("chat-scroll contract", () => {
  it("treats 96px as attached and values above it as detached", () => {
    assert.equal(isNearLatestAnchor(96), true);
    assert.equal(isNearLatestAnchor(97), false);
  });

  it("detaches when the user scrolls upward beyond the threshold", () => {
    const nextMode = deriveFollowModeOnScroll({
      mode: "attached",
      distanceFromLatest: 140,
      scrollDelta: -24,
    });

    assert.equal(nextMode, "detached");
  });

  it("does not detach because content growth changed the distance", () => {
    const nextMode = deriveFollowModeOnScroll({
      mode: "attached",
      distanceFromLatest: 140,
      scrollDelta: 0,
    });

    assert.equal(nextMode, "attached");
  });

  it("reattaches when the user returns near the latest anchor", () => {
    const nextMode = deriveFollowModeOnScroll({
      mode: "detached",
      distanceFromLatest: 48,
      scrollDelta: 32,
    });

    assert.equal(nextMode, "attached");
  });

  it("shows the jump control only while detached and content exists", () => {
    assert.equal(
      shouldShowJumpToLatest({
        mode: "detached",
        hasMessages: true,
        hasProvisionalBubble: false,
      }),
      true,
    );

    assert.equal(
      shouldShowJumpToLatest({
        mode: "attached",
        hasMessages: true,
        hasProvisionalBubble: true,
      }),
      false,
    );
  });
});
