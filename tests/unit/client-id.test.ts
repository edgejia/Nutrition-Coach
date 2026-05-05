import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createClientId } from "../../client/src/lib/clientId.js";

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function restoreCrypto() {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, "crypto");
}

function setCrypto(value: Partial<Crypto> | undefined) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value,
  });
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(path);
      }

      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        return [path];
      }

      return [];
    }),
  );

  return files.flat();
}

describe("createClientId", () => {
  afterEach(() => {
    restoreCrypto();
  });

  it("uses randomUUID when the browser origin exposes it", () => {
    setCrypto({
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    assert.equal(createClientId("usr"), "usr_00000000-0000-4000-8000-000000000001");
  });

  it("falls back to getRandomValues when randomUUID is unavailable on LAN HTTP origins", () => {
    setCrypto({
      getRandomValues: ((array: Uint8Array) => {
        array.set(Array.from({ length: array.length }, (_, index) => index));
        return array;
      }) as Crypto["getRandomValues"],
    });

    assert.equal(createClientId("ast"), "ast_000102030405060708090a0b0c0d0e0f");
  });

  it("fails loudly when no browser crypto API is available", () => {
    setCrypto(undefined);

    assert.throws(() => createClientId("draft"), /Browser crypto API is unavailable/);
  });

  it("keeps direct client randomUUID calls isolated to the helper", async () => {
    const files = await listSourceFiles("client/src");
    const violations: string[] = [];

    for (const file of files) {
      if (file === "client/src/lib/clientId.ts") {
        continue;
      }

      const source = await readFile(file, "utf8");
      if (source.includes("crypto.randomUUID(")) {
        violations.push(file);
      }
    }

    assert.deepEqual(violations, []);
  });
});
