import { create } from "zustand";
import type {
  ActiveScreen,
  DailyTargets,
  DailySummary,
  MealEntry,
  Message,
  PendingHomeChatDraft,
  ProvisionalBubble,
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
  showSettings: boolean;
  sending: boolean;
  setActiveScreen: (screen: ActiveScreen) => void;
  setCoachAdvice: (advice: string | null) => void;
  setMeals: (meals: MealEntry[]) => void;
  removeMeal: (mealId: string) => void;
  setPendingHomeChatDraft: (draft: PendingHomeChatDraft | null) => void;
  clearPendingHomeChatDraft: () => void;
  setShowSettings: (showSettings: boolean) => void;
  setDevice: (deviceId: string, goal: string, dailyTargets: DailyTargets) => void;
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
  commitProvisionalBubble: (extra: { didLogMeal?: boolean; dailySummary?: DailySummary }) => void;
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
  showSettings: false,
  sending: false,
  provisionalBubble: null,

  setActiveScreen: (activeScreen) => set({ activeScreen }),
  setCoachAdvice: (coachAdvice) => set({ coachAdvice }),
  setMeals: (meals) => set({ meals }),
  removeMeal: (mealId) => set((state) => ({ meals: state.meals.filter((meal) => meal.id !== mealId) })),
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
    });
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
        didLogMeal: extra.didLogMeal,
      };

      return { messages: [...state.messages, finalMessage], provisionalBubble: null };
    });
    if (extra.dailySummary) {
      get().setDailySummary(extra.dailySummary);
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
      showSettings: false,
      sending: false,
      provisionalBubble: null,
    });
  },
}));
