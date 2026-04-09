import type { ChatReply, DailySummary, DailyTargets, IntakeData, IntakeResult, MealEntry, Message } from "./types.js";

function getHeaders(): Record<string, string> {
  const deviceId = localStorage.getItem("deviceId");
  return deviceId ? { "X-Device-Id": deviceId } : {};
}

export async function registerDevice(goal: string): Promise<{ deviceId: string; dailyTargets: DailyTargets }> {
  const res = await fetch("/api/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new Error("Failed to register device");
  return res.json();
}

export async function submitIntake(data: IntakeData): Promise<IntakeResult> {
  const res = await fetch("/api/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to submit intake");
  return res.json();
}

export async function updateGoals(goals: Partial<DailyTargets>): Promise<{ dailyTargets: DailyTargets }> {
  const res = await fetch("/api/device/goals", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getHeaders() },
    body: JSON.stringify(goals),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to update goals");
  return res.json();
}

export async function sendMessage(message: string, image?: File): Promise<ChatReply> {
  const form = new FormData();
  form.append("message", message);
  if (image) {
    form.append("image", image);
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: getHeaders(),
    body: form,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function loadHistory(limit = 50): Promise<{ messages: Message[] }> {
  const res = await fetch(`/api/chat/history?limit=${limit}`, { headers: getHeaders() });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history");
  return res.json();
}

export interface StreamCallbacks {
  onStatus: (label: string) => void;
  onToken: (token: string) => void;
  onDone: (data: { didLogMeal: boolean; dailySummary?: DailySummary }) => void;
  onError: (message: string) => void;
}

export async function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  image?: File,
): Promise<void> {
  const form = new FormData();
  form.append("message", message);
  if (image) {
    form.append("image", image);
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: getHeaders(),
    body: form,
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to send message");

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Missing response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      if (!eventBlock.trim()) {
        continue;
      }

      const lines = eventBlock.split("\n");
      let eventType = "message";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        }
        if (line.startsWith("data: ")) {
          data = line.slice(6).trim();
        }
      }

      if (!data) {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;

        if (eventType === "status") {
          callbacks.onStatus((parsed.label as string) ?? "");
        } else if (eventType === "chunk") {
          callbacks.onToken((parsed.token as string) ?? "");
        } else if (eventType === "done") {
          sawTerminalEvent = true;
          callbacks.onDone({
            didLogMeal: Boolean(parsed.didLogMeal),
            ...(parsed.dailySummary ? { dailySummary: parsed.dailySummary as DailySummary } : {}),
          });
        } else if (eventType === "error") {
          sawTerminalEvent = true;
          callbacks.onError((parsed.message as string) ?? "Stream error");
        }
      } catch {
        // Ignore malformed SSE payloads and continue parsing subsequent events.
      }
    }
  }

  if (!sawTerminalEvent) {
    callbacks.onError("Stream interrupted");
  }
}

export async function getMeals(): Promise<{ meals: MealEntry[] }> {
  const res = await fetch("/api/meals", { headers: getHeaders() });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load meals");
  return res.json();
}

export async function deleteMeal(mealId: string): Promise<void> {
  const res = await fetch(`/api/meals/${mealId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to delete meal");
}
