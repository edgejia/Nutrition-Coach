import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  assertAnimationReadings,
  captureFrozenFrame,
} from "../harness/scenarios/110-home-nutrition-animation-visual.mjs";

function boundFrame(kcal: number, animationState: "running" | "complete") {
  return {
    kcal,
    percent: Math.round(kcal / 10),
    ringDashOffset: 100 - kcal / 20,
    macros: [{ grams: Math.round(kcal / 30), percent: 20, barWidth: "20%" }],
    animationState,
    observedAtMs: 100,
    animationFramesFrozen: true,
  };
}

function stableBinding(kcal: number, animationState: "running" | "complete") {
  const frame = boundFrame(kcal, animationState);
  return { before: frame, after: { ...frame, observedAtMs: 180 }, captureDelayMs: 80 };
}

function unfrozenBinding(kcal: number, animationState: "running" | "complete") {
  const frame = { ...boundFrame(kcal, animationState), animationFramesFrozen: false };
  return { before: frame, after: { ...frame, observedAtMs: 180 }, captureDelayMs: 80 };
}

function validAnimationEvidence(
  caseName: string,
  expectedStartKcal: number,
  expectedTerminalKcal: number,
) {
  const delta = expectedTerminalKcal - expectedStartKcal;
  const sample = (progress: number) => Math.round(expectedStartKcal + delta * progress);
  const midKcal = sample(0.5);
  return {
    caseName,
    expectedStartKcal,
    midKcal,
    terminalKcal: expectedTerminalKcal,
    expectedTerminalKcal,
    sampleSequence: [
      { kcal: expectedStartKcal, elapsedMs: 0, animationState: "running" as const },
      { kcal: sample(0.25), elapsedMs: 40, animationState: "running" as const },
      { kcal: midKcal, elapsedMs: 80, animationState: "running" as const },
      { kcal: sample(0.75), elapsedMs: 120, animationState: "running" as const },
      { kcal: expectedTerminalKcal, elapsedMs: 500, animationState: "complete" as const },
    ],
    midFrameBinding: stableBinding(midKcal, "running"),
    terminalFrameBinding: stableBinding(expectedTerminalKcal, "complete"),
    terminalAnimationState: "complete" as const,
  };
}

describe("Scenario 110 interpolation evidence", () => {
  it("accepts replay and ascending/descending delta midpoints with exact terminal values", () => {
    assert.deepEqual(
      assertAnimationReadings(validAnimationEvidence("manual-replay-unchanged", 0, 1030)),
      {
        midKcalStrictlyBetween: true,
        terminalKcalMatchesExpected: true,
        monotonicSequenceObserved: true,
        terminalCapturedAfterCompletion: true,
        frameBindingsStable: true,
        distinctInteriorSampleCount: 3,
        interiorSampleSpanMs: 80,
      },
    );
    assert.doesNotThrow(() =>
      assertAnimationReadings(validAnimationEvidence("delta-up", 1030, 1290)),
    );
    assert.doesNotThrow(() =>
      assertAnimationReadings(validAnimationEvidence("delta-down", 1290, 410)),
    );
  });

  it("requires the semantic start for manual and delta replays while allowing cold-start sampling to begin later", () => {
    const evidence = validAnimationEvidence("manual-replay-unchanged", 0, 1030);
    evidence.sampleSequence = evidence.sampleSequence.slice(1);
    assert.throws(
      () => assertAnimationReadings({ ...evidence, requireStartSample: true }),
      /semantic start kcal 0 was not observed before interpolation/,
    );

    assert.doesNotThrow(() =>
      assertAnimationReadings({
        ...evidence,
        caseName: "cold-start-replay",
        requireStartSample: false,
      }),
    );
  });

  it("rejects a midpoint that never left the semantic animation start", () => {
    assert.throws(
      () =>
        assertAnimationReadings({
          caseName: "cold-start-replay",
          expectedStartKcal: 0,
          midKcal: 0,
          terminalKcal: 1030,
          expectedTerminalKcal: 1030,
        }),
      /midpoint kcal 0 was not strictly between semantic start 0 and terminal 1030/,
    );
  });

  it("rejects the prior false-pass where replay jumped directly to terminal", () => {
    assert.throws(
      () =>
        assertAnimationReadings({
          caseName: "manual-replay-unchanged",
          expectedStartKcal: 0,
          midKcal: 1030,
          terminalKcal: 1030,
          expectedTerminalKcal: 1030,
        }),
      /midpoint kcal 1030 was not strictly between semantic start 0 and terminal 1030/,
    );
  });

  it("rejects a terminal reading that does not match the mocked meal total", () => {
    assert.throws(
      () =>
        assertAnimationReadings({
          caseName: "delta-up",
          expectedStartKcal: 1030,
          midKcal: 1200,
          terminalKcal: 1289,
          expectedTerminalKcal: 1290,
        }),
      /terminal kcal 1289 did not match expected 1290/,
    );
  });

  it("rejects the old single in-range sample as insufficient timing proof", () => {
    const evidence = {
      ...validAnimationEvidence("manual-replay-unchanged", 0, 1030),
      sampleSequence: [
        { kcal: 0, elapsedMs: 0, animationState: "running" as const },
        { kcal: 730, elapsedMs: 16, animationState: "running" as const },
        { kcal: 1030, elapsedMs: 32, animationState: "complete" as const },
      ],
    };

    assert.throws(
      () => assertAnimationReadings(evidence),
      /at least 3 distinct interior samples/,
    );
  });

  it("rejects a sequence that reverses direction before reaching terminal", () => {
    const evidence = {
      ...validAnimationEvidence("delta-up", 1030, 1290),
      midKcal: 1100,
      midFrameBinding: stableBinding(1100, "running"),
      sampleSequence: [
        { kcal: 1030, elapsedMs: 0, animationState: "running" as const },
        { kcal: 1100, elapsedMs: 32, animationState: "running" as const },
        { kcal: 1090, elapsedMs: 64, animationState: "running" as const },
        { kcal: 1200, elapsedMs: 96, animationState: "running" as const },
        { kcal: 1290, elapsedMs: 500, animationState: "complete" as const },
      ],
    };

    assert.throws(
      () => assertAnimationReadings(evidence),
      /must be monotonically non-decreasing/,
    );
  });

  it("rejects a delayed capture whose frozen reread no longer matches the sampled midpoint", () => {
    const evidence = {
      ...validAnimationEvidence("cold-start-replay", 0, 1030),
      midKcal: 305,
      midFrameBinding: {
        before: boundFrame(189, "running"),
        after: boundFrame(305, "running"),
        captureDelayMs: 80,
      },
    };

    assert.throws(
      () => assertAnimationReadings(evidence),
      /mid frame changed during capture delay/,
    );
  });

  it("rejects rounded terminal kcal while the animation is still running", () => {
    const evidence = {
      ...validAnimationEvidence("delta-down", 1290, 410),
      terminalAnimationState: "running" as const,
    };

    assert.throws(
      () => assertAnimationReadings(evidence),
      /terminal frame was captured before animation completion/,
    );
  });

  it("simulates capture delay, rejects a moving frame, and always resumes rAF", async () => {
    let currentFrame = boundFrame(189, "running");
    let resumed = false;

    await assert.rejects(
      captureFrozenFrame({
        caseName: "cold-start-replay",
        kind: "mid",
        freezeAndRead: async () => currentFrame,
        readFrozen: async () => currentFrame,
        capture: async () => ({ bytes: 20000, nonblank: true }),
        resume: async () => {
          resumed = true;
          return true;
        },
        captureDelayMs: 80,
        wait: async () => {
          currentFrame = boundFrame(305, "running");
        },
      }),
      /mid frame changed during capture delay/,
    );
    assert.equal(resumed, true);
  });

  it("keeps a delayed frozen capture stable and records the post-capture reread", async () => {
    const frame = boundFrame(305, "running");
    let resumed = false;
    const result = await captureFrozenFrame({
      caseName: "cold-start-replay",
      kind: "mid",
      freezeAndRead: async () => frame,
      readFrozen: async () => ({ ...frame, observedAtMs: 180 }),
      capture: async () => ({ bytes: 20000, nonblank: true }),
      resume: async () => {
        resumed = true;
        return true;
      },
      captureDelayMs: 80,
      wait: async () => undefined,
    });

    assert.equal(result.frame.kcal, 305);
    assert.equal(result.binding.after.kcal, 305);
    assert.equal(resumed, true);
  });

  it("rejects a stable DOM frame that was not captured while the rAF gate was frozen", () => {
    assert.throws(
      () =>
        assertAnimationReadings({
          ...validAnimationEvidence("manual-replay-unchanged", 0, 1030),
          midFrameBinding: unfrozenBinding(515, "running"),
        }),
      /mid frame was not captured while frozen/,
    );
  });

  it("rejects a frozen capture when the rAF gate fails to resume", async () => {
    const frame = boundFrame(305, "running");
    await assert.rejects(
      captureFrozenFrame({
        caseName: "manual-replay-unchanged",
        kind: "mid",
        freezeAndRead: async () => frame,
        readFrozen: async () => frame,
        capture: async () => ({ bytes: 20000, nonblank: true }),
        resume: async () => false,
        captureDelayMs: 80,
        wait: async () => undefined,
      }),
      /mid frame did not resume/,
    );
  });

  it("builds a fresh scenario-owned bundle instead of using dist/client", async () => {
    const scenarioSource = await readFile(
      new URL("../harness/scenarios/110-home-nutrition-animation-visual.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(scenarioSource, /const DIST_ROOT = "dist\/client"/);
    assert.match(scenarioSource, /browser-bundle/);
    assert.match(scenarioSource, /--emptyOutDir/);
    assert.match(scenarioSource, /animationFramesFrozen !== true/);
    assert.match(scenarioSource, /resumed !== true/);
    assert.doesNotMatch(scenarioSource, /releaseAttestation|assertHarnessBundleBinding|captureWorktreeFingerprint/);
  });
});
