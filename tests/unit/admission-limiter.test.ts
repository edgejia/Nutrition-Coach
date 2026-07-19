import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAdmissionLimiter,
  type AdmissionSubject,
} from "../../server/services/admission-limiter.js";

const subject = (deviceId: string, sessionVersion = 0): AdmissionSubject => ({
  deviceId,
  sessionVersion,
});

describe("admission limiter", () => {
  it("keeps a rotated session on the same quota window and resets only after the fake clock advances", () => {
    let now = 10_000;
    const limiter = createAdmissionLimiter({
      now: () => now,
      windowMs: 10_000,
      budgets: {
        provider: { maxRequests: 2, maxConcurrent: 2 },
      },
    });

    const first = limiter.tryAcquire("provider", subject("device-a", 0));
    assert.equal(first.ok, true);
    if (first.ok) first.permit.release();

    const rotated = limiter.tryAcquire("provider", subject("device-a", 1));
    assert.equal(rotated.ok, true);
    if (rotated.ok) rotated.permit.release();

    const bypassAttempt = limiter.tryAcquire("provider", subject("device-a", 1));
    assert.equal(bypassAttempt.ok, false);
    if (!bypassAttempt.ok) {
      assert.equal(bypassAttempt.statusCode, 429);
      assert.equal(typeof bypassAttempt.retryAfterSeconds, "number");
      assert.ok(bypassAttempt.retryAfterSeconds >= 1);
    }

    now += 10_000;
    const afterWindow = limiter.tryAcquire("provider", subject("device-a", 1));
    assert.equal(afterWindow.ok, true);
    if (afterWindow.ok) afterWindow.permit.release();
  });

  it("returns a numeric Retry-After for both request-window and concurrency rejection", () => {
    let now = 25_000;
    const limiter = createAdmissionLimiter({
      now: () => now,
      windowMs: 5_000,
      budgets: {
        provider: { maxRequests: 1, maxConcurrent: 1 },
      },
    });

    const held = limiter.tryAcquire("provider", subject("device-b"));
    assert.equal(held.ok, true);

    const concurrencyRejected = limiter.tryAcquire("provider", subject("device-b"));
    assert.equal(concurrencyRejected.ok, false);
    if (!concurrencyRejected.ok) {
      assert.equal(concurrencyRejected.reason, "concurrency");
      assert.match(String(concurrencyRejected.retryAfterSeconds), /^\d+$/);
    }

    if (held.ok) held.permit.release();
    const windowRejected = limiter.tryAcquire("provider", subject("device-b"));
    assert.equal(windowRejected.ok, false);
    if (!windowRejected.ok) {
      assert.equal(windowRejected.reason, "window");
      assert.match(String(windowRejected.retryAfterSeconds), /^\d+$/);
    }

    now += 5_000;
    const afterReset = limiter.tryAcquire("provider", subject("device-b"));
    assert.equal(afterReset.ok, true);
    if (afterReset.ok) afterReset.permit.release();
  });

  it("releases a permit exactly once, including async success and failure", async () => {
    const limiter = createAdmissionLimiter({
      budgets: {
        provider: { maxRequests: 10, maxConcurrent: 1 },
      },
    });

    const permit = limiter.tryAcquire("provider", subject("device-c"));
    assert.equal(permit.ok, true);
    if (permit.ok) {
      permit.permit.release();
      permit.permit.release();
    }

    const next = limiter.tryAcquire("provider", subject("device-c"));
    assert.equal(next.ok, true);
    if (next.ok) next.permit.release();

    await assert.rejects(
      limiter.run("provider", subject("device-c"), async () => {
        throw new Error("provider failure");
      }),
      /provider failure/,
    );

    const afterFailure = limiter.tryAcquire("provider", subject("device-c"));
    assert.equal(afterFailure.ok, true);
    if (afterFailure.ok) afterFailure.permit.release();
  });

  it("does not let an older session version create a new active permit", () => {
    const limiter = createAdmissionLimiter({
      budgets: {
        bootstrap: { maxRequests: 4, maxConcurrent: 1 },
      },
    });

    const current = limiter.tryAcquire("bootstrap", subject("device-d", 2));
    assert.equal(current.ok, true);
    if (current.ok) current.permit.release();

    const stale = limiter.tryAcquire("bootstrap", subject("device-d", 1));
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.reason, "stale_session");
      assert.equal(stale.statusCode, 401);
    }
  });

  it("keeps an active permit releasable when the request window rolls over", () => {
    let now = 0;
    const limiter = createAdmissionLimiter({
      now: () => now,
      windowMs: 1_000,
      budgets: {
        provider: { maxRequests: 4, maxConcurrent: 1 },
      },
    });

    const held = limiter.tryAcquire("provider", subject("device-e"));
    assert.equal(held.ok, true);
    now = 1_000;

    const stillBusy = limiter.tryAcquire("provider", subject("device-e"));
    assert.equal(stillBusy.ok, false);
    if (!stillBusy.ok) assert.equal(stillBusy.reason, "concurrency");

    if (held.ok) held.permit.release();
    const afterRelease = limiter.tryAcquire("provider", subject("device-e"));
    assert.equal(afterRelease.ok, true);
    if (afterRelease.ok) afterRelease.permit.release();
  });

  it("rejects overlapping async provider work before the second callback starts", async () => {
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const limiter = createAdmissionLimiter({
      budgets: {
        provider: { maxRequests: 4, maxConcurrent: 1 },
      },
    });

    let firstStarted = false;
    let secondStarted = false;
    const first = limiter.run("provider", subject("device-f"), async () => {
      firstStarted = true;
      await firstFinished;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    await assert.rejects(
      limiter.run("provider", subject("device-f"), async () => {
        secondStarted = true;
      }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        if (error instanceof Error) {
          assert.equal(error.name, "AdmissionRejectedError");
          assert.equal((error as Error & { statusCode?: number }).statusCode, 429);
        }
        return true;
      },
    );
    assert.equal(firstStarted, true);
    assert.equal(secondStarted, false);

    releaseFirst();
    await first;
    await limiter.run("provider", subject("device-f"), async () => undefined);
  });
});
