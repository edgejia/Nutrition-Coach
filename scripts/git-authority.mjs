import { execFileSync } from "node:child_process";

export const FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_REPLACE_REF_BASE",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_",
  "GIT_CONFIG_VALUE_",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GIT_EXTERNAL_DIFF",
  "GIT_DIFF_OPTS",
];

function isForbidden(name) {
  return FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT.some((entry) => entry.endsWith("_")
    ? name.startsWith(entry)
    : name === entry);
}

function isCanonicalConfigValue(name, value) {
  return (name === "GIT_CONFIG_GLOBAL" && value === "/dev/null")
    || (name === "GIT_CONFIG_NOSYSTEM" && value === "1");
}

export function assertNoAmbientGitAuthority(env = process.env) {
  const violations = Object.keys(env).filter((name) => isForbidden(name) && !isCanonicalConfigValue(name, env[name]));
  if (violations.length > 0) {
    throw new Error("ambient Git authority environment is forbidden");
  }
}

export function sanitizedGitEnvironment(env = process.env) {
  assertNoAmbientGitAuthority(env);
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

export function runAuthoritativeGit(args, options = {}) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
    ...options,
    env: sanitizedGitEnvironment(options.env ?? process.env),
  });
}
