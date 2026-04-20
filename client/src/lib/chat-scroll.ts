const NEAR_LATEST_ANCHOR_THRESHOLD_PX = 96;

export type FollowMode = "attached" | "detached";

export function isNearLatestAnchor(
  distanceFromLatest: number,
  threshold: number = NEAR_LATEST_ANCHOR_THRESHOLD_PX,
): boolean {
  return distanceFromLatest <= threshold;
}

export function deriveFollowModeOnScroll(args: {
  mode: FollowMode;
  distanceFromLatest: number;
  scrollDelta: number;
  threshold?: number;
}): FollowMode {
  const { mode, distanceFromLatest, scrollDelta, threshold } = args;

  if (isNearLatestAnchor(distanceFromLatest, threshold)) {
    return "attached";
  }

  if (scrollDelta < 0) {
    return "detached";
  }

  return mode;
}

export function shouldShowJumpToLatest(args: {
  mode: FollowMode;
  hasMessages: boolean;
  hasProvisionalBubble: boolean;
}): boolean {
  const { mode, hasMessages, hasProvisionalBubble } = args;
  return mode === "detached" && (hasMessages || hasProvisionalBubble);
}
