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

function readStoredJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

interface AppState {
  deviceId: string | null;
  goal: string | null;
  activeScreen: ActiveScreen;
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
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setDailySummary: (summary: DailySummary) => void;
  setDailyTargets: (targets: DailyTargets) => void;
  setSending: (sending: boolean) => void;
  provisionalBubble: ProvisionalBubble | null;
  setProvisionalBubble: (bubble: ProvisionalBubble | null) => void;
  appendProvisionalToken: (token: string) => void;
  setProvisionalStatus: (label: string) => void;
  commitProvisionalBubble: (extra: { didLogMeal?: boolean; dailySummary?: DailySummary }) => void;
  clearDevice: () => void;
}

export const useStore = create<AppState>((set) => ({
  deviceId: localStorage.getItem("deviceId"),
  goal: localStorage.getItem("goal"),
  activeScreen: localStorage.getItem("deviceId") ? "home" : "onboarding",
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
    set({ deviceId, goal, dailyTargets, activeScreen: "home", showSettings: false });
  },

  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setMessages: (messages) => set({ messages }),
  setDailySummary: (dailySummary) => set({ dailySummary }),
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
  commitProvisionalBubble: (extra) =>
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
    }),
  clearDevice: () => {
    localStorage.removeItem("deviceId");
    localStorage.removeItem("goal");
    localStorage.removeItem("dailyTargets");
    set({
      deviceId: null,
      goal: null,
      activeScreen: "onboarding",
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
