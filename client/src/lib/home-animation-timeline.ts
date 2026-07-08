export const HOME_TIMELINE_DURATION_MS = 500;

export interface HomeTimelineMacroEndpoint {
  grams: number;
  percent: number;
  barValue: number;
}

export interface HomeTimelineEndpoints {
  kcal: number;
  percent: number;
  ringValue: number;
  macros: HomeTimelineMacroEndpoint[];
}

export type HomeTimelineFrame = HomeTimelineEndpoints;

const EPSILON = 0.000001;

function clampUnit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampProgress(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function cubicBezierY(t: number, y1: number, y2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * y1 + 3 * inverse * t * t * y2 + t * t * t;
}

function cubicBezierX(t: number, x1: number, x2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * x1 + 3 * inverse * t * t * x2 + t * t * t;
}

export function easeShared(t: number): number {
  const progress = clampProgress(t);
  if (progress === 0 || progress === 1) return progress;

  // One curve is the sync contract: every Home nutrition surface samples this same eased progress.
  let low = 0;
  let high = 1;
  let solved = progress;
  for (let index = 0; index < 20; index += 1) {
    solved = (low + high) / 2;
    const x = cubicBezierX(solved, 0.25, 0.25);
    if (Math.abs(x - progress) < EPSILON) break;
    if (x < progress) {
      low = solved;
    } else {
      high = solved;
    }
  }

  return clampProgress(cubicBezierY(solved, 0.1, 1));
}

export function lerp(from: number, to: number, p: number): number {
  return from + (to - from) * p;
}

export function zeroEndpoints(reference: HomeTimelineEndpoints): HomeTimelineEndpoints {
  return {
    kcal: 0,
    percent: 0,
    ringValue: 0,
    macros: reference.macros.map(() => ({
      grams: 0,
      percent: 0,
      barValue: 0,
    })),
  };
}

export function frameAt(
  start: HomeTimelineEndpoints,
  end: HomeTimelineEndpoints,
  easedProgress: number,
): HomeTimelineFrame {
  const progress = clampProgress(easedProgress);
  if (progress <= 0) return start;
  if (progress >= 1) return end;

  return {
    kcal: Math.round(lerp(start.kcal, end.kcal, progress)),
    percent: Math.round(lerp(start.percent, end.percent, progress)),
    ringValue: clampUnit(lerp(start.ringValue, end.ringValue, progress)),
    macros: end.macros.map((endMacro, index) => {
      const startMacro = start.macros[index] ?? { grams: 0, percent: 0, barValue: 0 };
      return {
        grams: Math.round(lerp(startMacro.grams, endMacro.grams, progress)),
        percent: Math.round(lerp(startMacro.percent, endMacro.percent, progress)),
        barValue: clampUnit(lerp(startMacro.barValue, endMacro.barValue, progress)),
      };
    }),
  };
}
