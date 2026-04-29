import type { ReactNode } from "react";

export interface SketchIconProps {
  size?: number;
  className?: string;
  "aria-hidden"?: boolean;
}

function IconBase({
  children,
  size = 20,
  className,
  "aria-hidden": ariaHidden = true,
}: SketchIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden={ariaHidden}
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.8 10.8 12 4.2l8.2 6.6" />
      <path d="M6.2 9.8v9.4h4.1v-5.4h3.4v5.4h4.1V9.8" />
    </IconBase>
  );
}

export function MessageCircleIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.2 18.4 4 21l3.1-1.1a8.1 8.1 0 1 0-1.9-1.5Z" />
      <path d="M8.5 11.7h7" />
      <path d="M8.5 14.6h4.4" />
    </IconBase>
  );
}

export function CalendarDaysIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3.5v3" />
      <path d="M17 3.5v3" />
      <rect height="15" rx="2.2" width="16" x="4" y="5.5" />
      <path d="M4 9.5h16" />
      <path d="M8 13h.1" />
      <path d="M12 13h.1" />
      <path d="M16 13h.1" />
      <path d="M8 17h.1" />
      <path d="M12 17h.1" />
    </IconBase>
  );
}

export function SettingsIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z" />
      <path d="M18.1 10.1 20 8.6l-1.9-3.2-2.3.9a7 7 0 0 0-1.6-.9L13.9 3h-3.8l-.3 2.4a7 7 0 0 0-1.6.9l-2.3-.9L4 8.6l1.9 1.5a7.5 7.5 0 0 0 0 1.8L4 13.4l1.9 3.2 2.3-.9a7 7 0 0 0 1.6.9l.3 2.4h3.8l.3-2.4a7 7 0 0 0 1.6-.9l2.3.9 1.9-3.2-1.9-1.5a7.5 7.5 0 0 0 0-1.8Z" />
    </IconBase>
  );
}

export function CameraIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M8.2 6.5 9.7 4h4.6l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.2Z" />
      <circle cx="12" cy="13" r="3.4" />
    </IconBase>
  );
}

export function SendIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 4 10.5 14.5" />
      <path d="m21 4-6.3 17-4.2-6.5L4 10.3 21 4Z" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: SketchIconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 5-7 7 7 7" />
    </IconBase>
  );
}
