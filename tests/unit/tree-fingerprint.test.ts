import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fingerprintTree } from "../../scripts/workflow/tree-fingerprint.mjs";

const roots = new Set<string>();

async function fixture() {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-tree-fingerprint-"));
  const root = await fs.realpath(created);
  roots.add(root);
  await fs.mkdir(path.join(root, "phase"));
  await fs.writeFile(path.join(root, "STATE.md"), "state\n", { mode: 0o600 });
  await fs.writeFile(path.join(root, "phase/PLAN.md"), "plan\n", { mode: 0o644 });
  return root;
}

afterEach(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  roots.clear();
});

describe("workflow tree fingerprint", () => {
  it("locks relative path, type, mode, size, and file content deterministically", async () => {
    const root = await fixture();
    const first = await fingerprintTree({ root });
    const second = await fingerprintTree({ root });
    assert.deepEqual(second, first);
    assert.deepEqual(first.entries.map((entry) => entry.path), [".", "phase", "phase/PLAN.md", "STATE.md"]);
    assert.equal(first.entries.find((entry) => entry.path === "STATE.md")?.mode, "600");
    await fs.appendFile(path.join(root, "STATE.md"), "drift\n");
    assert.notEqual((await fingerprintTree({ root })).treeSha256, first.treeSha256);
  });

  it("records a symlink target without following it", async () => {
    const root = await fixture();
    const outside = path.join(path.dirname(root), "outside-secret");
    await fs.writeFile(outside, "do not hash\n");
    await fs.symlink(outside, path.join(root, "link"));
    const result = await fingerprintTree({ root });
    const link = result.entries.find((entry) => entry.path === "link");
    assert.equal(link?.type, "symlink");
    assert.equal(link?.target, outside);
    assert.equal(Object.hasOwn(link ?? {}, "sha256"), false);
    await fs.rm(outside);
  });

  it("streams files larger than the former four MiB ceiling", async () => {
    const root = await fixture();
    const large = Buffer.alloc(5 * 1024 * 1024, 0x61);
    await fs.writeFile(path.join(root, "large.bin"), large);
    const first = await fingerprintTree({ root });
    const second = await fingerprintTree({ root });
    assert.equal(first.totalFileBytes, large.length + Buffer.byteLength("state\nplan\n"));
    assert.equal(first.treeSha256, second.treeSha256);
    assert.equal(first.entries.find((entry) => entry.path === "large.bin")?.size, large.length);
  });

  it("binds the root directory mode and supports metadata-only CLI evidence", async () => {
    const root = await fixture();
    const first = await fingerprintTree({ root });
    await fs.chmod(root, 0o755);
    const second = await fingerprintTree({ root });
    assert.notEqual(first.treeSha256, second.treeSha256);
    assert.equal(second.entries[0]?.path, ".");
    assert.equal(second.entries[0]?.mode, "755");

    const result = spawnSync(
      process.execPath,
      ["scripts/workflow/tree-fingerprint.mjs", `--root=${root}`, "--summary-only=true"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.treeSha256, second.treeSha256);
    assert.equal(Object.hasOwn(summary, "entries"), false);
  });

  it("rejects relative roots and CLI flag typos", async () => {
    await assert.rejects(fingerprintTree({ root: "." }));
    const result = spawnSync(
      process.execPath,
      ["scripts/workflow/tree-fingerprint.mjs", `--root=${process.cwd()}`, "--strcit=true"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tree_fingerprint_usage_error/);
  });
});
