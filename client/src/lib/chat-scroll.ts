const NEAR_LATEST_ANCHOR_THRESHOLD_PX = 96;

export type FollowMode = "attached" | "detached";
export type LiveUpdateSource =
  | "history-hydrate"
  | "status-label"
  | "token-stream"
  | "provisional-commit"
  | "user-message-append"
  | "local-preview"
  | "content-resize"
  | "container-resize";

export interface LiveUpdateSnapshot {
  messageCount: number;
  lastMessageId: string | null;
  lastMessageRole: "user" | "assistant" | null;
  lastMessageHasImagePreview: boolean;
  provisionalId: string | null;
  provisionalStatusLabel: string;
  provisionalContentLength: number;
}

export interface ScreenEntrySnapshot {
  messageCount: number;
  provisionalId: string | null;
}

export interface PersistedHistoryRefreshSnapshot {
  hadMessagesOnEntry: boolean;
  messageCount: number;
  provisionalId: string | null;
}

const ATTACHED_FOLLOW_SOURCES = new Set<LiveUpdateSource>([
  "history-hydrate",
  "status-label",
  "token-stream",
  "provisional-commit",
  "user-message-append",
  "local-preview",
  "content-resize",
  "container-resize",
]);

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
  userInitiated?: boolean;
  threshold?: number;
}): FollowMode {
  const { mode, distanceFromLatest, scrollDelta, userInitiated = false, threshold } = args;

  if (isNearLatestAnchor(distanceFromLatest, threshold)) {
    return "attached";
  }

  if (scrollDelta < 0 && userInitiated) {
    return "detached";
  }

  return mode;
}

export function getLiveUpdateSources(
  previous: LiveUpdateSnapshot,
  next: LiveUpdateSnapshot,
): LiveUpdateSource[] {
  const sources: LiveUpdateSource[] = [];
  const messageCountIncreased = next.messageCount > previous.messageCount;
  const lastMessageChanged = next.lastMessageId !== previous.lastMessageId;

  if (
    previous.messageCount === 0 &&
    previous.lastMessageId === null &&
    previous.provisionalId === null &&
    next.messageCount > 0 &&
    next.provisionalId === null
  ) {
    sources.push("history-hydrate");
  }

  if (next.provisionalStatusLabel !== previous.provisionalStatusLabel && next.provisionalStatusLabel.length > 0) {
    sources.push("status-label");
  }

  if (next.provisionalContentLength > previous.provisionalContentLength) {
    sources.push("token-stream");
  }

  if (messageCountIncreased && lastMessageChanged) {
    if (previous.provisionalId && !next.provisionalId && next.lastMessageRole === "assistant") {
      sources.push("provisional-commit");
    } else if (sources.length === 0 && next.lastMessageRole === "user") {
      sources.push("user-message-append");
      if (next.lastMessageHasImagePreview) {
        sources.push("local-preview");
      }
    }
  }

  return sources;
}

export function shouldFollowLatestOnScreenEntry(args: {
  mode: FollowMode;
  snapshot: ScreenEntrySnapshot;
}): boolean {
  const { mode, snapshot } = args;
  if (mode !== "attached") {
    return false;
  }

  return snapshot.messageCount > 0 || snapshot.provisionalId !== null;
}

export function shouldFollowLatestOnPersistedHistoryRefresh(args: {
  mode: FollowMode;
  snapshot: PersistedHistoryRefreshSnapshot;
}): boolean {
  const { mode, snapshot } = args;
  if (mode !== "attached") {
    return false;
  }

  if (!snapshot.hadMessagesOnEntry) {
    return false;
  }

  return snapshot.messageCount > 0 || snapshot.provisionalId !== null;
}

export function shouldFollowLatestOnLiveUpdate(args: {
  mode: FollowMode;
  source: LiveUpdateSource;
}): boolean {
  const { mode, source } = args;
  return mode === "attached" && ATTACHED_FOLLOW_SOURCES.has(source);
}

export function shouldShowJumpToLatest(args: {
  mode: FollowMode;
  hasMessages: boolean;
  hasProvisionalBubble: boolean;
}): boolean {
  const { mode, hasMessages, hasProvisionalBubble } = args;
  return mode === "detached" && (hasMessages || hasProvisionalBubble);
}
