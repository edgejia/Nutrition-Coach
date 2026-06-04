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
  ProvisionalBubble,
  SecondaryScreen,
  SecondaryScreenState,
} from "./types.js";
import { formatLocalDate } from "./lib/time.js";

function readStoredJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
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
  status?: Message["status"];
  turnId?: string;
};

function redactReceiptIdentityFromMessages(messages: Message[], mealId: string): Message[] {
  return messages.map((message) => {
    if (message.loggedMeal?.mealId !== mealId) {
      return message;
    }

    const {
      mealId: _mealId,
      mealRevisionId: _mealRevisionId,
      dateKey: _dateKey,
      ...displayOnlyReceipt
    } = message.loggedMeal;
    return {
      ...message,
      loggedMeal: {
        ...displayOnlyReceipt,
        receiptStatus: "deleted",
      },
    };
  });
}

function getStoppedMessageContent(content: string) {
  const trimmedContent = content.trim();
  return trimmedContent.length > 0 ? `${trimmedContent}\n\n已停止` : "已停止，沒有產生新的回覆。";
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
  showSettings: boolean;
  secondaryScreen: SecondaryScreenState;
  sending: boolean;
  setActiveScreen: (screen: ActiveScreen) => void;
  openSecondaryScreen: (screen: Exclude<SecondaryScreen, "mealEdit">, origin?: PrimaryTab) => void;
  openDayDetail: (payload: DayDetailPayload, origin?: PrimaryTab) => void;
  openMealEdit: (payload: MealEditPayload, origin?: PrimaryTab) => void;
  closeSecondaryScreen: () => void;
  setCoachAdvice: (advice: string | null) => void;
  setMeals: (meals: MealEntry[]) => void;
  removeMeal: (mealId: string) => void;
  redactChatReceiptIdentity: (mealId: string) => void;
  recordMealMutation: (affectedDate: string) => void;
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void;
  clearPendingHomeChatDraft: () => void;
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
  showSettings: false,
  secondaryScreen: null,
  sending: false,
  provisionalBubble: null,

  setActiveScreen: (activeScreen) => set({ activeScreen }),
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
  openMealEdit: (payload, origin) =>
    set((state) => ({
      secondaryScreen: {
        screen: "mealEdit",
        origin: origin ?? (state.activeScreen === "onboarding" ? "home" : state.activeScreen),
        payload,
      },
    })),
  closeSecondaryScreen: () => set({ secondaryScreen: null }),
  setCoachAdvice: (coachAdvice) => set({ coachAdvice }),
  setMeals: (meals) => {
    if (!isAuthoritativeMealEntryArray(meals)) {
      return;
    }
    set({ meals });
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
    })),
  setPendingHomeChatDraft: (pendingHomeChatDraft) => set({ pendingHomeChatDraft }),
  clearPendingHomeChatDraft: () => set({ pendingHomeChatDraft: null }),
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
      set({ guestSessionStatus: "recovery_required" });
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

  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setMessages: (messages) => set({ messages }),
  // Guarded summary write boundary (D-10, D-11, D-13, T-09-05, T-09-06).
  // Writes only when `summary.date` equals local today. Mismatches fire the
  // registered rollover refresh handler without propagating errors to callers.
  setDailySummary: (summary) => {
    if (!isDailySummaryDto(summary)) {
      return;
    }
    const activeDate = formatLocalDate(new Date());
    if (summary.date === activeDate) {
      set({ dailySummary: summary });
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
    set({ dailyTargets });
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
        content: state.provisionalBubble.content,
        createdAt: new Date().toISOString(),
        ...(extra.status ? { status: extra.status } : {}),
        ...(extra.turnId ? { turnId: extra.turnId } : {}),
        didLogMeal: extra.didLogMeal,
        ...(extra.loggedMeal ? { loggedMeal: extra.loggedMeal } : {}),
      };

      const messages = extra.deletedMealId
        ? redactReceiptIdentityFromMessages(state.messages, extra.deletedMealId)
        : state.messages;

      return { messages: [...messages, finalMessage], provisionalBubble: null };
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
      };

      const messages = extra.deletedMealId
        ? redactReceiptIdentityFromMessages(state.messages, extra.deletedMealId)
        : state.messages;

      return { messages: [...messages, finalMessage], provisionalBubble: null };
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
      showSettings: false,
      secondaryScreen: null,
      sending: false,
      provisionalBubble: null,
    });
  },
}));
