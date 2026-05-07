import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { getMeals, sendMessageStream, loadHistory, stopChatTurn } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { createClientId } from "../lib/clientId.js";
import {
  type FollowMode,
  type LiveUpdateSnapshot,
  deriveFollowModeOnScroll,
  getLiveUpdateSources,
  shouldFollowLatestOnLiveUpdate,
  shouldFollowLatestOnPersistedHistoryRefresh,
  shouldFollowLatestOnScreenEntry,
  shouldFollowLatestOnUploadStart,
  shouldShowJumpToLatest,
} from "../lib/chat-scroll.js";
import { MessageBubble } from "./MessageBubble.js";
import { ChatInput } from "./ChatInput.js";
import { SportChevronLeftIcon } from "./SportIcons.js";
import type { Message, PendingHomeChatDraft } from "../types.js";

const USER_SCROLL_INTENT_WINDOW_MS = 400;
const ENTRY_SETTLE_WINDOW_MS = 240;
const UPLOAD_SETTLE_WINDOW_MS = 320;
const STOP_FALLBACK_TIMEOUT_MS = 1000;
const PHASE40_INCOMPLETE_RECEIPT_FLAG = "phase40IncompleteReceipt";
const PHASE40_INCOMPLETE_RECEIPT_ID = "phase40-incomplete-receipt-mock";

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatMealCountSummary(mealCount: number) {
  return `今日已紀錄 ${mealCount} 餐`;
}

function formatMealCountCompact(mealCount: number) {
  return `${mealCount} 餐`;
}

function shouldShowPhase40IncompleteReceiptMock() {
  if (typeof window === "undefined") {
    return false;
  }

  const isLocalDevHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalDevHost) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    params.get(PHASE40_INCOMPLETE_RECEIPT_FLAG) === "1" ||
    window.localStorage.getItem(PHASE40_INCOMPLETE_RECEIPT_FLAG) === "1"
  );
}

function createPhase40IncompleteReceiptMock(): Message {
  return {
    id: PHASE40_INCOMPLETE_RECEIPT_ID,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    loggedMeal: {
      foodName: "鮭魚飯糰",
      calories: 780,
      protein: 38,
      carbs: 82,
      fat: 24,
      itemCount: 1,
    },
  };
}

function addPhase40IncompleteReceiptMockIfNeeded(existingMessages: Message[], addMessage: (message: Message) => void) {
  if (!shouldShowPhase40IncompleteReceiptMock()) {
    return;
  }

  if (existingMessages.some((message) => message.id === PHASE40_INCOMPLETE_RECEIPT_ID)) {
    return;
  }

  addMessage(createPhase40IncompleteReceiptMock());
}

export function ChatPanel() {
  const deviceId = useStore((s) => s.deviceId);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setDailyTargets = useStore((s) => s.setDailyTargets);
  const setMeals = useStore((s) => s.setMeals);
  const dailySummary = useStore((s) => s.dailySummary);
  const dailyTargets = useStore((s) => s.dailyTargets);
  const sending = useStore((s) => s.sending);
  const setSending = useStore((s) => s.setSending);
  const provisionalBubble = useStore((s) => s.provisionalBubble);
  const setProvisionalBubble = useStore((s) => s.setProvisionalBubble);
  const commitProvisionalBubble = useStore((s) => s.commitProvisionalBubble);
  const commitStoppedProvisionalBubble = useStore((s) => s.commitStoppedProvisionalBubble);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const pendingHomeChatDraft = useStore((s) => s.pendingHomeChatDraft);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const clearPendingHomeChatDraft = useStore((s) => s.clearPendingHomeChatDraft);
  const meals = useStore((s) => s.meals);
  const openMealEdit = useStore((s) => s.openMealEdit);
  const contentRef = useRef<HTMLDivElement>(null);
  const attemptedDraftIdsRef = useRef<Set<string>>(new Set());
  const hadMessagesOnEntryRef = useRef(messages.length > 0);
  const isFirstMount = useRef(true);
  const entrySettleActiveRef = useRef(false);
  const entrySettleTimeoutRef = useRef<number | null>(null);
  const uploadSettleActiveRef = useRef(false);
  const uploadSettleTimeoutRef = useRef<number | null>(null);
  const liveUpdateSnapshotRef = useRef<LiveUpdateSnapshot | null>(null);
  const lastUserScrollIntentAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pendingPersistedHistoryRefreshRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const followModeRef = useRef<FollowMode>("attached");
  const scrollFrameRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const stopFallbackTimeoutRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const [followMode, setFollowMode] = useState<FollowMode>("attached");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const isChatLocked = sending;
  const todayKey = formatLocalDate(new Date());
  const todayMeals = meals.filter((meal) => formatLocalDate(new Date(meal.loggedAt)) === todayKey);
  const consumedCalories = Math.round(dailySummary?.totalCalories ?? 0).toLocaleString("en-US");
  const targetCalories = Math.round(dailyTargets?.calories ?? 0).toLocaleString("en-US");
  const todayMealCount = dailySummary?.mealCount ?? todayMeals.length;
  const todayMealCountSummary = formatMealCountSummary(todayMealCount);
  const todayMealCountCompact = formatMealCountCompact(todayMealCount);
  const showJumpToLatest = shouldShowJumpToLatest({
    mode: followMode,
    hasMessages: messages.length > 0,
    hasProvisionalBubble: provisionalBubble !== null,
  });

  function setLocalFollowMode(nextMode: FollowMode) {
    followModeRef.current = nextMode;
    if (nextMode === "detached") {
      disarmEntrySettleWindow();
      disarmUploadSettleWindow();
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

  function clearUploadSettleTimeout() {
    if (uploadSettleTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(uploadSettleTimeoutRef.current);
      uploadSettleTimeoutRef.current = null;
    }
  }

  function clearStopFallbackTimeout() {
    if (stopFallbackTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(stopFallbackTimeoutRef.current);
      stopFallbackTimeoutRef.current = null;
    }
  }

  function setStoppingMode(nextStopping: boolean) {
    stoppingRef.current = nextStopping;
    setStopping(nextStopping);
  }

  function clearActiveStreamAfterTerminal() {
    clearStopFallbackTimeout();
    activeAbortControllerRef.current = null;
    activeTurnIdRef.current = null;
    setActiveTurnId(null);
    setStoppingMode(false);
  }

  function cleanupActiveStream() {
    clearStopFallbackTimeout();
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    activeTurnIdRef.current = null;
    setActiveTurnId(null);
    setStoppingMode(false);
  }

  function armStopFallback() {
    clearStopFallbackTimeout();
    if (typeof window === "undefined") {
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
      activeTurnIdRef.current = null;
      setActiveTurnId(null);
      setStoppingMode(false);
      return;
    }
    stopFallbackTimeoutRef.current = window.setTimeout(() => {
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
      activeTurnIdRef.current = null;
      setActiveTurnId(null);
      setStoppingMode(false);
    }, STOP_FALLBACK_TIMEOUT_MS);
  }

  function disarmEntrySettleWindow() {
    entrySettleActiveRef.current = false;
    clearEntrySettleTimeout();
  }

  function disarmUploadSettleWindow() {
    uploadSettleActiveRef.current = false;
    clearUploadSettleTimeout();
  }

  function isEntrySettleActive() {
    return entrySettleActiveRef.current && followModeRef.current === "attached";
  }

  function isUploadSettleActive() {
    return uploadSettleActiveRef.current && followModeRef.current === "attached";
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

  function armUploadSettleWindow() {
    if (followModeRef.current !== "attached") {
      return;
    }

    uploadSettleActiveRef.current = true;
    clearUploadSettleTimeout();
    scheduleLatestAlignment({ force: true });

    requestAnimationFrame(() => {
      if (!isUploadSettleActive()) {
        return;
      }

      scheduleLatestAlignment({ force: true });

      requestAnimationFrame(() => {
        if (!isUploadSettleActive()) {
          return;
        }

        scheduleLatestAlignment({ force: true });
      });
    });

    if (typeof window !== "undefined") {
      uploadSettleTimeoutRef.current = window.setTimeout(() => {
        uploadSettleActiveRef.current = false;
        uploadSettleTimeoutRef.current = null;
      }, UPLOAD_SETTLE_WINDOW_MS);
    }
  }

  function handleBeforeSend(payload: { hasImage: boolean; hasText: boolean }) {
    if (
      shouldFollowLatestOnUploadStart({
        mode: followModeRef.current,
        snapshot: {
          hasImage: payload.hasImage,
        },
      })
    ) {
      armUploadSettleWindow();
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

    if (isUploadSettleActive()) {
      armUploadSettleWindow();
      return;
    }

    scheduleLatestAlignment();
  }

  async function refreshTodayMeals() {
    try {
      const { meals } = await getMeals({ refreshReason: "meal_mutation" });
      setMeals(meals);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      }
    }
  }

  function handleStopStreaming() {
    if (!sending || stoppingRef.current) return;
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;

    setStoppingMode(true);
    useStore.getState().setProvisionalStatus("正在停止...");
    armStopFallback();
    void stopChatTurn({ turnId }).catch((err) => {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      }
    });
  }

  async function handleSend(text: string, image?: File, opts?: { draftId?: string; appendUserBubble?: boolean }) {
    const activeDeviceId = useStore.getState().deviceId;
    if (!activeDeviceId) return;

    if (
      shouldFollowLatestOnUploadStart({
        mode: followModeRef.current,
        snapshot: {
          hasImage: image !== undefined,
        },
      })
    ) {
      armUploadSettleWindow();
    }

    if (opts?.appendUserBubble !== false) {
      const imagePreviewUrl = image ? URL.createObjectURL(image) : undefined;
      addMessage({
        id: createClientId("usr"),
        role: "user" as const,
        content: text || "",
        imagePreviewUrl,
        createdAt: new Date().toISOString(),
      });
    }

    const bubbleId = createClientId("ast");
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;
    activeTurnIdRef.current = null;
    setActiveTurnId(null);
    setStoppingMode(false);
    setProvisionalBubble({ id: bubbleId, statusLabel: "思考中...", content: "", isStreaming: true });
    setSending(true);

    try {
      await sendMessageStream(
        text,
        {
          onTurnStart: (turnId) => {
            activeTurnIdRef.current = turnId;
            setActiveTurnId(turnId);
          },
          onStatus: (label) => {
            useStore.getState().setProvisionalStatus(label);
          },
          onToken: (token) => {
            useStore.getState().appendProvisionalToken(token);
          },
          onDone: ({ didLogMeal, didMutateMeal, loggedMeal, dailySummary, dailyTargets }) => {
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
            if (didLogMeal || didMutateMeal) {
              void refreshTodayMeals();
            }
            commitProvisionalBubble({ didLogMeal: didLogMeal || didMutateMeal, dailySummary, loggedMeal });
            setSending(false);
            clearActiveStreamAfterTerminal();
          },
          onStopped: ({ didLogMeal, didMutateMeal, loggedMeal, dailySummary, dailyTargets }) => {
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
            if (didLogMeal || didMutateMeal) {
              void refreshTodayMeals();
            }
            commitStoppedProvisionalBubble({
              didLogMeal: didLogMeal || didMutateMeal,
              dailySummary,
              dailyTargets,
              loggedMeal,
            });
            setSending(false);
            clearActiveStreamAfterTerminal();
          },
          onError: (errorMessage) => {
            if (useStore.getState().deviceId !== activeDeviceId) return;
            if (stoppingRef.current) {
              commitStoppedProvisionalBubble({ didLogMeal: false });
              if (opts?.draftId) {
                const currentDraft = useStore.getState().pendingHomeChatDraft;
                if (currentDraft && currentDraft.id === opts.draftId) {
                  setPendingHomeChatDraft({ ...currentDraft, status: "failed" });
                }
              }
              setSending(false);
              clearActiveStreamAfterTerminal();
              return;
            }
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
            clearActiveStreamAfterTerminal();
          },
        },
        image,
        { signal: abortController.signal },
      );
    } catch (err) {
      if (useStore.getState().deviceId !== activeDeviceId) return;
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
          clearPendingHomeChatDraft();
        }
        setProvisionalBubble(null);
        setSending(false);
        void recoverGuestSession();
        return;
      }
      if (stoppingRef.current) {
        commitStoppedProvisionalBubble({ didLogMeal: false });
        if (opts?.draftId) {
          const currentDraft = useStore.getState().pendingHomeChatDraft;
          if (currentDraft && currentDraft.id === opts.draftId) {
            setPendingHomeChatDraft({ ...currentDraft, status: "failed" });
          }
        }
        setSending(false);
        clearActiveStreamAfterTerminal();
        return;
      }
      const errorMessage = err instanceof Error && err.message
        ? err.message
        : "抱歉，發生錯誤，請再試一次。";
      useStore.getState().setProvisionalBubble({
        id: bubbleId,
        statusLabel: "",
        content: errorMessage,
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
      clearActiveStreamAfterTerminal();
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
        addPhase40IncompleteReceiptMockIfNeeded(messages, addMessage);
        const draft = useStore.getState().pendingHomeChatDraft;
        if (draft && draft.status === "staged" && !attemptedDraftIdsRef.current.has(draft.id)) {
          await sendPendingDraft(draft);
        }
      })
      .catch(async (err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          void recoverGuestSession();
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
  }, [addMessage, deviceId, setMessages, recoverGuestSession, setPendingHomeChatDraft]);

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
      disarmUploadSettleWindow();
      cleanupActiveStream();
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
    <div className="screen-shell sp-chat-shell">
      <header className="screen-bar sp-chat-header">
        <div className="sp-chat-header-row">
          <div className="sp-chat-header-slot">
            <button
              type="button"
              onClick={handleBackToHome}
              disabled={isChatLocked}
              className="sp-iconbtn sp-chat-back"
              aria-label="返回主頁"
            >
              <SportChevronLeftIcon size={18} stroke={2} />
            </button>
          </div>
          <div className="sp-chat-heading">
            <h2 className="sp-chat-title">對話</h2>
            <div className="sp-chat-meta" aria-label={`${consumedCalories}/${targetCalories} kcal，${todayMealCountSummary}`}>
              <span className="sp-chat-metric">{consumedCalories}/{targetCalories} kcal</span>
              <span className="sp-chat-separator" aria-hidden="true" />
              <span className="sp-chat-metric sp-chat-metric-meals">{todayMealCountCompact}</span>
            </div>
          </div>
          <div className="sp-chat-header-slot" aria-hidden="true" />
        </div>
      </header>
      {pendingHomeChatDraft?.status === "failed" && (
        <div
          className="screen-bar px-4 py-3 text-sm"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "rgba(232,160,32,0.06)",
            color: "var(--amber)",
          }}
        >
          上一筆任務送出失敗。
          <button type="button" onClick={() => sendPendingDraft(pendingHomeChatDraft)} className="ml-3 font-semibold underline">
            重試送出
          </button>
          <button type="button" onClick={clearPendingHomeChatDraft} className="ml-3 font-semibold underline">
            取消送出
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollContainerRef} className="screen-scroll-with-input sp-chat-scroll">
          <div ref={contentRef} className="sp-chat-stack">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onImageSettle={handleMessageImageSettle}
                onOpenMealEdit={(payload) => openMealEdit(payload, "chat")}
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
                onOpenMealEdit={(payload) => openMealEdit(payload, "chat")}
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
            className="sp-chat-jump"
            aria-label="回到最新訊息"
          >
            回到最新
          </button>
        )}
      </div>

      <div className="screen-bottom-bar sp-chat-composer-bar">
        <ChatInput
          onSend={handleSend}
          onBeforeSend={handleBeforeSend}
          onStop={handleStopStreaming}
          disabled={sending}
          streaming={sending}
          stopDisabled={stopping || !activeTurnId}
          stopping={stopping}
        />
      </div>
    </div>
  );
}
