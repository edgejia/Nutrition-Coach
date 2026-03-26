import { create } from "zustand";
import type { DailyTargets, DailySummary, Message } from "./types.js";

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
  dailyTargets: DailyTargets | null;
  messages: Message[];
  dailySummary: DailySummary | null;
  sending: boolean;
  setDevice: (deviceId: string, goal: string, dailyTargets: DailyTargets) => void;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setDailySummary: (summary: DailySummary) => void;
  setDailyTargets: (targets: DailyTargets) => void;
  setSending: (sending: boolean) => void;
  clearDevice: () => void;
}

export const useStore = create<AppState>((set) => ({
  deviceId: localStorage.getItem("deviceId"),
  goal: localStorage.getItem("goal"),
  dailyTargets: readStoredJson<DailyTargets>("dailyTargets"),
  messages: [],
  dailySummary: null,
  sending: false,

  setDevice: (deviceId, goal, dailyTargets) => {
    localStorage.setItem("deviceId", deviceId);
    localStorage.setItem("goal", goal);
    localStorage.setItem("dailyTargets", JSON.stringify(dailyTargets));
    set({ deviceId, goal, dailyTargets });
  },

  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setMessages: (messages) => set({ messages }),
  setDailySummary: (dailySummary) => set({ dailySummary }),
  setDailyTargets: (dailyTargets) => {
    localStorage.setItem("dailyTargets", JSON.stringify(dailyTargets));
    set({ dailyTargets });
  },
  setSending: (sending) => set({ sending }),
  clearDevice: () => {
    localStorage.removeItem("deviceId");
    localStorage.removeItem("goal");
    localStorage.removeItem("dailyTargets");
    set({ deviceId: null, goal: null, dailyTargets: null, messages: [], dailySummary: null, sending: false });
  },
}));
