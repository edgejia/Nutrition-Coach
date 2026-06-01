import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GUEST_SESSION_SECRET,
  isDeployedLikeRuntime,
  validateGuestSessionSecretForRuntime,
} from "../../server/config.js";

describe("server config guest-session policy", () => {
  it("detects deployed-like runtime only from production node env or secure guest cookies", () => {
    assert.equal(isDeployedLikeRuntime({ nodeEnv: "production", guestSessionCookieSecure: false }), true);
    assert.equal(isDeployedLikeRuntime({ nodeEnv: "test", guestSessionCookieSecure: true }), true);
    assert.equal(isDeployedLikeRuntime({ nodeEnv: "development", guestSessionCookieSecure: false }), false);
    assert.equal(isDeployedLikeRuntime({ nodeEnv: undefined, guestSessionCookieSecure: false }), false);
  });

  it("does not enforce guest-secret strength outside deployed-like runtime", () => {
    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: DEFAULT_GUEST_SESSION_SECRET,
        guestSessionCookieSecure: false,
        nodeEnv: "test",
      });
    });
    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: "short",
        guestSessionCookieSecure: false,
        nodeEnv: undefined,
      });
    });
  });

  it("rejects missing, trim-empty, default, and short secrets in deployed-like runtime", () => {
    const rejectedSecrets = [undefined, "   ", DEFAULT_GUEST_SESSION_SECRET, "x".repeat(31)] as const;

    for (const guestSessionSecret of rejectedSecrets) {
      assert.throws(
        () =>
          validateGuestSessionSecretForRuntime({
            guestSessionSecret,
            guestSessionCookieSecure: false,
            nodeEnv: "production",
          }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /GUEST_SESSION_SECRET/);
          assert.match(error.message, /NODE_ENV=production/);
          assert.match(error.message, /GUEST_SESSION_COOKIE_SECURE=true/);
          assert.match(error.message, /non-empty, non-default value at least 32 characters/);
          if (guestSessionSecret) {
            assert.doesNotMatch(error.message, new RegExp(guestSessionSecret.trim()));
          }
          return true;
        },
      );
    }
  });

  it("rejects weak secrets when secure guest cookies make test runtime deployed-like", () => {
    const candidateSecret = "too-short-for-secure-runtime";

    assert.throws(
      () =>
        validateGuestSessionSecretForRuntime({
          guestSessionSecret: candidateSecret,
          guestSessionCookieSecure: true,
          nodeEnv: "test",
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /GUEST_SESSION_SECRET/);
        assert.match(error.message, /GUEST_SESSION_COOKIE_SECURE=true/);
        assert.doesNotMatch(error.message, new RegExp(candidateSecret));
        return true;
      },
    );
  });

  it("accepts any trimmed non-default secret at least 32 characters without format restrictions", () => {
    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: "  not-hex!!!not-base64url???value  ",
        guestSessionCookieSecure: false,
        nodeEnv: "production",
      });
    });
  });

  it("does not mutate process-wide environment while validating explicit input", () => {
    const before = { ...process.env };

    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: "safe-secret-value-with-punctuation!!!",
        guestSessionCookieSecure: true,
        nodeEnv: "test",
      });
    });

    assert.deepEqual(process.env, before);
  });
});
