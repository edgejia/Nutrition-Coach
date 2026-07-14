import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  HOME_TIMELINE_DURATION_MS,
  easeShared,
  frameAt,
  lerp,
  zeroEndpoints,
} = await import("../../client/src/lib/home-animation-timeline.js");

const end = {
  kcal: 1500,
  percent: 75,
  ringValue: 0.75,
  macros: [
    { grams: 120, percent: 80, barValue: 0.8 },
    { grams: 180, percent: 60, barValue: 0.6 },
    { grams: 55, percent: 70, barValue: 0.7 },
  ],
};

const start = {
  kcal: 0,
  percent: 0,
  ringValue: 0,
  macros: [
    { grams: 0, percent: 0, barValue: 0 },
    { grams: 0, percent: 0, barValue: 0 },
    { grams: 0, percent: 0, barValue: 0 },
  ],
};

describe("home animation timeline", () => {
  it("returns start and end endpoints exactly", () => {
    assert.deepEqual(frameAt(start, end, 0), start);
    assert.deepEqual(frameAt(start, end, 1), end);
  });

  it("rounds integer surfaces and clamps fractional surfaces", () => {
    const frame = frameAt(
      {
        kcal: 10,
        percent: 10,
        ringValue: 0.1,
        macros: [{ grams: 10, percent: 10, barValue: 0.1 }],
      },
      {
        kcal: 13,
        percent: 15,
        ringValue: 1.4,
        macros: [{ grams: 13, percent: 15, barValue: -0.4 }],
      },
      0.5,
    );

    assert.equal(Number.isInteger(frame.kcal), true);
    assert.equal(Number.isInteger(frame.percent), true);
    assert.equal(Number.isInteger(frame.macros[0]?.grams), true);
    assert.equal(Number.isInteger(frame.macros[0]?.percent), true);
    assert.equal(frame.kcal, 12);
    assert.equal(frame.percent, 13);
    assert.equal(frame.macros[0]?.grams, 12);
    assert.equal(frame.macros[0]?.percent, 13);
    assert.ok(frame.ringValue >= 0 && frame.ringValue <= 1);
    assert.ok((frame.macros[0]?.barValue ?? -1) >= 0 && (frame.macros[0]?.barValue ?? 2) <= 1);
  });

  it("derives increasing deltas from ascending progress samples", () => {
    const increasingStart = { ...end, kcal: 800, percent: 40, ringValue: 0.4 };
    const increasingEnd = { ...end, kcal: 1500, percent: 75, ringValue: 0.75 };
    const samples = [0.1, 0.3, 0.6, 0.9].map((progress) => frameAt(increasingStart, increasingEnd, progress).kcal);

    assert.ok(samples[0]! < samples[1]!);
    assert.ok(samples[1]! < samples[2]!);
    assert.ok(samples[2]! < samples[3]!);
  });

  it("derives decreasing deltas and reverse ring/bar motion", () => {
    const decreasingStart = {
      kcal: 1500,
      percent: 75,
      ringValue: 0.75,
      macros: [{ grams: 120, percent: 80, barValue: 0.8 }],
    };
    const decreasingEnd = {
      kcal: 800,
      percent: 40,
      ringValue: 0.4,
      macros: [{ grams: 80, percent: 53, barValue: 0.53 }],
    };
    const early = frameAt(decreasingStart, decreasingEnd, 0.25);
    const late = frameAt(decreasingStart, decreasingEnd, 0.75);

    assert.ok(early.kcal > late.kcal);
    assert.ok(early.ringValue > late.ringValue);
    assert.ok(early.macros[0]!.barValue > late.macros[0]!.barValue);
  });

  it("replays unchanged values from zero to the current endpoint", () => {
    const replayStart = zeroEndpoints(end);

    assert.deepEqual(frameAt(replayStart, end, 0), replayStart);
    assert.deepEqual(frameAt(replayStart, end, 1), end);
  });

  it("uses one monotone shared easing curve", () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(easeShared);

    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 1);
    assert.ok(easeShared(0.5) > 0);
    assert.ok(easeShared(0.5) < 1);
    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(samples[index]! >= samples[index - 1]!);
    }
  });

  it("creates zero endpoints with matching macro shape", () => {
    assert.deepEqual(zeroEndpoints(end), start);
  });

  it("exports the locked 500ms timeline duration and plain lerp", () => {
    assert.equal(HOME_TIMELINE_DURATION_MS, 500);
    assert.equal(lerp(10, 20, 0.25), 12.5);
  });
});
