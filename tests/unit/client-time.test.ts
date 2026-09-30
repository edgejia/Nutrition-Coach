import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatLocalDate,
  getMillisecondsUntilNextTaipeiMidnight,
} from "../../client/src/lib/time.js";

const originalTz = process.env.TZ;

describe("client app date helper", () => {
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("formats dates in Asia/Taipei instead of the host local timezone", () => {
    process.env.TZ = "America/Los_Angeles";

    assert.equal(formatLocalDate(new Date("2026-05-17T16:30:00.000Z")), "2026-05-18");
  });

  it("keeps normal Asia/Taipei daytime dates stable", () => {
    process.env.TZ = "UTC";

    assert.equal(formatLocalDate(new Date("2026-05-18T04:00:00.000Z")), "2026-05-18");
  });

  it("uses the same Taipei date and next-midnight delay across host timezones", () => {
    const instant = new Date("2026-05-17T16:30:00.000Z");

    for (const hostTimezone of ["UTC", "America/Los_Angeles"]) {
      process.env.TZ = hostTimezone;

      assert.equal(formatLocalDate(instant), "2026-05-18");
      assert.equal(getMillisecondsUntilNextTaipeiMidnight(instant), 23.5 * 60 * 60 * 1000);
    }
  });

  it("keeps the exact Taipei midnight boundary precise across host timezones", () => {
    const cases = [
      {
        instant: new Date("2026-05-17T15:59:59.999Z"),
        dateKey: "2026-05-17",
        delayMs: 1,
      },
      {
        instant: new Date("2026-05-17T16:00:00.000Z"),
        dateKey: "2026-05-18",
        delayMs: 24 * 60 * 60 * 1000,
      },
      {
        instant: new Date("2026-05-17T16:00:00.001Z"),
        dateKey: "2026-05-18",
        delayMs: 24 * 60 * 60 * 1000 - 1,
      },
    ];

    for (const hostTimezone of ["UTC", "America/Los_Angeles"]) {
      process.env.TZ = hostTimezone;

      for (const testCase of cases) {
        assert.equal(formatLocalDate(testCase.instant), testCase.dateKey);
        const delayMs = getMillisecondsUntilNextTaipeiMidnight(testCase.instant);
        assert.equal(Number.isInteger(delayMs), true);
        assert.equal(delayMs, testCase.delayMs);
        assert.ok(delayMs > 0);
      }
    }
  });
});
