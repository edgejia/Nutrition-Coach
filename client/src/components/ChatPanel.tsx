import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { sendMessageStream, loadHistory } from "../api.js";
import {
  type FollowMode,
  type LiveUpdateSnapshot,
  deriveFollowModeOnScroll,
  getLiveUpdateSources,
  shouldFollowLatestOnLiveUpdate,
  shouldFollowLatestOnPersistedHistoryRefresh,
  shouldFollowLatestOnScreenEntry,
  shouldShowJumpToLatest,
} from "../lib/chat-scroll.js";
import { MessageBubble } from "./MessageBubble.js";
import { ChatInput } from "./ChatInput.js";
import { DashboardMiniBar } from "./DashboardMiniBar.js";
import type { PendingHomeChatDraft } from "../types.js";

const USER_SCROLL_INTENT_WINDOW_MS = 400;
const ENTRY_SETTLE_WINDOW_MS = 240;

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function ChatPanel() {
  const deviceId = useStore((s) => s.deviceId);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const sending = useStore((s) => s.sending);
  const setSending = useStore((s) => s.setSending);
  const provisionalBubble = useStore((s) => s.provisionalBubble);
  const setProvisionalBubble = useStore((s) => s.setProvisionalBubble);
  const commitProvisionalBubble = useStore((s) => s.commitProvisionalBubble);
  const clearDevice = useStore((s) => s.clearDevice);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const pendingHomeChatDraft = useStore((s) => s.pendingHomeChatDraft);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const clearPendingHomeChatDraft = useStore((s) => s.clearPendingHomeChatDraft);
  const contentRef = useRef<HTMLDivElement>(null);
  const attemptedDraftIdsRef = useRef<Set<string>>(new Set());
  const hadMessagesOnEntryRef = useRef(messages.length > 0);
  const isFirstMount = useRef(true);
  const entrySettleActiveRef = useRef(false);
  const entrySettleTimeoutRef = useRef<number | null>(null);
  const liveUpdateSnapshotRef = useRef<LiveUpdateSnapshot | null>(null);
  const lastUserScrollIntentAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pendingPersistedHistoryRefreshRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const followModeRef = useRef<FollowMode>("attached");
  const scrollFrameRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [followMode, setFollowMode] = useState<FollowMode>("attached");

  const isChatLocked = sending;
  const showJumpToLatest = shouldShowJumpToLatest({
    mode: followMode,
    hasMessages: messages.length > 0,
    hasProvisionalBubble: provisionalBubble !== null,
  });

  function setLocalFollowMode(nextMode: FollowMode) {
    followModeRef.current = nextMode;
    if (nextMode === "detached") {
      disarmEntrySettleWindow();
    }
    setFollowMode((currentMode) => (currentMode === nextMode ? currentMode : nextMode));
  }

  function getDistanceFromLatest(container: HTMLDivElement) {
    return container.scrollHeight - container.scrollTop - container.clientHeight;
  }

  function markUserScrollIntent() {
    lastUserScrollIntentAtRef.current = getNowMs();
  }

  function hasRecentUserScrollIntent() {
    return getNowMs() - lastUserScrollIntentAtRef.current <= USER_SCROLL_INTENT_WINDOW_MS;
  }

  function buildLiveUpdateSnapshot(): LiveUpdateSnapshot {
    const lastMessage = messages[messages.length - 1];
    return {
      messageCount: messages.length,
      lastMessageId: lastMessage?.id ?? null,
      lastMessageRole: lastMessage?.role ?? null,
      lastMessageHasImagePreview: Boolean(lastMessage?.imagePreviewUrl),
      provisionalId: provisionalBubble?.id ?? null,
      provisionalStatusLabel: provisionalBubble?.statusLabel ?? "",
      provisionalContentLength: provisionalBubble?.content.length ?? 0,
    };
  }

  function alignContainerToLatest(container: HTMLDivElement, behavior: ScrollBehavior) {
    const nextTop = container.scrollHeight;

    if (behavior === "smooth") {
      container.scrollTo({ top: nextTop, behavior });
      return;
    }

    container.scrollTop = nextTop;
    previousScrollTopRef.current = container.scrollTop;
  }

  function cancelScheduledScroll() {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }

  function clearEntrySettleTimeout() {
    if (entrySettleTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(entrySettleTimeoutRef.current);
      entrySettleTimeoutRef.current = null;
    }
  }

  function disarmEntrySettleWindow() {
    entrySettleActiveRef.current = false;
    clearEntrySettleTimeout();
  }

  function isEntrySettleActive() {
    return entrySettleActiveRef.current && followModeRef.current === "attached";
  }

  function armEntrySettleWindow() {
    if (followModeRef.current !== "attached") {
      return;
    }

    entrySettleActiveRef.current = true;
    clearEntrySettleTimeout();
    scheduleLatestAlignment({ force: true });

    requestAnimationFrame(() => {
      if (!isEntrySettleActive()) {
        return;
      }

      scheduleLatestAlignment({ force: true });

      requestAnimationFrame(() => {
        if (!isEntrySettleActive()) {
          return;
        }

        scheduleLatestAlignment({ force: true });
      });
    });

    if (typeof window !== "undefined") {
      entrySettleTimeoutRef.current = window.setTimeout(() => {
        entrySettleActiveRef.current = false;
        entrySettleTimeoutRef.current = null;
      }, ENTRY_SETTLE_WINDOW_MS);
    }
  }

  function scheduleLatestAlignment(options?: { behavior?: ScrollBehavior; force?: boolean }) {
    const container = scrollContainerRef.current;
    const behavior = options?.behavior ?? "instant";

    if (!container) {
      return;
    }

    if (!options?.force && followModeRef.current !== "attached") {
      return;
    }

    if (behavior !== "instant") {
      cancelScheduledScroll();
      alignContainerToLatest(container, behavior);
      return;
    }

    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const activeContainer = scrollContainerRef.current;
      if (!activeContainer) {
        return;
      }

      alignContainerToLatest(activeContainer, "instant");
    });
  }

  function getJumpToLatestBehavior(): ScrollBehavior {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return "smooth";
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  }

  function handleMessageImageSettle() {
    if (
      !shouldFollowLatestOnLiveUpdate({
        mode: followModeRef.current,
        source: "image-settle",
      })
    ) {
      return;
    }

    if (isEntrySettleActive()) {
      armEntrySettleWindow();
      return;
    }

    scheduleLatestAlignment();
  }

  async function handleSend(text: string, image?: File, opts?: { draftId?: string; appendUserBubble?: boolean }) {
    const activeDeviceId = useStore.getState().deviceId;
    if (!activeDeviceId) return;

    if (opts?.appendUserBubble !== false) {
      const imagePreviewUrl = image ? URL.createObjectURL(image) : undefined;
      addMessage({
        id: crypto.randomUUID(),
        role: "user" as const,
        content: text || "",
        imagePreviewUrl,
        createdAt: new Date().toISOString(),
      });
    }

    const bubbleId = crypto.randomUUID();
    setProvisionalBubble({ id: bubbleId, statusLabel: "思考中...", content: "", isStreaming: true });
    setSending(true);

    try {
      await sendMessageStream(
        text,
        {
          onStatus: (label) => {
            useStore.getState().setProvisionalStatus(label);
          },
          onToken: (token) => {
            useStore.getState().appendProvisionalToken(token);
          },
          onDone: ({ didLogMeal, didMutateMeal, dailySummary, dailyTargets }) => {
            if (useStore.getState().deviceId !== activeDeviceId) return;
            if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
              clearPendingHomeChatDraft();
            }
            if (dailyTargets) {
              setDailyTargets(dailyTargets);
            }
            if ((didLogMeal || didMutateMeal) && dailySummary) {
              setDailySummary(dailySummary);
            }
            commitProvisionalBubble({ didLogMeal: didLogMeal || didMutateMeal, dailySummary });
            setSending(false);
          },
          onError: (errorMessage) => {
            if (useStore.getState().deviceId !== activeDeviceId) return;
            useStore.getState().setProvisionalBubble({
              id: bubbleId,
              statusLabel: "",
              content: errorMessage || "抱歉，發生錯誤，請再試一次。",
              isStreaming: false,
            });
            commitProvisionalBubble({ didLogMeal: false });
            if (opts?.draftId) {
              const currentDraft = useStore.getState().pendingHomeChatDraft;
              if (currentDraft && currentDraft.id === opts.draftId) {
                setPendingHomeChatDraft({ ...currentDraft, status: "failed" });
              }
            }
            setSending(false);
          },
        },
        image,
      );
    } catch (err) {
      if (useStore.getState().deviceId !== activeDeviceId) return;
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
          clearPendingHomeChatDraft();
        }
        clearDevice();
        return;
      }
      useStore.getState().setProvisionalBubble({
        id: bubbleId,
        statusLabel: "",
        content: "抱歉，發生錯誤，請再試一次。",
        isStreaming: false,
      });
      commitProvisionalBubble({ didLogMeal: false });
      if (opts?.draftId) {
        const currentDraft = useStore.getState().pendingHomeChatDraft;
        if (currentDraft && currentDraft.id === opts.draftId) {
          setPendingHomeChatDraft({ ...currentDraft, status: "failed" });
        }
      }
      setSending(false);
    }
  }

  async function sendPendingDraft(draft: PendingHomeChatDraft) {
    attemptedDraftIdsRef.current.add(draft.id);
    setPendingHomeChatDraft({ ...draft, status: "sending" });
    await handleSend(draft.text, draft.image, {
      draftId: draft.id,
      appendUserBubble: draft.status !== "failed",
    });
  }

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const activeDeviceId = deviceId;
    loadHistory()
      .then(async ({ messages }) => {
        if (cancelled) return;
        if (useStore.getState().deviceId !== activeDeviceId) return;
        pendingPersistedHistoryRefreshRef.current = shouldFollowLatestOnPersistedHistoryRefresh({
          mode: followModeRef.current,
          snapshot: {
            hadMessagesOnEntry: hadMessagesOnEntryRef.current,
            messageCount: messages.length,
            provisionalId: useStore.getState().provisionalBubble?.id ?? null,
          },
        });
        setMessages(messages);
        const draft = useStore.getState().pendingHomeChatDraft;
        if (draft && draft.status === "staged" && !attemptedDraftIdsRef.current.has(draft.id)) {
          await sendPendingDraft(draft);
        }
      })
      .catch(async (err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          clearDevice();
          return;
        }
        const draft = useStore.getState().pendingHomeChatDraft;
        if (draft && draft.status === "staged" && !attemptedDraftIdsRef.current.has(draft.id)) {
          await sendPendingDraft(draft);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, setMessages, clearDevice, setPendingHomeChatDraft]);

  // Keep the latest edge visible for initial load and local chat updates while attached.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const nextSnapshot = buildLiveUpdateSnapshot();

    if (isFirstMount.current) {
      if (
        shouldFollowLatestOnScreenEntry({
          mode: followModeRef.current,
          snapshot: {
            messageCount: nextSnapshot.messageCount,
            provisionalId: nextSnapshot.provisionalId,
          },
        })
      ) {
        alignContainerToLatest(container, "instant");
        armEntrySettleWindow();
      }

      previousScrollTopRef.current = container.scrollTop;
      liveUpdateSnapshotRef.current = nextSnapshot;
      isFirstMount.current = false;
      return;
    }

    const previousSnapshot = liveUpdateSnapshotRef.current;
    const shouldFollowPersistedRefresh =
      pendingPersistedHistoryRefreshRef.current &&
      shouldFollowLatestOnPersistedHistoryRefresh({
        mode: followModeRef.current,
        snapshot: {
          hadMessagesOnEntry: hadMessagesOnEntryRef.current,
          messageCount: nextSnapshot.messageCount,
          provisionalId: nextSnapshot.provisionalId,
        },
      });
    const nextSources = previousSnapshot ? getLiveUpdateSources(previousSnapshot, nextSnapshot) : [];
    const shouldFollow = nextSources.some((source) =>
      shouldFollowLatestOnLiveUpdate({
        mode: followModeRef.current,
        source,
      }),
    );

    pendingPersistedHistoryRefreshRef.current = false;

    if (shouldFollowPersistedRefresh) {
      armEntrySettleWindow();
    }

    if (shouldFollow) {
      scheduleLatestAlignment();
    }

    liveUpdateSnapshotRef.current = nextSnapshot;
  }, [messages, provisionalBubble?.id, provisionalBubble?.statusLabel, provisionalBubble?.content]);

  useEffect(
    () => () => {
      cancelScheduledScroll();
      disarmEntrySettleWindow();
    },
    [],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleUserScrollIntent = () => {
      markUserScrollIntent();
    };

    container.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
    container.addEventListener("touchmove", handleUserScrollIntent, { passive: true });

    return () => {
      container.removeEventListener("wheel", handleUserScrollIntent);
      container.removeEventListener("touchstart", handleUserScrollIntent);
      container.removeEventListener("touchmove", handleUserScrollIntent);
    };
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const content = contentRef.current;
    const container = scrollContainerRef.current;
    if (!content || !container) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const shouldFollow = entries.some((entry) =>
        shouldFollowLatestOnLiveUpdate({
          mode: followModeRef.current,
          source: entry.target === content ? "content-resize" : "container-resize",
        }),
      );

      if (shouldFollow) {
        scheduleLatestAlignment();
      }
    });

    observer.observe(content);
    observer.observe(container);

    if (entrySettleActiveRef.current) {
      scheduleLatestAlignment({ force: true });
    }

    return () => {
      observer.disconnect();
      cancelScheduledScroll();
    };
  }, []);

  // Track user-initiated upward scrolling and re-attach when they return near latest.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    previousScrollTopRef.current = container.scrollTop;

    const handleScroll = () => {
      const nextScrollTop = container.scrollTop;
      const nextMode = deriveFollowModeOnScroll({
        mode: followModeRef.current,
        distanceFromLatest: getDistanceFromLatest(container),
        scrollDelta: nextScrollTop - previousScrollTopRef.current,
        userInitiated: hasRecentUserScrollIntent(),
      });

      previousScrollTopRef.current = nextScrollTop;
      setLocalFollowMode(nextMode);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  function handleBackToHome() {
    if (sending) return;
    clearPendingHomeChatDraft();
    setActiveScreen("home");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <div className="shrink-0 px-5 pb-3 pt-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={handleBackToHome}
          disabled={isChatLocked}
          className="mb-3 flex items-center gap-2 text-xs font-semibold disabled:opacity-40"
          style={{ color: "var(--text-2)" }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg text-xs"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-med)",
            }}
          >
            ‹
          </span>
          返回主頁
        </button>
        <h2
          className="mb-1 leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.025em",
          }}
        >
          教練對話
        </h2>
        <p className="mb-2.5 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
          同一個輸入框同時處理提問與記錄。AI 回覆會直接連回今日攝取狀態。
        </p>
        <DashboardMiniBar />
      </div>
      {pendingHomeChatDraft?.status === "failed" && (
        <div
          className="shrink-0 px-4 py-3 text-sm"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "rgba(232,160,32,0.06)",
            color: "var(--amber)",
          }}
        >
          上一筆草稿送出失敗。
          <button type="button" onClick={() => sendPendingDraft(pendingHomeChatDraft)} className="ml-3 font-semibold underline">
            重試送出
          </button>
          <button type="button" onClick={clearPendingHomeChatDraft} className="ml-3 font-semibold underline">
            取消草稿
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto p-4">
          <div ref={contentRef} className="space-y-3 pb-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenSummary={m.didLogMeal ? () => setActiveScreen("summary") : undefined}
                onImageSettle={handleMessageImageSettle}
              />
            ))}
            {provisionalBubble && (
              <MessageBubble
                key={provisionalBubble.id}
                message={{
                  id: provisionalBubble.id,
                  role: "assistant",
                  content: provisionalBubble.statusLabel || provisionalBubble.content,
                  createdAt: new Date().toISOString(),
                }}
                isProvisional={true}
                isStatusLabel={provisionalBubble.statusLabel.length > 0}
              />
            )}
          </div>
        </div>
        {showJumpToLatest && (
          <button
            type="button"
            onClick={() => {
              setLocalFollowMode("attached");
              scheduleLatestAlignment({
                behavior: getJumpToLatestBehavior(),
                force: true,
              });
            }}
            className="absolute bottom-3 left-1/2 z-10 flex min-h-11 -translate-x-1/2 items-center justify-center rounded-full px-4 text-[12px] font-extrabold text-white transition-all duration-150"
            style={{
              background: "var(--orange)",
              boxShadow: "0 4px 16px rgba(232,104,42,0.3)",
              lineHeight: 1.4,
            }}
            aria-label="回到最新訊息"
          >
            回到最新
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pb-safe" style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
        <ChatInput onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
