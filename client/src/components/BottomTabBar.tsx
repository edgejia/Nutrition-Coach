import { useStore } from "../store.js";
import type { PrimaryTab } from "../types.js";
import { SportChatIcon, SportHistoryIcon, SportHomeIcon } from "./SportIcons.js";

const tabs: Array<{
  id: PrimaryTab;
  ariaLabel: string;
  Icon: typeof SportHomeIcon;
  kind: "side" | "action";
}> = [
  { id: "home", ariaLabel: "首頁", Icon: SportHomeIcon, kind: "side" },
  { id: "chat", ariaLabel: "記錄餐點", Icon: SportChatIcon, kind: "action" },
  { id: "history", ariaLabel: "歷史", Icon: SportHistoryIcon, kind: "side" },
];

export function BottomTabBar() {
  const activeScreen = useStore((s) => s.activeScreen);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const secondaryScreen = useStore((s) => s.secondaryScreen);

  if (secondaryScreen !== null) {
    return null;
  }

  return (
    <nav aria-label="主要導覽" className="screen-bottom-bar sp-tabbar">
      {tabs.map((tab) => {
        const isActive = activeScreen === tab.id;
        const { Icon } = tab;
        const handleClick = tab.id === "chat" ? () => setActiveScreen("chat") : () => setActiveScreen(tab.id);
        return (
          <button
            key={tab.id}
            aria-label={tab.ariaLabel}
            aria-current={isActive ? "page" : undefined}
            className={tab.kind === "action" ? "sp-tab sp-tab-action" : "sp-tab"}
            data-active={isActive}
            onClick={handleClick}
            type="button"
          >
            <Icon size={tab.kind === "action" ? 26 : 21} stroke={tab.kind === "action" ? 1.9 : 1.7} />
            <i aria-hidden="true" className="sp-tab-indicator" />
          </button>
        );
      })}
    </nav>
  );
}
