import type { DailyTargets, Message } from "./types.js";

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

export async function sendMessage(message: string, image?: File): Promise<{ reply: string }> {
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
