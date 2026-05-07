import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type SketchElementProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  className?: string;
};

type SketchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  className?: string;
  variant?: "default" | "solid" | "accent";
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function SketchBox({ children, className, ...props }: SketchElementProps) {
  return (
    <div className={cx("sk-box", className)} {...props}>
      {children}
    </div>
  );
}

export function SketchSoftBox({ children, className, ...props }: SketchElementProps) {
  return (
    <div className={cx("sk-box-soft", className)} {...props}>
      {children}
    </div>
  );
}

export function SketchDashedBox({ children, className, ...props }: SketchElementProps) {
  return (
    <div className={cx("sk-box-dashed", className)} {...props}>
      {children}
    </div>
  );
}

export function SketchPill({ children, className, ...props }: SketchElementProps) {
  return (
    <div className={cx("sk-pill", className)} {...props}>
      {children}
    </div>
  );
}

export function SketchButton({
  children,
  className,
  variant = "default",
  type = "button",
  ...props
}: SketchButtonProps) {
  return (
    <button className={cx("sk-button", className)} data-variant={variant} type={type} {...props}>
      {children}
    </button>
  );
}

export function SketchProgressBar({
  value,
  className,
  variant = "default",
}: {
  value: number;
  className?: string;
  variant?: "default" | "accent";
}) {
  return (
    <div className={cx("sk-progress", className)} data-variant={variant} role="presentation">
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function SketchRing({
  value,
  size = 116,
  stroke = 8,
  label,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
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
          stroke="var(--sk-paper-warm)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke="var(--sk-ink)"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      {label ? <span className="sk-ring-label absolute">{label}</span> : null}
    </div>
  );
}

export function SketchDivider({ className, dashed = false }: { className?: string; dashed?: boolean }) {
  return <div className={cx(dashed ? "sk-divider-dashed" : "sk-divider", className)} />;
}

export function SketchScreen({
  children,
  className,
  ...props
}: SketchElementProps) {
  return (
    <section className={cx("sk-screen", className)} {...props}>
      {children}
    </section>
  );
}

export function SecondaryHeader({
  title,
  backLabel,
  onBack,
  className,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  className?: string;
}) {
  return (
    <header className={cx("sk-screen-header", className)}>
      <button className="justify-self-start text-sm" onClick={onBack} type="button">
        {backLabel}
      </button>
      <h1 className="sk-heading text-xl">{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}
