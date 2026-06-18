import type { ReactNode } from "react";

export interface SportIconProps {
  size?: number;
  stroke?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

function SportIconBase({
  children,
  size = 20,
  stroke = 1.6,
  className,
  "aria-hidden": ariaHidden = true,
}: SportIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden={ariaHidden}
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={stroke}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function SportHomeIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </SportIconBase>
  );
}

export function SportChatIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </SportIconBase>
  );
}

export function SportHistoryIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <rect height="15" rx="2.5" width="17" x="3.5" y="5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="12" cy="14.5" fill="currentColor" r="1.4" stroke="none" />
    </SportIconBase>
  );
}

export function SportCameraIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M8 6.5 9.5 4h5L16 6.5h3a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3Z" />
      <circle cx="12" cy="13" r="3.4" />
    </SportIconBase>
  );
}

export function SportSendIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M4 12h14" />
      <path d="m13 6 6 6-6 6" />
    </SportIconBase>
  );
}

export function SportStopIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <rect height="18" rx="3" width="18" x="3" y="3" fill="currentColor" stroke="none" />
    </SportIconBase>
  );
}

export function SportSettingsIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </SportIconBase>
  );
}

export function SportChevronLeftIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="m15 5-7 7 7 7" />
    </SportIconBase>
  );
}

export function SportChevronRightIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="m9 5 7 7-7 7" />
    </SportIconBase>
  );
}

export function SportFlameIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M12 3s4 4 4 8a4 4 0 1 1-8 0c0-1.6.6-2.6 1.5-3.6.7.7 1.5.7 1.5 0 0-1.6-1-2.7 1-4.4Z" />
    </SportIconBase>
  );
}

export function SportBoltIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
    </SportIconBase>
  );
}

export function SportPlusIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </SportIconBase>
  );
}

export function SportEditIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M14.5 5.5 18.5 9.5" />
      <path d="M4.5 19.5 8.7 18.7 19 8.4a2.1 2.1 0 0 0-3-3L5.7 15.7 4.5 19.5Z" />
    </SportIconBase>
  );
}

export function SportCloseIcon(props: SportIconProps) {
  return (
    <SportIconBase {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </SportIconBase>
  );
}
