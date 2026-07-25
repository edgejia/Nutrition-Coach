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
});
