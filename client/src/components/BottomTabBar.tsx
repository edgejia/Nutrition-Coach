import { useStore } from "../store.js";
import type { PrimaryTab } from "../types.js";
import { CalendarDaysIcon, HomeIcon, MessageCircleIcon } from "./SketchIcons.js";

const tabs: Array<{ id: PrimaryTab; label: string; Icon: typeof HomeIcon }> = [
  { id: "home", label: "首頁", Icon: HomeIcon },
  { id: "chat", label: "對話", Icon: MessageCircleIcon },
  { id: "history", label: "歷史", Icon: CalendarDaysIcon },
];

export function BottomTabBar() {
  const activeScreen = useStore((s) => s.activeScreen);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const secondaryScreen = useStore((s) => s.secondaryScreen);

  if (secondaryScreen !== null) {
    return null;
  }

  return (
    <nav
      aria-label="主要導覽"
      className="screen-bottom-bar grid grid-cols-3 gap-1 px-3 pt-2"
      style={{ background: "var(--sk-paper-warm)", borderTop: "1.25px solid var(--sk-ink)" }}
    >
      {tabs.map((tab) => {
        const isActive = activeScreen === tab.id;
        const { Icon } = tab;
        return (
          <button
            key={tab.id}
            aria-current={isActive ? "page" : undefined}
            className="relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-none text-[11px]"
            onClick={() => setActiveScreen(tab.id)}
            style={{ color: isActive ? "var(--sk-accent)" : "var(--sk-ink-faint)" }}
            type="button"
          >
            <Icon size={19} />
            <span>{tab.label}</span>
            {isActive ? (
              <i
                aria-hidden="true"
                className="absolute bottom-1 h-0.5 w-7 rounded-full"
                style={{ background: "var(--sk-accent)" }}
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
