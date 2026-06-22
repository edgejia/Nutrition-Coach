import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GUEST_SESSION_SECRET,
  isDeployedLikeRuntime,
  type RuntimeConfigInput,
  validateRuntimeConfig,
  validateGuestSessionSecretForRuntime,
} from "../../server/config.js";

function assertRuntimeConfigError(
  input: RuntimeConfigInput,
  expectedEnvName: string,
  expectedShapeText: string,
  rawRejectedValue?: string,
) {
  assert.throws(
    () => validateRuntimeConfig(input),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(expectedEnvName), error.message);
      assert.ok(error.message.includes(expectedShapeText), error.message);
      if (rawRejectedValue !== undefined) {
        assert.equal(error.message.includes(rawRejectedValue), false, error.message);
      }
      return true;
    },
  );
}

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
          const trimmedSecret = guestSessionSecret?.trim();
          if (trimmedSecret) {
            assert.doesNotMatch(error.message, new RegExp(trimmedSecret));
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

  it("rejects the development default when secure guest cookies make test runtime deployed-like", () => {
    assert.throws(
      () =>
        validateGuestSessionSecretForRuntime({
          guestSessionSecret: DEFAULT_GUEST_SESSION_SECRET,
          guestSessionCookieSecure: true,
          nodeEnv: "test",
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /GUEST_SESSION_SECRET/);
        assert.match(error.message, /GUEST_SESSION_COOKIE_SECURE=true/);
        assert.doesNotMatch(error.message, new RegExp(DEFAULT_GUEST_SESSION_SECRET));
        return true;
      },
    );
  });

  it("accepts any trimmed non-default secret at least 32 characters without format restrictions", () => {
    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: "  not-hex!!!not-base64url???value-ok  ",
        guestSessionCookieSecure: false,
        nodeEnv: "production",
      });
    });
    assert.doesNotThrow(() => {
      validateGuestSessionSecretForRuntime({
        guestSessionSecret: "secure-cookie-runtime-secret-value!!!",
        guestSessionCookieSecure: true,
        nodeEnv: "test",
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

    assert.deepEqual({ ...process.env }, before);
  });
});

describe("server config runtime numeric policy", () => {
  it("returns defaults when numeric runtime values are missing", () => {
    assert.deepEqual(
      validateRuntimeConfig({
        port: undefined,
        guestSessionTtlSeconds: undefined,
        guestSessionResumeTtlSeconds: undefined,
      }),
      {
        port: 3000,
        guestSessionTtlSeconds: 43200,
        guestSessionResumeTtlSeconds: 2592000,
      },
    );
  });

  it("accepts valid integer strings for port and guest-session TTLs", () => {
    assert.deepEqual(
      validateRuntimeConfig({
        port: "1",
        guestSessionTtlSeconds: "1",
        guestSessionResumeTtlSeconds: "9007199254740991",
      }),
      {
        port: 1,
        guestSessionTtlSeconds: 1,
        guestSessionResumeTtlSeconds: 9007199254740991,
      },
    );

    assert.deepEqual(
      validateRuntimeConfig({
        port: "65535",
        guestSessionTtlSeconds: "43200",
        guestSessionResumeTtlSeconds: "2592000",
      }),
      {
        port: 65535,
        guestSessionTtlSeconds: 43200,
        guestSessionResumeTtlSeconds: 2592000,
      },
    );
  });

  it("rejects invalid PORT strings and boundaries", () => {
    const rejectedPorts = [
      "0",
      "-1",
      "65536",
      "1.5",
      "NaN",
      "Infinity",
      "not-a-number",
      "",
      "   ",
      "9007199254740992",
    ] as const;

    for (const port of rejectedPorts) {
      assert.throws(() =>
        validateRuntimeConfig({
          port,
          guestSessionTtlSeconds: undefined,
          guestSessionResumeTtlSeconds: undefined,
        }),
      );
    }
  });

  it("rejects invalid active guest-session TTL strings and accepts large safe integers", () => {
    const rejectedTtls = [
      "0",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "not-a-number",
      "",
      "   ",
      "9007199254740992",
    ] as const;

    for (const guestSessionTtlSeconds of rejectedTtls) {
      assert.throws(() =>
        validateRuntimeConfig({
          port: undefined,
          guestSessionTtlSeconds,
          guestSessionResumeTtlSeconds: undefined,
        }),
      );
    }

    assert.equal(
      validateRuntimeConfig({
        port: undefined,
        guestSessionTtlSeconds: "9007199254740991",
        guestSessionResumeTtlSeconds: undefined,
      }).guestSessionTtlSeconds,
      9007199254740991,
    );
  });

  it("rejects invalid resume guest-session TTL strings and accepts large safe integers", () => {
    const rejectedTtls = [
      "0",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "not-a-number",
      "",
      "   ",
      "9007199254740992",
    ] as const;

    for (const guestSessionResumeTtlSeconds of rejectedTtls) {
      assert.throws(() =>
        validateRuntimeConfig({
          port: undefined,
          guestSessionTtlSeconds: undefined,
          guestSessionResumeTtlSeconds,
        }),
      );
    }

    assert.equal(
      validateRuntimeConfig({
        port: undefined,
        guestSessionTtlSeconds: undefined,
        guestSessionResumeTtlSeconds: "9007199254740991",
      }).guestSessionResumeTtlSeconds,
      9007199254740991,
    );
  });

  it("names the invalid env var and accepted numeric shape without echoing rejected values", () => {
    const rawRejectedValue = "9007199254740992.*[secret-like-token]";

    assertRuntimeConfigError(
      {
        port: rawRejectedValue,
        guestSessionTtlSeconds: undefined,
        guestSessionResumeTtlSeconds: undefined,
      },
      "PORT",
      "integer from 1 to 65535",
      rawRejectedValue,
    );

    assertRuntimeConfigError(
      {
        port: undefined,
        guestSessionTtlSeconds: rawRejectedValue,
        guestSessionResumeTtlSeconds: undefined,
      },
      "GUEST_SESSION_TTL_SECONDS",
      "positive safe integer number of seconds",
      rawRejectedValue,
    );

    assertRuntimeConfigError(
      {
        port: undefined,
        guestSessionTtlSeconds: undefined,
        guestSessionResumeTtlSeconds: rawRejectedValue,
      },
      "GUEST_SESSION_RESUME_TTL_SECONDS",
      "positive safe integer number of seconds",
      rawRejectedValue,
    );
  });

  it("does not mutate process-wide environment while validating explicit runtime input", () => {
    const before = { ...process.env };

    assert.doesNotThrow(() => {
      validateRuntimeConfig({
        port: "3000",
        guestSessionTtlSeconds: "43200",
        guestSessionResumeTtlSeconds: "2592000",
      });
    });

    assert.deepEqual({ ...process.env }, before);
  });
});
