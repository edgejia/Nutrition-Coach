import {
  easeShared,
  frameAt,
  HOME_TIMELINE_DURATION_MS,
  type HomeTimelineEndpoints,
} from "./home-animation-timeline.js";

export interface HomeAnimationFrameScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(frameId: number): void;
}

export interface HomeAnimationEffectOptions {
  start: HomeTimelineEndpoints;
  end: HomeTimelineEndpoints;
  intentToken: number;
  reducedMotion: boolean;
  scheduler: HomeAnimationFrameScheduler | null;
  onFrame: (frame: HomeTimelineEndpoints) => void;
  onRunningChange: (running: boolean) => void;
  onConsumeIntent: (intentToken: number) => void;
}

export function runHomeAnimationEffect({
  start,
  end,
  intentToken,
  reducedMotion,
  scheduler,
  onFrame,
  onRunningChange,
  onConsumeIntent,
}: HomeAnimationEffectOptions): () => void {
  let cancelled = false;
  let completed = false;
  let frameId: number | null = null;
  let startedAt: number | null = null;

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (frameId !== null && scheduler) {
      scheduler.cancel(frameId);
      frameId = null;
    }
    onRunningChange(false);
  };

  const complete = () => {
    if (cancelled || completed) return;
    completed = true;
    frameId = null;
    onFrame(end);
    onRunningChange(false);
    onConsumeIntent(intentToken);
  };

  onFrame(start);

  if (reducedMotion || scheduler === null) {
    complete();
    return cleanup;
  }

  let requestFrame: () => void = () => undefined;
  const step = (timestamp: number) => {
    if (cancelled || completed) return;
    startedAt ??= timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / HOME_TIMELINE_DURATION_MS);
    onFrame(frameAt(start, end, easeShared(progress)));
    if (progress >= 1) {
      complete();
      return;
    }
    requestFrame();
  };

  requestFrame = () => {
    if (cancelled || completed) return;
    try {
      const nextFrameId = scheduler.request(step);
      if (!Number.isFinite(nextFrameId)) {
        complete();
      } else if (completed || cancelled) {
        scheduler.cancel(nextFrameId);
      } else {
        frameId = nextFrameId;
      }
    } catch {
      complete();
    }
  };

  onRunningChange(true);
  requestFrame();

  return cleanup;
}
