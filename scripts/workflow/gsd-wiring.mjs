#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveCanonicalPlanningConfig } from "./project-scope.mjs";
import { withWorkflowWriterFence } from "./workflow-lease.mjs";

const SKILL = ".codex/skills/nutrition-planning-proof";
const SKILL_FILE = `${SKILL}/SKILL.md`;
const GUIDANCE_FILE = "docs/workflow/planning-proof.md";
const ROLES = ["gsd-planner", "gsd-plan-checker"];
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const BLOB_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function wiringError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireCondition(condition, code) {
  if (!condition) throw wiringError(code);
}

function statIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    nlink: stat.nlink.toString(),
    mode: stat.mode.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  return JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right) && left.raw.equals(right.raw);
}

async function readStableFile(filePath, options) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") throw wiringError(options.missingCode);
    throw wiringError(options.unsafeCode);
  }
  try {
    const before = await handle.stat({ bigint: true });
    requireCondition(
      before.isFile() && before.nlink === 1n && before.size <= BigInt(options.maxBytes),
      options.unsafeCode,
    );
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    requireCondition(raw.length <= options.maxBytes, options.unsafeCode);
    requireCondition(JSON.stringify(statIdentity(before)) === JSON.stringify(statIdentity(after)), options.changedCode);
    return {
      raw,
      identity: statIdentity(after),
      permissions: Number(after.mode & 0o777n),
      sha256: sha256(raw),
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readConfigSnapshot(configPath) {
  const snapshot = await readStableFile(configPath, {
    maxBytes: MAX_CONFIG_BYTES,
    missingCode: "wiring_config_missing_or_unsafe",
    unsafeCode: "wiring_config_missing_or_unsafe",
    changedCode: "wiring_config_changed_during_read",
  });
  let config;
  try {
    config = JSON.parse(snapshot.raw.toString("utf8"));
  } catch {
    throw wiringError("wiring_config_invalid_json");
  }
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "wiring_config_invalid_shape");
  return { ...snapshot, config };
}

async function requirePlainSkillAncestors(projectRoot) {
  let current = path.resolve(projectRoot);
  for (const component of [".codex", "skills", "nutrition-planning-proof"]) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "wiring_skill_missing_or_unsafe");
  }
}

async function readSkillSnapshot(projectRoot) {
  await requirePlainSkillAncestors(projectRoot);
  return readStableFile(path.join(path.resolve(projectRoot), SKILL_FILE), {
    maxBytes: MAX_SKILL_BYTES,
    missingCode: "wiring_skill_missing_or_unsafe",
    unsafeCode: "wiring_skill_missing_or_unsafe",
    changedCode: "wiring_skill_changed_during_read",
  });
}

async function requirePlainGuidanceAncestors(projectRoot) {
  let current = path.resolve(projectRoot);
  for (const component of ["docs", "workflow"]) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "wiring_guidance_missing_or_unsafe");
  }
}

async function readGuidanceSnapshot(projectRoot) {
  await requirePlainGuidanceAncestors(projectRoot);
  return readStableFile(path.join(path.resolve(projectRoot), GUIDANCE_FILE), {
    maxBytes: MAX_SKILL_BYTES,
    missingCode: "wiring_guidance_missing_or_unsafe",
    unsafeCode: "wiring_guidance_missing_or_unsafe",
    changedCode: "wiring_guidance_changed_during_read",
  });
}

function resolveSourceSha(projectRoot) {
  let value;
  try {
    value = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
      cwd: path.resolve(projectRoot),
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    }).trim();
  } catch {
    throw wiringError("wiring_project_git_required");
  }
  requireCondition(SOURCE_SHA_PATTERN.test(value), "wiring_source_sha_invalid");
  return value;
}

function readPinnedSkill(projectRoot, sourceSha) {
  let rawEntry;
  try {
    rawEntry = execFileSync("git", ["--no-replace-objects", "ls-tree", "--full-tree", "-z", sourceSha, "--", SKILL_FILE], {
      cwd: path.resolve(projectRoot),
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
  } catch {
    throw wiringError("wiring_skill_source_lookup_failed");
  }
  requireCondition(rawEntry.length > 0, "wiring_skill_not_tracked_at_source");
  const entries = rawEntry.split("\0").filter(Boolean);
  requireCondition(entries.length === 1, "wiring_skill_source_entry_invalid");
  const match = entries[0].match(/^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$/);
  requireCondition(
    match && match[1] === "100644" && BLOB_SHA_PATTERN.test(match[2]) && match[3] === SKILL_FILE,
    "wiring_skill_source_entry_invalid",
  );
  let blob;
  try {
    blob = execFileSync("git", ["--no-replace-objects", "cat-file", "blob", match[2]], {
      cwd: path.resolve(projectRoot),
      encoding: "buffer",
      maxBuffer: MAX_SKILL_BYTES + 1,
    });
  } catch {
    throw wiringError("wiring_skill_source_blob_invalid");
  }
  requireCondition(blob.length <= MAX_SKILL_BYTES, "wiring_skill_source_blob_invalid");
  return {
    blobOid: match[2],
    sha256: sha256(blob),
    byteLength: blob.length,
  };
}

function readPinnedGuidance(projectRoot, sourceSha) {
  let rawEntry;
  try {
    rawEntry = execFileSync("git", ["--no-replace-objects", "ls-tree", "--full-tree", "-z", sourceSha, "--", GUIDANCE_FILE], {
      cwd: path.resolve(projectRoot),
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
  } catch {
    throw wiringError("wiring_guidance_source_lookup_failed");
  }
  requireCondition(rawEntry.length > 0, "wiring_guidance_not_tracked_at_source");
  const entries = rawEntry.split("\0").filter(Boolean);
  requireCondition(entries.length === 1, "wiring_guidance_source_entry_invalid");
  const match = entries[0].match(/^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$/);
  requireCondition(
    match && match[1] === "100644" && BLOB_SHA_PATTERN.test(match[2]) && match[3] === GUIDANCE_FILE,
    "wiring_guidance_source_entry_invalid",
  );
  let blob;
  try {
    blob = execFileSync("git", ["--no-replace-objects", "cat-file", "blob", match[2]], {
      cwd: path.resolve(projectRoot),
      encoding: "buffer",
      maxBuffer: MAX_SKILL_BYTES + 1,
    });
  } catch {
    throw wiringError("wiring_guidance_source_blob_invalid");
  }
  requireCondition(blob.length <= MAX_SKILL_BYTES, "wiring_guidance_source_blob_invalid");
  return {
    blobOid: match[2],
    sha256: sha256(blob),
    byteLength: blob.length,
  };
}

async function readSkillEvidence(projectRoot, sourceSha) {
  const pinned = readPinnedSkill(projectRoot, sourceSha);
  const snapshot = await readSkillSnapshot(projectRoot);
  requireCondition(snapshot.permissions === 0o644, "wiring_skill_worktree_mode_invalid");
  requireCondition(snapshot.sha256 === pinned.sha256, "wiring_skill_digest_mismatch");
  return { pinned, snapshot };
}

async function readGuidanceEvidence(projectRoot, sourceSha) {
  const pinned = readPinnedGuidance(projectRoot, sourceSha);
  const snapshot = await readGuidanceSnapshot(projectRoot);
  requireCondition(snapshot.permissions === 0o644, "wiring_guidance_worktree_mode_invalid");
  requireCondition(snapshot.sha256 === pinned.sha256, "wiring_guidance_digest_mismatch");
  return { pinned, snapshot };
}

function workstreamOverrideActive() {
  return typeof process.env.GSD_WORKSTREAM === "string" && process.env.GSD_WORKSTREAM.length > 0;
}

async function captureWorkstreamSurface(projectRoot) {
  const planningRoot = await fs.realpath(path.join(projectRoot, ".planning"));
  const projectId = createHash("sha1").update(planningRoot).digest("hex").slice(0, 16);

  async function captureEntry(candidate) {
    const stat = await fs.lstat(candidate, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw wiringError("wiring_workstream_surface_unsafe");
    });
    if (stat === null) return { type: "absent" };
    requireCondition(!stat.isSymbolicLink(), "wiring_workstream_surface_unsafe");
    if (stat.isFile()) {
      const snapshot = await readStableFile(candidate, {
        maxBytes: MAX_CONFIG_BYTES,
        missingCode: "wiring_workstream_surface_changed",
        unsafeCode: "wiring_workstream_surface_unsafe",
        changedCode: "wiring_workstream_surface_changed",
      });
      return { type: "file", identity: snapshot.identity, sha256: snapshot.sha256 };
    }
    requireCondition(stat.isDirectory(), "wiring_workstream_surface_unsafe");
    const children = [];
    for (const name of (await fs.readdir(candidate)).sort((left, right) => left.localeCompare(right, "en"))) {
      const child = await fs.lstat(path.join(candidate, name), { bigint: true }).catch(() => null);
      requireCondition(child !== null && !child.isSymbolicLink(), "wiring_workstream_surface_unsafe");
      children.push({ name, type: child.isDirectory() ? "directory" : child.isFile() ? "file" : "other", identity: statIdentity(child) });
    }
    const after = await fs.lstat(candidate, { bigint: true }).catch(() => null);
    requireCondition(after?.isDirectory() && !after.isSymbolicLink(), "wiring_workstream_surface_changed");
    return { type: "directory", identity: statIdentity(after), children };
  }

  const activePointer = await captureEntry(path.join(planningRoot, "active-workstream"));
  const workstreams = await captureEntry(path.join(planningRoot, "workstreams"));
  const sessionPointers = await captureEntry(path.join(tmpdir(), "gsd-workstream-sessions", projectId));
  const value = {
    environmentOverride: workstreamOverrideActive(),
    activePointer,
    workstreams,
    sessionPointers,
  };
  return {
    ...value,
    overridePresent:
      value.environmentOverride ||
      activePointer.type !== "absent" ||
      (workstreams.type === "directory" && workstreams.children.length > 0) ||
      (sessionPointers.type === "directory" && sessionPointers.children.length > 0),
    sha256: sha256(Buffer.from(JSON.stringify(value), "utf8")),
  };
}

function exactRoleBinding(values) {
  return Array.isArray(values) && values.length === 1 && values[0] === SKILL;
}

function pushRoleFindings(findings, config) {
  const bindings = config.agent_skills;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    findings.push({ code: "wiring_agent_skills_missing" });
    return;
  }
  for (const role of ROLES) {
    const values = bindings[role];
    if (values === undefined) findings.push({ code: "wiring_role_binding_missing", role, skill: SKILL });
    else if (!exactRoleBinding(values)) findings.push({ code: "wiring_role_binding_not_exact", role, skill: SKILL });
  }
}

function evidenceFinding(findings, error, evidence) {
  const code = typeof error?.code === "string" ? error.code : "wiring_skill_evidence_invalid";
  findings.push({ code, evidence });
}

export async function checkGsdHardeningWiring(options) {
  const scope = resolveCanonicalPlanningConfig(options);
  const sourceSha = resolveSourceSha(scope.projectRoot);
  const configBefore = await readConfigSnapshot(scope.configPath);
  const findings = [];
  let workstreamBefore = null;
  try {
    workstreamBefore = await captureWorkstreamSurface(scope.projectRoot);
    if (workstreamBefore.overridePresent) findings.push({ code: "wiring_workstream_override_active" });
  } catch (error) {
    evidenceFinding(findings, error, "workstream_surface");
  }
  pushRoleFindings(findings, configBefore.config);

  let skillBefore = null;
  try {
    skillBefore = await readSkillEvidence(scope.projectRoot, sourceSha);
  } catch (error) {
    evidenceFinding(findings, error, "skill");
  }
  let guidanceBefore = null;
  try {
    guidanceBefore = await readGuidanceEvidence(scope.projectRoot, sourceSha);
  } catch (error) {
    evidenceFinding(findings, error, "guidance");
  }

  if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_final_evidence_check");
  try {
    const sourceShaAfter = resolveSourceSha(scope.projectRoot);
    const configAfter = await readConfigSnapshot(scope.configPath);
    if (sourceShaAfter !== sourceSha || !sameSnapshot(configBefore, configAfter)) {
      findings.push({ code: "wiring_evidence_changed_during_check", evidence: "config_or_source" });
    }
    if (skillBefore !== null) {
      const skillAfter = await readSkillEvidence(scope.projectRoot, sourceShaAfter);
      if (
        skillAfter.pinned.blobOid !== skillBefore.pinned.blobOid ||
        skillAfter.pinned.sha256 !== skillBefore.pinned.sha256 ||
        !sameSnapshot(skillBefore.snapshot, skillAfter.snapshot)
      ) {
        findings.push({ code: "wiring_evidence_changed_during_check", evidence: "skill" });
      }
    }
    if (guidanceBefore !== null) {
      const guidanceAfter = await readGuidanceEvidence(scope.projectRoot, sourceShaAfter);
      if (
        guidanceAfter.pinned.blobOid !== guidanceBefore.pinned.blobOid ||
        guidanceAfter.pinned.sha256 !== guidanceBefore.pinned.sha256 ||
        !sameSnapshot(guidanceBefore.snapshot, guidanceAfter.snapshot)
      ) {
        findings.push({ code: "wiring_evidence_changed_during_check", evidence: "guidance" });
      }
    }
    if (workstreamBefore !== null) {
      const workstreamAfter = await captureWorkstreamSurface(scope.projectRoot);
      if (workstreamAfter.sha256 !== workstreamBefore.sha256) {
        findings.push({ code: "wiring_evidence_changed_during_check", evidence: "workstream_surface" });
      }
    }
  } catch (error) {
    findings.push({
      code: "wiring_evidence_changed_during_check",
      evidence: typeof error?.code === "string" ? error.code : "unknown",
    });
  }

  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    schemaVersion: 1,
    kind: "gsd_hardening_wiring_check",
    status: findings.length === 0 ? "pass" : "fail",
    configSha256: configBefore.sha256,
    requiredRoles: [...ROLES],
    requiredSkill: SKILL,
    sourceSha,
    skillBlobOid: skillBefore?.pinned.blobOid ?? null,
    skillSha256: skillBefore?.pinned.sha256 ?? null,
    guidanceFile: GUIDANCE_FILE,
    guidanceBlobOid: guidanceBefore?.pinned.blobOid ?? null,
    guidanceSha256: guidanceBefore?.pinned.sha256 ?? null,
    workstreamSurfaceSha256: workstreamBefore?.sha256 ?? null,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    findings,
  };
}

function prepareBindings(config) {
  if (config.agent_skills === undefined) config.agent_skills = {};
  requireCondition(
    config.agent_skills && typeof config.agent_skills === "object" && !Array.isArray(config.agent_skills),
    "wiring_agent_skills_invalid",
  );
  for (const role of ROLES) {
    const existing = config.agent_skills[role];
    requireCondition(existing === undefined || (Array.isArray(existing) && existing.length === 0) || exactRoleBinding(existing), "wiring_role_binding_conflict");
    config.agent_skills[role] = [SKILL];
  }
}

async function assertStableApplyEvidence(options) {
  await options.holder.assertCurrent();
  requireCondition(resolveSourceSha(options.projectRoot) === options.sourceSha, "wiring_source_sha_changed");
  const config = await readConfigSnapshot(options.configPath);
  requireCondition(sameSnapshot(config, options.configBefore), "wiring_config_changed_during_apply");
  const skill = await readSkillEvidence(options.projectRoot, options.sourceSha);
  requireCondition(
    skill.pinned.blobOid === options.skillBefore.pinned.blobOid &&
      skill.pinned.sha256 === options.skillBefore.pinned.sha256 &&
      sameSnapshot(skill.snapshot, options.skillBefore.snapshot),
    "wiring_skill_changed_during_apply",
  );
  const guidance = await readGuidanceEvidence(options.projectRoot, options.sourceSha);
  requireCondition(
    guidance.pinned.blobOid === options.guidanceBefore.pinned.blobOid &&
      guidance.pinned.sha256 === options.guidanceBefore.pinned.sha256 &&
      sameSnapshot(guidance.snapshot, options.guidanceBefore.snapshot),
    "wiring_guidance_changed_during_apply",
  );
  requireCondition(resolveSourceSha(options.projectRoot) === options.sourceSha, "wiring_source_sha_changed");
  const finalConfig = await readConfigSnapshot(options.configPath);
  requireCondition(sameSnapshot(finalConfig, options.configBefore), "wiring_config_changed_during_apply");
  const temp = await readStableFile(options.tempPath, {
    maxBytes: MAX_CONFIG_BYTES,
    missingCode: "wiring_apply_temp_changed",
    unsafeCode: "wiring_apply_temp_changed",
    changedCode: "wiring_apply_temp_changed",
  });
  requireCondition(sameSnapshot(temp, options.tempBefore), "wiring_apply_temp_changed");
  const workstreamSurface = await captureWorkstreamSurface(options.projectRoot);
  requireCondition(
    !workstreamSurface.overridePresent && workstreamSurface.sha256 === options.workstreamBefore.sha256,
    "wiring_workstream_override_active",
  );
  await options.holder.assertCurrent();
}

async function applyGsdHardeningWiringUnderFence(options, holder) {
  const configPath = path.resolve(options.configPath);
  const workstreamBefore = await captureWorkstreamSurface(options.projectRoot);
  requireCondition(!workstreamBefore.overridePresent, "wiring_workstream_override_active");
  const sourceShaBefore = resolveSourceSha(options.projectRoot);
  requireCondition(options.sourceSha === sourceShaBefore, "wiring_source_sha_mismatch");
  const configBefore = await readConfigSnapshot(configPath);
  requireCondition(options.confirmDigest === configBefore.sha256, "wiring_confirmation_digest_mismatch");
  const skillBefore = await readSkillEvidence(options.projectRoot, sourceShaBefore);
  const guidanceBefore = await readGuidanceEvidence(options.projectRoot, sourceShaBefore);
  prepareBindings(configBefore.config);
  const next = Buffer.from(`${JSON.stringify(configBefore.config, null, 2)}\n`, "utf8");
  const afterDigest = sha256(next);
  const changed = !next.equals(configBefore.raw);
  let temp = null;
  let expectedFinalConfig = configBefore;

  try {
    if (changed) {
      temp = path.join(path.dirname(configPath), `.${path.basename(configPath)}.tmp-${randomUUID()}`);
      const handle = await fs.open(temp, "wx", configBefore.permissions);
      try {
        await handle.writeFile(next);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const tempBefore = await readStableFile(temp, {
        maxBytes: MAX_CONFIG_BYTES,
        missingCode: "wiring_apply_temp_changed",
        unsafeCode: "wiring_apply_temp_changed",
        changedCode: "wiring_apply_temp_changed",
      });
      requireCondition(tempBefore.raw.equals(next), "wiring_apply_temp_changed");
      if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_apply_compare_and_rename");
      await assertStableApplyEvidence({
        projectRoot: options.projectRoot,
        configPath,
        sourceSha: sourceShaBefore,
        configBefore,
        skillBefore,
        guidanceBefore,
        workstreamBefore,
        tempPath: temp,
        tempBefore,
        holder,
      });
      await fs.rename(temp, configPath);
      temp = null;
      const directory = await fs.open(path.dirname(configPath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      expectedFinalConfig = await readConfigSnapshot(configPath);
      requireCondition(expectedFinalConfig.raw.equals(next), "wiring_final_config_readback_mismatch");
    }

    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_final_readback");
    await holder.assertCurrent();
    requireCondition(resolveSourceSha(options.projectRoot) === sourceShaBefore, "wiring_source_sha_changed");
    const configAfter = await readConfigSnapshot(configPath);
    requireCondition(configAfter.raw.equals(next) && sameSnapshot(configAfter, expectedFinalConfig), "wiring_final_config_readback_mismatch");
    const skillAfter = await readSkillEvidence(options.projectRoot, sourceShaBefore);
    requireCondition(
      skillAfter.pinned.blobOid === skillBefore.pinned.blobOid &&
        skillAfter.pinned.sha256 === skillBefore.pinned.sha256 &&
        sameSnapshot(skillAfter.snapshot, skillBefore.snapshot),
      "wiring_skill_changed_during_apply",
    );
    const guidanceAfter = await readGuidanceEvidence(options.projectRoot, sourceShaBefore);
    requireCondition(
      guidanceAfter.pinned.blobOid === guidanceBefore.pinned.blobOid &&
        guidanceAfter.pinned.sha256 === guidanceBefore.pinned.sha256 &&
        sameSnapshot(guidanceAfter.snapshot, guidanceBefore.snapshot),
      "wiring_guidance_changed_during_apply",
    );
    const workstreamAfter = await captureWorkstreamSurface(options.projectRoot);
    requireCondition(
      !workstreamAfter.overridePresent && workstreamAfter.sha256 === workstreamBefore.sha256,
      "wiring_workstream_override_active",
    );
  } finally {
    if (temp !== null) await fs.unlink(temp).catch(() => undefined);
  }

  return {
    schemaVersion: 1,
    kind: "gsd_hardening_wiring_apply",
    status: "pass",
    changed,
    beforeConfigSha256: configBefore.sha256,
    afterConfigSha256: afterDigest,
    boundRoles: [...ROLES],
    skill: SKILL,
    skillBlobOid: skillBefore.pinned.blobOid,
    skillSha256: skillBefore.pinned.sha256,
    guidanceFile: GUIDANCE_FILE,
    guidanceBlobOid: guidanceBefore.pinned.blobOid,
    guidanceSha256: guidanceBefore.pinned.sha256,
    sourceSha: sourceShaBefore,
    writerFenceId: holder.fenceId,
    writerFenceReleased: true,
    cleanupRequired: false,
  };
}

export async function applyGsdHardeningWiring(options) {
  const scope = resolveCanonicalPlanningConfig(options);
  const workstreamSurface = await captureWorkstreamSurface(scope.projectRoot);
  requireCondition(!workstreamSurface.overridePresent, "wiring_workstream_override_active");
  const scopedOptions = { ...options, projectRoot: scope.projectRoot, configPath: scope.configPath };
  return withWorkflowWriterFence(
    {
      projectRoot: scope.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "workflow_command",
      maxDurationSeconds: options.maxDurationSeconds ?? 30,
      now: options.now,
      fenceId: options.fenceId,
    },
    (holder) => applyGsdHardeningWiringUnderFence(scopedOptions, holder),
  );
}

function parseCli(argv) {
  const [command, ...args] = argv;
  requireCondition(command === "check" || command === "apply", "wiring_usage_error");
  const values = {};
  const allowed =
    command === "check"
      ? new Set(["config", "project-root"])
      : new Set(["config", "project-root", "confirm-digest", "source-sha", "token-file", "runtime"]);
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]) && !Object.hasOwn(values, match[1]), "wiring_usage_error");
    values[match[1]] = match[2];
  }
  requireCondition(
    typeof values.config === "string" &&
      values.config.length > 0 &&
      typeof values["project-root"] === "string" &&
      values["project-root"].length > 0,
    "wiring_usage_error",
  );
  if (command === "apply") {
    requireCondition(SHA256_PATTERN.test(values["confirm-digest"] ?? ""), "wiring_usage_error");
    requireCondition(SOURCE_SHA_PATTERN.test(values["source-sha"] ?? ""), "wiring_usage_error");
    requireCondition(typeof values["token-file"] === "string" && values["token-file"].length > 0, "wiring_usage_error");
    requireCondition(values.runtime === "codex" || values.runtime === "claude", "wiring_usage_error");
  }
  return { command, values };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    const result =
      command === "check"
        ? await checkGsdHardeningWiring({ configPath: values.config, projectRoot: values["project-root"] })
        : await applyGsdHardeningWiring({
            configPath: values.config,
            projectRoot: values["project-root"],
            confirmDigest: values["confirm-digest"],
            sourceSha: values["source-sha"],
            tokenFile: values["token-file"],
            expectedRuntime: values.runtime,
          });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ schemaVersion: 1, kind: "gsd_hardening_wiring_error", code: error?.code ?? "wiring_unexpected_error" })}\n`,
    );
    process.exitCode = 1;
  }
}
