import { create } from "zustand";
import { clearGuestSession, establishGuestSession } from "./api.js";
import {
  isAuthoritativeMealEntryArray,
  isDailySummaryDto,
  isDailyTargetsDto,
} from "./dto-guards.js";
import type {
  ActiveScreen,
  DailyTargets,
  DailySummary,
  DayDetailPayload,
  MealEditPayload,
  MealEntry,
  MealMutationNotice,
  Message,
  LoggedMealReceipt,
  PendingHomeChatDraft,
  PrimaryTab,
  ProposalActionEventMetadata,
  ProposalCardMetadata,
  ProvisionalBubble,
  SecondaryScreen,
  SecondaryScreenState,
} from "./types.js";
import {
  applyMealMutationMark,
  buildHomeNutritionSnapshot,
  deriveHomeEntryIntent,
} from "./lib/home-animation-intent.js";
import type { HomeEntryTrigger, HomeNutritionSnapshot } from "./lib/home-animation-intent.js";
import { formatLocalDate } from "./lib/time.js";

function readStoredJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function buildSummaryFromCurrentMeals(meals: MealEntry[]): DailySummary {
  return meals.reduce<DailySummary>(
    (summary, meal) => ({
      date: summary.date,
      totalCalories: summary.totalCalories + meal.calories,
      totalProtein: summary.totalProtein + meal.protein,
      totalCarbs: summary.totalCarbs + meal.carbs,
      totalFat: summary.totalFat + meal.fat,
      mealCount: summary.mealCount + 1,
    }),
    {
      date: formatLocalDate(new Date()),
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      mealCount: 0,
    },
  );
}

// Rollover refresh handler: fire-and-forget callback invoked when a stale/future-dated
// summary is rejected by the store's date guard. Stored at module scope (not in state)
// so SSE/chat callers never see it as a reactive field and tests can reset per case (D-13, D-19).
type RolloverRefreshHandler = () => void | Promise<void>;
let rolloverRefreshHandler: RolloverRefreshHandler | null = null;
type GuestSessionStatus = "unknown" | "establishing" | "ready" | "recovery_required";
type CommitProvisionalBubbleExtra = {
  didLogMeal?: boolean;
  loggedMeal?: LoggedMealReceipt;
  dailySummary?: DailySummary;
  dailyTargets?: DailyTargets;
  deletedMealId?: string;
  proposalCard?: ProposalCardMetadata;
  proposalActionEvent?: ProposalActionEventMetadata;
  status?: Message["status"];
  turnId?: string;
  replyText?: string;
};

export type HomeAnimationPendingIntent = {
  kind: "replay" | "delta";
  from: HomeNutritionSnapshot | null;
  token: number;
  origin: HomeEntryTrigger;
};

interface HomeAnimationState {
  baseline: HomeNutritionSnapshot | null;
  unseenTodayMutation: boolean;
  pendingIntent: HomeAnimationPendingIntent | null;
  homeVisibleMutationBaseline: HomeNutritionSnapshot | null;
}

function createInitialHomeAnimation(): HomeAnimationState {
  return {
    baseline: null,
    unseenTodayMutation: false,
    pendingIntent: null,
    homeVisibleMutationBaseline: null,
  };
}

function nextHomeAnimationToken(pendingIntent: HomeAnimationPendingIntent | null): number {
  return (pendingIntent?.token ?? 0) + 1;
}

function buildCurrentHomeNutritionSnapshot(input: {
  summary: DailySummary | null;
  targets: DailyTargets | null;
}): HomeNutritionSnapshot {
  return buildHomeNutritionSnapshot({
    date: formatLocalDate(new Date()),
    summary: input.summary,
    targets: input.targets,
  });
}

function commitHomeVisibleNutritionSnapshot(
  homeAnimation: HomeAnimationState,
  summary: DailySummary,
  targets: DailyTargets | null,
  options: { preserveHomeVisibleMutationBaseline?: boolean } = {},
): HomeAnimationState {
  const baseline = buildCurrentHomeNutritionSnapshot({ summary, targets });
  const pendingIntent = homeAnimation.baseline
    ? homeAnimation.pendingIntent
    : {
        kind: "replay" as const,
        from: null,
        token: nextHomeAnimationToken(homeAnimation.pendingIntent),
        origin: "cold_start" as const,
      };

  return {
    baseline,
    unseenTodayMutation: false,
    pendingIntent,
    homeVisibleMutationBaseline: options.preserveHomeVisibleMutationBaseline
      ? homeAnimation.homeVisibleMutationBaseline
      : null,
  };
}

function toHomeAnimationPendingIntent(
  intent: ReturnType<typeof deriveHomeEntryIntent>["intent"],
  token: number,
  origin: HomeEntryTrigger,
): HomeAnimationPendingIntent | null {
  if (intent.kind === "delta") {
    return { kind: "delta", from: intent.from, token, origin };
  }
  if (intent.kind === "replay") {
    return { kind: "replay", from: null, token, origin };
  }
  return null;
}

function redactReceiptIdentityFromMessages(messages: Message[], mealId: string): Message[] {
  return messages.map((message) => {
    const loggedMeal = message.loggedMeal;
    if (!loggedMeal) {
      return message;
    }

    const receiptMealId = loggedMeal.receiptMealId ?? loggedMeal.mealId;
    if (receiptMealId !== mealId) {
      return message;
    }

    const {
      mealId: _mealId,
      mealRevisionId: _mealRevisionId,
      dateKey: _dateKey,
      receiptMealId: _receiptMealId,
      ...displayOnlyReceipt
    } = loggedMeal;
    return {
      ...message,
      loggedMeal: {
        ...displayOnlyReceipt,
        receiptMealId: mealId,
        receiptStatus: "deleted",
      },
    };
  });
}

const GOAL_PROPOSAL_SUPERSEDED_COPY = "這個目標提案已被新的目標提案取代。";
const GOAL_PROPOSAL_STALE_COPY = "這個目標提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。";

function isGoalProposalCard(card: ProposalCardMetadata | undefined): card is ProposalCardMetadata {
  return card?.proposalKind === "goal" && card.proposalLane === "goal";
}

function isActiveGoalProposalCard(card: ProposalCardMetadata | undefined): card is ProposalCardMetadata {
  return isGoalProposalCard(card) && card.status === "active" && card.isActionable;
}

function isTerminalGoalProposalCard(card: ProposalCardMetadata | undefined): card is ProposalCardMetadata {
  return isGoalProposalCard(card) && (card.status === "approved" || card.status === "rejected");
}

function deactivateGoalProposalCard(
  card: ProposalCardMetadata,
  status: Extract<ProposalCardMetadata["status"], "stale" | "superseded">,
): ProposalCardMetadata {
  return {
    ...card,
    status,
    isActionable: false,
    lapseCopy: status === "superseded" ? GOAL_PROPOSAL_SUPERSEDED_COPY : GOAL_PROPOSAL_STALE_COPY,
    ...(status === "superseded" ? { supersededByKind: "goal" as const } : {}),
  };
}

function normalizeGoalProposalCards(
  messages: Message[],
  options: { deactivateActiveGoalCards?: boolean } = {},
): Message[] {
  const terminalByProposal = new Map<string, ProposalCardMetadata>();
  for (const message of messages) {
    if (isTerminalGoalProposalCard(message.proposalCard)) {
      terminalByProposal.set(message.proposalCard.proposalId, message.proposalCard);
    }
  }

  const terminalNormalized = messages.map((message) => {
    const card = message.proposalCard;
    if (!isActiveGoalProposalCard(card)) {
      return message;
    }
    const terminalCard = terminalByProposal.get(card.proposalId);
    return terminalCard ? { ...message, proposalCard: terminalCard } : message;
  });

  if (options.deactivateActiveGoalCards) {
    return terminalNormalized.map((message) => {
      const card = message.proposalCard;
      return isActiveGoalProposalCard(card)
        ? { ...message, proposalCard: deactivateGoalProposalCard(card, "stale") }
        : message;
    });
  }

  let latestActiveGoalIndex = -1;
  terminalNormalized.forEach((message, index) => {
    if (isActiveGoalProposalCard(message.proposalCard)) {
      latestActiveGoalIndex = index;
    }
  });

  return terminalNormalized.map((message, index) => {
    const card = message.proposalCard;
    return isActiveGoalProposalCard(card) && index !== latestActiveGoalIndex
      ? { ...message, proposalCard: deactivateGoalProposalCard(card, "superseded") }
      : message;
  });
}

const STOPPED_EMPTY_COPY = "已停止生成。";
const RAW_STOPPED_PLACEHOLDER = "（已停止）";

function getStoppedMessageContent(content: string) {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0 || trimmedContent === RAW_STOPPED_PLACEHOLDER) {
    return STOPPED_EMPTY_COPY;
  }
  return content;
}

interface AppState {
  deviceId: string | null;
  goal: string | null;
  activeScreen: ActiveScreen;
  guestSessionStatus: GuestSessionStatus;
  guestSessionRecoveryAttempted: boolean;
  dailyTargets: DailyTargets | null;
  messages: Message[];
  dailySummary: DailySummary | null;
  coachAdvice: string | null;
  meals: MealEntry[];
  pendingHomeChatDraft: PendingHomeChatDraft | null;
  lastMealMutation: MealMutationNotice | null;
  homeAnimation: HomeAnimationState;
  showSettings: boolean;
  secondaryScreen: SecondaryScreenState;
  sending: boolean;
  setActiveScreen: (screen: ActiveScreen) => void;
  openSecondaryScreen: (screen: Exclude<SecondaryScreen, "mealEdit">, origin?: PrimaryTab) => void;
  openDayDetail: (payload: DayDetailPayload, origin?: PrimaryTab) => void;
  openMealEdit: (
    payload: MealEditPayload,
    origin?: PrimaryTab,
    options?: { returnToDayDetail?: DayDetailPayload },
  ) => void;
  closeSecondaryScreen: () => void;
  goBack: () => boolean;
  setCoachAdvice: (advice: string | null) => void;
  setMeals: (meals: MealEntry[]) => void;
  applyManualHomeRefresh: (meals: MealEntry[]) => void;
  applyMealMutationRefresh: (meals: MealEntry[]) => void;
  removeMeal: (mealId: string) => void;
  redactChatReceiptIdentity: (mealId: string) => void;
  recordMealMutation: (affectedDate: string) => void;
  requestHomeEntryAnimation: (trigger: HomeEntryTrigger) => void;
  consumeHomeAnimationIntent: (token: number) => void;
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void;
  clearPendingHomeChatDraft: () => void;
  clearDraftLinkedAssistantArtifact: (artifactId: string) => void;
  setShowSettings: (showSettings: boolean) => void;
  setDevice: (deviceId: string, goal: string, dailyTargets: DailyTargets) => void;
  bootstrapGuestSession: () => Promise<boolean>;
  recoverGuestSession: () => Promise<boolean>;
  rebuildGuestSession: () => Promise<void>;
  setGuestSessionStatus: (status: GuestSessionStatus) => void;
  markGuestSessionRecoveryAttempted: () => void;
  resetGuestSessionRecovery: () => void;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setDailySummary: (summary: DailySummary) => void;
  setRolloverRefreshHandler: (handler: RolloverRefreshHandler | null) => void;
  setDailyTargets: (targets: DailyTargets) => void;
  setSending: (sending: boolean) => void;
  provisionalBubble: ProvisionalBubble | null;
  setProvisionalBubble: (bubble: ProvisionalBubble | null) => void;
  appendProvisionalToken: (token: string) => void;
  setProvisionalStatus: (label: string) => void;
  commitProvisionalBubble: (extra: CommitProvisionalBubbleExtra) => void;
  commitStoppedProvisionalBubble: (extra: CommitProvisionalBubbleExtra) => void;
  clearDevice: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  deviceId: localStorage.getItem("deviceId"),
  goal: localStorage.getItem("goal"),
  activeScreen: localStorage.getItem("deviceId") ? "home" : "onboarding",
  guestSessionStatus: localStorage.getItem("deviceId") ? "unknown" : "ready",
  guestSessionRecoveryAttempted: false,
  dailyTargets: readStoredJson<DailyTargets>("dailyTargets"),
  messages: [],
  dailySummary: null,
  coachAdvice: null,
  meals: [],
  pendingHomeChatDraft: null,
  lastMealMutation: null,
  homeAnimation: createInitialHomeAnimation(),
  showSettings: false,
  secondaryScreen: null,
  sending: false,
  provisionalBubble: null,

  setActiveScreen: (activeScreen) => {
    const prev = get().activeScreen;
    set({ activeScreen });
    if (prev !== "home" && activeScreen === "home") {
      get().requestHomeEntryAnimation(prev === "history" ? "nav_from_history" : "nav_from_chat");
    }
  },
  openSecondaryScreen: (screen, origin) =>
    set((state) => ({
      secondaryScreen: {
        screen,
        origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
      },
    })),
  openDayDetail: (payload, origin) =>
    set((state) => ({
      secondaryScreen: {
        screen: "dayDetail",
        origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
        payload,
      },
    })),
  openMealEdit: (payload, origin, options) =>
    set((state) => ({
      secondaryScreen: {
        screen: "mealEdit",
        origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
        payload,
        ...(options?.returnToDayDetail ? { returnToDayDetail: options.returnToDayDetail } : {}),
      },
    })),
  closeSecondaryScreen: () =>
    set((state) => {
      const current = state.secondaryScreen;
      if (current?.screen === "mealEdit" && current.returnToDayDetail) {
        return {
          secondaryScreen: {
            screen: "dayDetail",
            origin: current.origin,
            payload: current.returnToDayDetail,
          },
        };
      }
      return { secondaryScreen: null };
    }),
  goBack: () => {
    const state = get();
    if (state.secondaryScreen) {
      state.closeSecondaryScreen();
      return true;
    }
    if (state.activeScreen === "chat" || state.activeScreen === "history") {
      const prev = state.activeScreen;
      set({ activeScreen: "home" });
      get().requestHomeEntryAnimation(prev === "history" ? "nav_from_history" : "nav_from_chat");
      return true;
    }
    return false;
  },
  setCoachAdvice: (coachAdvice) => set({ coachAdvice }),
  setMeals: (meals) => {
    if (!isAuthoritativeMealEntryArray(meals)) {
      return;
    }
    set((state) => {
      const dailySummary = buildSummaryFromCurrentMeals(meals);
      return {
        meals,
        dailySummary,
        ...(state.activeScreen === "home"
          ? {
              homeAnimation: commitHomeVisibleNutritionSnapshot(
                state.homeAnimation,
                dailySummary,
                state.dailyTargets,
              ),
            }
          : {}),
      };
    });
  },
  applyManualHomeRefresh: (meals) => {
    if (!isAuthoritativeMealEntryArray(meals)) {
      return;
    }
    set((state) => {
      const today = formatLocalDate(new Date());
      const dailySummary = buildSummaryFromCurrentMeals(meals);
      const current = buildHomeNutritionSnapshot({
        date: today,
        summary: dailySummary,
        targets: state.dailyTargets,
      });
      const { intent } = deriveHomeEntryIntent({
        trigger: "manual_refresh",
        today,
        baseline: state.homeAnimation.baseline,
        current,
        unseenTodayMutation: state.homeAnimation.unseenTodayMutation,
      });
      const token = nextHomeAnimationToken(state.homeAnimation.pendingIntent);
      const pendingIntent = toHomeAnimationPendingIntent(intent, token, "manual_refresh");

      return {
        meals,
        dailySummary,
        homeAnimation: {
          baseline: current,
          unseenTodayMutation: false,
          pendingIntent,
          homeVisibleMutationBaseline: null,
        },
      };
    });
  },
  applyMealMutationRefresh: (meals) => {
    if (!isAuthoritativeMealEntryArray(meals)) {
      return;
    }
    set((state) => {
      const dailySummary = buildSummaryFromCurrentMeals(meals);
      if (state.activeScreen !== "home") {
        return {
          meals,
          dailySummary,
        };
      }

      const today = formatLocalDate(new Date());
      const current = buildHomeNutritionSnapshot({
        date: today,
        summary: dailySummary,
        targets: state.dailyTargets,
      });
      const baseline = state.homeAnimation.homeVisibleMutationBaseline ?? state.homeAnimation.baseline;
      const { intent } = deriveHomeEntryIntent({
        trigger: "meal_mutation",
        today,
        baseline,
        current,
        unseenTodayMutation: state.homeAnimation.unseenTodayMutation,
      });
      const token = nextHomeAnimationToken(state.homeAnimation.pendingIntent);
      const pendingIntent = toHomeAnimationPendingIntent(intent, token, "meal_mutation");

      return {
        meals,
        dailySummary,
        homeAnimation: {
          baseline: current,
          unseenTodayMutation: false,
          pendingIntent,
          homeVisibleMutationBaseline: null,
        },
      };
    });
  },
  removeMeal: (mealId) => set((state) => ({ meals: state.meals.filter((meal) => meal.id !== mealId) })),
  redactChatReceiptIdentity: (mealId) =>
    set((state) => ({
      messages: redactReceiptIdentityFromMessages(state.messages, mealId),
    })),
  recordMealMutation: (affectedDate) =>
    set((state) => ({
      lastMealMutation: {
        affectedDate,
        nonce: (state.lastMealMutation?.nonce ?? 0) + 1,
      },
      homeAnimation: {
        ...state.homeAnimation,
        homeVisibleMutationBaseline:
          affectedDate === formatLocalDate(new Date()) && state.activeScreen === "home"
            ? state.homeAnimation.homeVisibleMutationBaseline ?? state.homeAnimation.baseline
            : state.homeAnimation.homeVisibleMutationBaseline,
        unseenTodayMutation: applyMealMutationMark({
          affectedDate,
          today: formatLocalDate(new Date()),
          homeVisible: state.activeScreen === "home",
          unseenTodayMutation: state.homeAnimation.unseenTodayMutation,
        }),
      },
    })),
  requestHomeEntryAnimation: (trigger) =>
    set((state) => {
      const current = buildCurrentHomeNutritionSnapshot({
        summary: state.dailySummary,
        targets: state.dailyTargets,
      });
      const { intent, nextBaseline } = deriveHomeEntryIntent({
        trigger,
        today: formatLocalDate(new Date()),
        baseline: state.homeAnimation.baseline,
        current,
        unseenTodayMutation: state.homeAnimation.unseenTodayMutation,
      });
      const token = nextHomeAnimationToken(state.homeAnimation.pendingIntent);
      const pendingIntent = toHomeAnimationPendingIntent(intent, token, trigger);

      return {
        homeAnimation: {
          baseline: nextBaseline,
          unseenTodayMutation: false,
          pendingIntent,
          homeVisibleMutationBaseline: null,
        },
      };
    }),
  consumeHomeAnimationIntent: (token) =>
    set((state) => {
      if (state.homeAnimation.pendingIntent?.token !== token) {
        return {};
      }
      return {
        homeAnimation: {
          ...state.homeAnimation,
          pendingIntent: null,
        },
      };
    }),
  setPendingHomeChatDraft: (pendingHomeChatDraft) => set({ pendingHomeChatDraft }),
  clearPendingHomeChatDraft: () => set({ pendingHomeChatDraft: null }),
  clearDraftLinkedAssistantArtifact: (artifactId) =>
    set((state) => ({
      messages: state.messages.filter((message) => !(message.role === "assistant" && message.id === artifactId)),
      provisionalBubble: state.provisionalBubble?.id === artifactId ? null : state.provisionalBubble,
    })),
  setShowSettings: (showSettings) => set({ showSettings }),

  setDevice: (deviceId, goal, dailyTargets) => {
    localStorage.setItem("deviceId", deviceId);
    localStorage.setItem("goal", goal);
    localStorage.setItem("dailyTargets", JSON.stringify(dailyTargets));
    set({
      deviceId,
      goal,
      activeScreen: "home",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets,
      showSettings: false,
      secondaryScreen: null,
    });
  },
  bootstrapGuestSession: async () => {
    const currentState = get();
    if (!currentState.deviceId || currentState.guestSessionStatus === "establishing") {
      return false;
    }

    set({ guestSessionStatus: "establishing" });

    try {
      const session = await establishGuestSession({ legacyDeviceId: currentState.deviceId });
      localStorage.setItem("deviceId", session.deviceId);
      localStorage.setItem("goal", session.goal);
      localStorage.setItem("dailyTargets", JSON.stringify(session.dailyTargets));
      set((state) => ({
        deviceId: session.deviceId,
        goal: session.goal,
        dailyTargets: session.dailyTargets,
        guestSessionStatus: "ready",
        guestSessionRecoveryAttempted: state.guestSessionRecoveryAttempted,
      }));
      return true;
    } catch {
      localStorage.removeItem("deviceId");
      set({ deviceId: null, guestSessionStatus: "recovery_required" });
      return false;
    }
  },
  recoverGuestSession: async () => {
    const currentState = get();
    if (!currentState.deviceId) {
      return false;
    }
    if (currentState.guestSessionStatus === "establishing") {
      return false;
    }
    if (currentState.guestSessionRecoveryAttempted) {
      set({ guestSessionStatus: "recovery_required" });
      return false;
    }

    set({ guestSessionStatus: "establishing", guestSessionRecoveryAttempted: true });

    try {
      const session = await establishGuestSession();
      localStorage.setItem("deviceId", session.deviceId);
      localStorage.setItem("goal", session.goal);
      localStorage.setItem("dailyTargets", JSON.stringify(session.dailyTargets));
      set((state) => ({
        deviceId: session.deviceId,
        goal: session.goal,
        dailyTargets: session.dailyTargets,
        guestSessionStatus: "ready",
        guestSessionRecoveryAttempted: state.guestSessionRecoveryAttempted,
      }));
      return true;
    } catch {
      set({ guestSessionStatus: "recovery_required" });
      return false;
    }
  },
  rebuildGuestSession: async () => {
    try {
      await clearGuestSession();
    } catch {
      // The local reset remains authoritative for the rebuild CTA even if the
      // cookie-clear request fails.
    }
    get().clearDevice();
  },
  setGuestSessionStatus: (guestSessionStatus) => set({ guestSessionStatus }),
  markGuestSessionRecoveryAttempted: () => set({ guestSessionRecoveryAttempted: true }),
  resetGuestSessionRecovery: () => set({ guestSessionRecoveryAttempted: false }),

  addMessage: (message) => set((s) => ({ messages: normalizeGoalProposalCards([...s.messages, message]) })),
  setMessages: (messages) => set({ messages: normalizeGoalProposalCards(messages) }),
  // Guarded summary write boundary (D-10, D-11, D-13, T-09-05, T-09-06).
  // Writes only when `summary.date` equals local today. Mismatches fire the
  // registered rollover refresh handler without propagating errors to callers.
  setDailySummary: (summary) => {
    if (!isDailySummaryDto(summary)) {
      return;
    }
    const activeDate = formatLocalDate(new Date());
    if (summary.date === activeDate) {
      set((state) => ({
        dailySummary: summary,
        ...(state.activeScreen === "home"
          ? {
              homeAnimation: commitHomeVisibleNutritionSnapshot(
                state.homeAnimation,
                summary,
                state.dailyTargets,
                { preserveHomeVisibleMutationBaseline: true },
              ),
            }
          : {}),
      }));
      return;
    }
    // Fire-and-forget: never throw into SSE/chat event handlers (T-09-06).
    try {
      const result = rolloverRefreshHandler?.();
      // If handler returned a promise, swallow rejections so async failures
      // cannot break chat/SSE event handling.
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Intentionally suppressed — handler errors must not reach the caller.
    }
  },
  setRolloverRefreshHandler: (handler) => {
    rolloverRefreshHandler = handler;
  },
  setDailyTargets: (dailyTargets) => {
    if (!isDailyTargetsDto(dailyTargets)) {
      return;
    }
    localStorage.setItem("dailyTargets", JSON.stringify(dailyTargets));
    set((state) => ({
      dailyTargets,
      messages: normalizeGoalProposalCards(state.messages, { deactivateActiveGoalCards: true }),
    }));
  },
  setSending: (sending) => set({ sending }),
  setProvisionalBubble: (provisionalBubble) => set({ provisionalBubble }),
  appendProvisionalToken: (token) =>
    set((state) => {
      if (!state.provisionalBubble) {
        return {};
      }

      return {
        provisionalBubble: {
          ...state.provisionalBubble,
          statusLabel: "",
          content: state.provisionalBubble.content + token,
        },
      };
    }),
  setProvisionalStatus: (label) =>
    set((state) => {
      if (!state.provisionalBubble) {
        return {};
      }

      return {
        provisionalBubble: {
          ...state.provisionalBubble,
          statusLabel: label,
        },
      };
    }),
  // Atomically finalize assistant message and clear provisional bubble, then
  // route any provided dailySummary through the guarded setDailySummary (D-12).
  commitProvisionalBubble: (extra) => {
    set((state) => {
      if (!state.provisionalBubble) {
        return {};
      }

      const finalMessage: Message = {
        id: state.provisionalBubble.id,
        role: "assistant",
        content: extra.replyText ?? state.provisionalBubble.content,
        createdAt: new Date().toISOString(),
        ...(extra.status ? { status: extra.status } : {}),
        ...(extra.turnId ? { turnId: extra.turnId } : {}),
        didLogMeal: extra.didLogMeal,
        ...(extra.loggedMeal ? { loggedMeal: extra.loggedMeal } : {}),
        ...(extra.proposalCard ? { proposalCard: extra.proposalCard } : {}),
        ...(extra.proposalActionEvent ? { proposalActionEvent: extra.proposalActionEvent } : {}),
      };

      const messages = extra.deletedMealId
        ? redactReceiptIdentityFromMessages(state.messages, extra.deletedMealId)
        : state.messages;

      return {
        messages: normalizeGoalProposalCards([...messages, finalMessage], {
          deactivateActiveGoalCards: Boolean(extra.dailyTargets && !isActiveGoalProposalCard(extra.proposalCard)),
        }),
        provisionalBubble: null,
      };
    });
    if (extra.dailySummary) {
      get().setDailySummary(extra.dailySummary);
    }
    if (extra.dailyTargets) {
      get().setDailyTargets(extra.dailyTargets);
    }
  },
  commitStoppedProvisionalBubble: (extra) => {
    set((state) => {
      if (!state.provisionalBubble) {
        return {};
      }

      const finalMessage: Message = {
        id: state.provisionalBubble.id,
        role: "assistant",
        content: getStoppedMessageContent(state.provisionalBubble.content),
        createdAt: new Date().toISOString(),
        status: "stopped",
        ...(extra.turnId ? { turnId: extra.turnId } : {}),
        didLogMeal: extra.didLogMeal ?? Boolean(extra.loggedMeal),
        ...(extra.loggedMeal ? { loggedMeal: extra.loggedMeal } : {}),
        ...(extra.proposalCard ? { proposalCard: extra.proposalCard } : {}),
        ...(extra.proposalActionEvent ? { proposalActionEvent: extra.proposalActionEvent } : {}),
      };

      const messages = extra.deletedMealId
        ? redactReceiptIdentityFromMessages(state.messages, extra.deletedMealId)
        : state.messages;

      return {
        messages: normalizeGoalProposalCards([...messages, finalMessage], {
          deactivateActiveGoalCards: Boolean(extra.dailyTargets && !isActiveGoalProposalCard(extra.proposalCard)),
        }),
        provisionalBubble: null,
      };
    });
    if (extra.dailySummary) {
      get().setDailySummary(extra.dailySummary);
    }
    if (extra.dailyTargets) {
      get().setDailyTargets(extra.dailyTargets);
    }
  },
  clearDevice: () => {
    localStorage.removeItem("deviceId");
    localStorage.removeItem("goal");
    localStorage.removeItem("dailyTargets");
    set({
      deviceId: null,
      goal: null,
      activeScreen: "onboarding",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets: null,
      messages: [],
      dailySummary: null,
      coachAdvice: null,
      meals: [],
      pendingHomeChatDraft: null,
      lastMealMutation: null,
      homeAnimation: createInitialHomeAnimation(),
      showSettings: false,
      secondaryScreen: null,
      sending: false,
      provisionalBubble: null,
    });
  },
}));
