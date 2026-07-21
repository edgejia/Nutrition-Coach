export type AnimationState = "running" | "complete";

export type HomeFrameSnapshot = {
  kcal: number;
  percent?: number | null;
  ringDashOffset?: number | null;
  macros?: Array<{
    grams: number | null;
    percent: number | null;
    barWidth: string | null;
  }>;
  animationState: AnimationState;
  observedAtMs?: number;
  animationFramesFrozen?: boolean;
};

export type FrameBinding = {
  before: HomeFrameSnapshot;
  after: HomeFrameSnapshot;
  captureDelayMs: number;
};

export type AnimationSample = {
  kcal: number;
  elapsedMs: number;
  animationState: AnimationState;
};

export type AnimationReadingEvidence = {
  caseName: string;
  expectedStartKcal: number;
  requireStartSample?: boolean;
  midKcal: number;
  terminalKcal: number;
  expectedTerminalKcal: number;
  sampleSequence?: AnimationSample[];
  midFrameBinding?: FrameBinding;
  terminalFrameBinding?: FrameBinding;
  terminalAnimationState?: AnimationState;
};

export type AnimationReadingVerdict = {
  midKcalStrictlyBetween: true;
  terminalKcalMatchesExpected: true;
  monotonicSequenceObserved: true;
  terminalCapturedAfterCompletion: true;
  frameBindingsStable: true;
  distinctInteriorSampleCount: number;
  interiorSampleSpanMs: number;
};

export function assertAnimationReadings(
  evidence: AnimationReadingEvidence,
): AnimationReadingVerdict;

export function assertFrameBinding(input: {
  caseName: string;
  kind: string;
  binding?: FrameBinding;
  expectedKcal: number;
}): { stable: true; manifestKcal: number };

export function captureFrozenFrame<TScreenshot>(input: {
  caseName: string;
  kind: string;
  freezeAndRead: () => Promise<HomeFrameSnapshot>;
  readFrozen: () => Promise<HomeFrameSnapshot>;
  capture: () => Promise<TScreenshot>;
  resume: () => Promise<boolean>;
  captureDelayMs?: number;
  wait?: (delayMs: number) => Promise<unknown>;
}): Promise<{
  screenshot: TScreenshot;
  binding: FrameBinding;
  frame: HomeFrameSnapshot;
}>;
