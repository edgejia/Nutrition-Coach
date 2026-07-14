import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type SportElementProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  className?: string;
};

type SportScreenProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
  className?: string;
};

type SportIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  className?: string;
  "aria-label": string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function SportScreen({ children, className, ...props }: SportScreenProps) {
  return (
    <section className={cx("sp-screen", className)} {...props}>
      {children}
    </section>
  );
}

export function SportCard({
  children,
  className,
  variant = "default",
  ...props
}: SportElementProps & { variant?: "default" | "flat" | "glow" }) {
  return (
    <div
      className={cx(
        variant === "flat" ? "sp-card-flat" : variant === "glow" ? "sp-card-glow" : "sp-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SportChip({
  children,
  className,
  variant = "default",
  zh = false,
  ...props
}: SportElementProps & { variant?: "default" | "on" | "warn" | "good"; zh?: boolean }) {
  return (
    <div
      className={cx(
        "sp-chip",
        variant === "on" && "sp-chip-on",
        variant === "warn" && "sp-chip-warn",
        variant === "good" && "sp-chip-good",
        zh && "sp-chip-zh",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SportIconButton({
  children,
  className,
  type = "button",
  ...props
}: SportIconButtonProps) {
  return (
    <button className={cx("sp-iconbtn", className)} type={type} {...props}>
      {children}
    </button>
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SportProgressBar({
  value,
  className,
  variant = "default",
  replayKey,
  drivenExternally = false,
}: {
  value: number;
  variant?: "default" | "warn" | "amber" | "cyan";
  className?: string;
  replayKey?: number;
  drivenExternally?: boolean;
}) {
  const clamped = clampUnit(value);
  if (drivenExternally) {
    return (
      <div className={cx("sp-bar-track", className)} role="presentation">
        <i
          className={cx(
            "sp-bar-fill",
            "sp-bar-fill--driven",
            variant === "warn" && "sp-bar-fill-warn",
            variant === "amber" && "sp-bar-fill-amber",
            variant === "cyan" && "sp-bar-fill-cyan",
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    );
  }

  return (
    <SportProgressBarReplay
      value={clamped}
      className={className}
      variant={variant}
      replayKey={replayKey}
    />
  );
}

function SportProgressBarReplay({
  value,
  className,
  variant,
  replayKey,
}: {
  value: number;
  variant: "default" | "warn" | "amber" | "cyan";
  className?: string;
  replayKey?: number;
}) {
  const clamped = value;
  // Reuse the existing `.sp-bar-fill { transition: width 360ms }` so a refresh replays the fill
  // even when the target value is unchanged: when replayKey changes, drop the rendered width to a
  // reduced start on the first paint of that token, then transition back up to the clamped target.
  const previousReplayKeyRef = useRef<number | undefined>(replayKey);
  const [fillWidth, setFillWidth] = useState(clamped);

  useEffect(() => {
    const replayChanged =
      replayKey !== undefined &&
      previousReplayKeyRef.current !== undefined &&
      previousReplayKeyRef.current !== replayKey;
    previousReplayKeyRef.current = replayKey;

    if (!replayChanged || prefersReducedMotion()) {
      // No replay (or reduced motion): snap straight to the target so the bar matches the value.
      setFillWidth(clamped);
      return;
    }

    const reducedStart = Math.max(0, clamped - Math.max(0.08, clamped * 0.5));
    setFillWidth(reducedStart);
    const frame = requestAnimationFrame(() => {
      setFillWidth(clamped);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [clamped, replayKey]);

  return (
    <div className={cx("sp-bar-track", className)} role="presentation">
      <i
        className={cx(
          "sp-bar-fill",
          variant === "warn" && "sp-bar-fill-warn",
          variant === "amber" && "sp-bar-fill-amber",
          variant === "cyan" && "sp-bar-fill-cyan",
        )}
        style={{ width: `${fillWidth * 100}%` }}
      />
    </div>
  );
}

export function SportRing({
  value,
  size = 116,
  stroke = 8,
  label,
  className,
  accentTick = false,
  drivenExternally = false,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
  className?: string;
  accentTick?: boolean;
  drivenExternally?: boolean;
}) {
  const clamped = clampUnit(value);
  const center = size / 2;
  const radius = Math.max(1, center - stroke / 2);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);

  return (
    <div className={cx("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg aria-hidden="true" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke="var(--sp-surface-3)"
          strokeWidth={stroke}
        />
        <circle
          className={cx("sp-ring-progress", drivenExternally && "sp-ring-progress--driven")}
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke="var(--sp-lime)"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${center} ${center})`}
        />
        {accentTick ? <circle cx={center} cy={center - radius} fill="var(--sp-ink-3)" r={3} /> : null}
      </svg>
      {label ? <span className="absolute">{label}</span> : null}
    </div>
  );
}

export function SportReceipt({ children, className, ...props }: SportElementProps) {
  return (
    <div className={cx("sp-receipt", className)} {...props}>
      {children}
    </div>
  );
}
