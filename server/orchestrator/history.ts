import type { ChatMessage } from "../llm/types.js";

export async function loadHistory(
  chatService: { getCompressedHistory: (deviceId: string, turns: number) => Promise<Array<{ role: string; content: string }>> },
  deviceId: string,
  turns: number
): Promise<ChatMessage[]> {
  const compressed = await chatService.getCompressedHistory(deviceId, turns);
  return compressed.map((msg) => ({
    role: msg.role as ChatMessage["role"],
    content: msg.content,
  }));
}
