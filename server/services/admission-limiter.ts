export const ADMISSION_KINDS = ["bootstrap", "provider", "decode"] as const;

export type AdmissionKind = (typeof ADMISSION_KINDS)[number];

export interface AdmissionSubject {
  readonly deviceId: string;
  readonly sessionVersion: number;
}

export interface AdmissionBudget {
  /** Maximum number of admitted operations in one window. */
  readonly maxRequests: number;
  /** Maximum number of admitted operations that may be active at once. */
  readonly maxConcurrent: number;
}

export interface AdmissionLimiterOptions {
  now?: () => number;
  windowMs?: number;
  budgets?: Partial<Record<AdmissionKind, AdmissionBudget>>;
}

export type AdmissionRejectionReason = "window" | "concurrency" | "stale_session";

export interface AdmissionRejection {
  readonly ok: false;
  readonly statusCode: 401 | 429;
  readonly reason: AdmissionRejectionReason;
  readonly retryAfterSeconds: number;
}

export interface AdmissionPermit {
  readonly kind: AdmissionKind;
  readonly subjectKey: string;
  release(): void;
}

export interface AdmissionGrant {
  readonly ok: true;
  readonly permit: AdmissionPermit;
}

export type AdmissionDecision = AdmissionGrant | AdmissionRejection;

export interface AdmissionLimiter {
  tryAcquire(kind: AdmissionKind, subject?: AdmissionSubject): AdmissionDecision;
  run<T>(kind: AdmissionKind, subject: AdmissionSubject | undefined, work: () => Promise<T>): Promise<T>;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BUDGETS: Record<AdmissionKind, AdmissionBudget> = {
  bootstrap: { maxRequests: 30, maxConcurrent: 8 },
  provider: { maxRequests: 12, maxConcurrent: 3 },
  decode: { maxRequests: 24, maxConcurrent: 2 },
};
const PRE_AUTH_SUBJECT = "pre-auth-app-budget";

interface WindowState {
  windowStartedAt: number;
  requests: number;
  active: number;
}

function validateBudget(kind: AdmissionKind, budget: AdmissionBudget) {
  if (
    !Number.isSafeInteger(budget.maxRequests)
    || budget.maxRequests < 0
    || !Number.isSafeInteger(budget.maxConcurrent)
    || budget.maxConcurrent < 0
  ) {
    throw new Error(`Invalid admission budget for ${kind}`);
  }
}

function validateSubject(subject: AdmissionSubject): AdmissionSubject {
  if (
    typeof subject.deviceId !== "string"
    || subject.deviceId.trim().length === 0
    || subject.deviceId.length > 200
    || !Number.isSafeInteger(subject.sessionVersion)
    || subject.sessionVersion < 0
  ) {
    throw new Error("Admission subject must be a stable authorized device identity");
  }
  return subject;
}

function retryAfterSeconds(now: number, state: WindowState, windowMs: number) {
  return Math.max(1, Math.ceil((state.windowStartedAt + windowMs - now) / 1000));
}

export class AdmissionRejectedError extends Error {
  readonly statusCode: 401 | 429;
  readonly reason: AdmissionRejectionReason;
  readonly retryAfterSeconds: number;

  constructor(rejection: AdmissionRejection) {
    super(rejection.statusCode === 401 ? "Invalid guest session" : "Admission limit exceeded");
    this.name = "AdmissionRejectedError";
    this.statusCode = rejection.statusCode;
    this.reason = rejection.reason;
    this.retryAfterSeconds = rejection.retryAfterSeconds;
  }
}

export function isAdmissionRejectedError(error: unknown): error is AdmissionRejectedError {
  return error instanceof AdmissionRejectedError;
}

export function createAdmissionLimiter(options: AdmissionLimiterOptions = {}): AdmissionLimiter {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new Error("Admission window must be a positive safe integer");
  }

  const budgets = { ...DEFAULT_BUDGETS, ...options.budgets };
  for (const kind of ADMISSION_KINDS) validateBudget(kind, budgets[kind]);

  const windows = new Map<string, WindowState>();
  const latestSessionVersions = new Map<string, number>();

  function subjectKey(subject?: AdmissionSubject) {
    if (!subject) return { stale: false as const, key: PRE_AUTH_SUBJECT };
    const validated = validateSubject(subject);
    const latest = latestSessionVersions.get(validated.deviceId);
    if (latest !== undefined && validated.sessionVersion < latest) {
      return { stale: true as const, key: validated.deviceId };
    }
    if (latest === undefined || validated.sessionVersion > latest) {
      latestSessionVersions.set(validated.deviceId, validated.sessionVersion);
    }
    return { stale: false as const, key: validated.deviceId };
  }

  function tryAcquire(kind: AdmissionKind, subject?: AdmissionSubject): AdmissionDecision {
    const subjectResult = subjectKey(subject);
    const currentTime = now();
    if (!Number.isFinite(currentTime)) {
      throw new Error("Admission clock must return a finite number");
    }
    if (subjectResult.stale) {
      return {
        ok: false,
        statusCode: 401,
        reason: "stale_session",
        retryAfterSeconds: 0,
      };
    }

    const key = `${kind}:${subjectResult.key}`;
    const budget = budgets[kind];
    let state = windows.get(key);
    if (!state) {
      state = {
        windowStartedAt: currentTime,
        requests: 0,
        active: 0,
      };
      windows.set(key, state);
    } else if (currentTime >= state.windowStartedAt + windowMs) {
      // Keep the same object so permits admitted in the prior window still
      // release the active count they own after the clock advances.
      state.windowStartedAt = currentTime;
      state.requests = 0;
    }

    if (state.active >= budget.maxConcurrent) {
      return {
        ok: false,
        statusCode: 429,
        reason: "concurrency",
        retryAfterSeconds: 1,
      };
    }
    if (state.requests >= budget.maxRequests) {
      return {
        ok: false,
        statusCode: 429,
        reason: "window",
        retryAfterSeconds: retryAfterSeconds(currentTime, state, windowMs),
      };
    }

    state.requests += 1;
    state.active += 1;
    let released = false;
    return {
      ok: true,
      permit: {
        kind,
        subjectKey: subjectResult.key,
        release() {
          if (released) return;
          released = true;
          state!.active = Math.max(0, state!.active - 1);
        },
      },
    };
  }

  return {
    tryAcquire,
    async run<T>(kind: AdmissionKind, subject: AdmissionSubject | undefined, work: () => Promise<T>) {
      const decision = tryAcquire(kind, subject);
      if (!decision.ok) throw new AdmissionRejectedError(decision);
      try {
        return await work();
      } finally {
        decision.permit.release();
      }
    },
  };
}
