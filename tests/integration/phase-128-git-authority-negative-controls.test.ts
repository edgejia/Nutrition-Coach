import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertNoAmbientGitAuthority,
  FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT,
  runAuthoritativeGit,
  sanitizedGitEnvironment,
} from "../../scripts/git-authority.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WRAPPER_PATH = path.join(REPO_ROOT, "scripts/run-with-source-sha.mjs");
const RELEASE_CHECK_PATH = path.join(REPO_ROOT, "scripts/release-check.mjs");
const TSX_IMPORT_PATH = path.join(REPO_ROOT, "node_modules/tsx/dist/loader.mjs");

test("Phase 128 Git authority rejects foreign routing, index, replace, and config controls before Git runs", () => {
  const injected = [
    ["GIT_DIR", "/tmp/foreign.git"],
    ["GIT_WORK_TREE", "/tmp/foreign-worktree"],
    ["GIT_INDEX_FILE", "/tmp/foreign.index"],
    ["GIT_REPLACE_REF_BASE", "refs/replace/"],
    ["GIT_CONFIG_COUNT", "1"],
    ["GIT_CONFIG_KEY_0", "credential.helper"],
    ["GIT_CONFIG_VALUE_0", "malicious-helper"],
  ] as const;
  for (const [name, value] of injected) {
    assert.throws(() => assertNoAmbientGitAuthority({ ...process.env, [name]: value }), /ambient Git authority/);
  }
});

test("Phase 128 Git authority binds calls to sanitized environment and no-replace-objects", () => {
  const env = sanitizedGitEnvironment({ TZ: "Asia/Taipei", GIT_PAGER: "less" });
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal("GIT_PAGER" in env, false);
  assert.match(fs.readFileSync("scripts/git-authority.mjs", "utf8"), /--no-replace-objects/);
  assert.match(fs.readFileSync("scripts/run-with-source-sha.mjs", "utf8"), /runAuthoritativeGit/);
  assert.match(fs.readFileSync("scripts/release-check.mjs", "utf8"), /runAuthoritativeGit/);
  assert.equal(typeof runAuthoritativeGit, "function");
});

test("Phase 128 Git consumers reject every foreign authority before Git or child execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase-128-git-consumers-"));
  const bin = path.join(root, "bin");
  const gitMarker = path.join(root, "git.marker");
  const childMarker = path.join(root, "child.marker");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh\nprintf called > ${JSON.stringify(gitMarker)}\nexit 0\n`,
    "utf8",
  );
  fs.chmodSync(path.join(bin, "git"), 0o755);

  try {
    const forbiddenNames = new Set<string>();
    for (const entry of FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT) {
      forbiddenNames.add(entry.endsWith("_") ? `${entry}0` : entry);
    }

    for (const name of forbiddenNames) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TZ: "Asia/Taipei",
        TMPDIR: root,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      };
      for (const entry of FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT) {
        for (const key of Object.keys(env)) {
          if (entry.endsWith("_") ? key.startsWith(entry) : key === entry) delete env[key];
        }
      }
      env[name] = name === "GIT_CONFIG_GLOBAL" ? path.join(root, "global.gitconfig") : "foreign-authority";

      const wrapper = spawnSync(process.execPath, [
        "--import",
        TSX_IMPORT_PATH,
        WRAPPER_PATH,
        "--",
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(childMarker)}, "called")`,
      ], { cwd: REPO_ROOT, env, encoding: "utf8" });
      assert.notEqual(wrapper.status, 0, `wrapper unexpectedly accepted ${name}: ${wrapper.stdout}${wrapper.stderr}`);
      assert.match(`${wrapper.stdout}${wrapper.stderr}`, /ambient Git authority/);
      assert.equal(fs.existsSync(gitMarker), false);
      assert.equal(fs.existsSync(childMarker), false);

      const release = spawnSync(process.execPath, [RELEASE_CHECK_PATH, "--dry-run", "--base=HEAD"], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      });
      assert.notEqual(release.status, 0, `release-check unexpectedly accepted ${name}: ${release.stdout}${release.stderr}`);
      assert.match(`${release.stdout}${release.stderr}`, /ambient Git authority/);
      assert.equal(fs.existsSync(gitMarker), false);
      assert.equal(fs.existsSync(childMarker), false);
    }
    assert.deepEqual(
      fs.readdirSync(root).filter((entry) => entry !== "bin" && !entry.startsWith("tsx-")).sort(),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
