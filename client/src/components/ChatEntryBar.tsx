import { ChatInput } from "./ChatInput.js";

export function ChatEntryBar(props: {
  onSend: (message: string, image?: File) => void;
  onBeforeSend?: (payload: { hasImage: boolean; hasText: boolean }) => void;
  disabled: boolean;
}) {
  return <ChatInput onSend={props.onSend} onBeforeSend={props.onBeforeSend} disabled={props.disabled} />;
}
