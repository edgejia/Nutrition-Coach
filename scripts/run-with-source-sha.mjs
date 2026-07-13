#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { parseSourceRevision } from "../server/lib/source-revision.js";

const ARGUMENT_ERROR = "Source revision wrapper arguments are invalid.";
const COMMAND_ERROR = "Source revision child command could not be started.";
const SOURCE_INPUT_ERROR = "Source repository inputs are not clean.";

function parseArguments(argv) {
  let manifestPath;
  let cursor = 0;

  if (argv[cursor] === "--manifest") {
    manifestPath = argv[cursor + 1];
    if (!manifestPath) {
      throw new Error(ARGUMENT_ERROR);
    }
    cursor += 2;
  }

  if (argv[cursor] !== "--" || cursor + 1 >= argv.length) {
    throw new Error(ARGUMENT_ERROR);
  }

  return {
    manifestPath,
    command: argv[cursor + 1],
    commandArgs: argv.slice(cursor + 2),
  };
}

function resolveSourceSha() {
  const output = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return parseSourceRevision(output.trim());
}

function assertCleanSourceInputs() {
  let output;
  try {
    output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    throw new Error(SOURCE_INPUT_ERROR);
  }

  if (output.length !== 0) {
    throw new Error(SOURCE_INPUT_ERROR);
  }
}

async function writeManifestAtomically(manifestPath, sourceSha) {
  const resolvedPath = path.resolve(manifestPath);
  const directory = path.dirname(resolvedPath);
  const temporaryPath = path.join(directory, `.${path.basename(resolvedPath)}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ sourceSha })}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function runChildWithSignalForwarding(command, commandArgs, sourceSha) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, commandArgs, {
        stdio: "inherit",
        env: { ...process.env, SOURCE_SHA: sourceSha },
      });
    } catch {
      reject(new Error(COMMAND_ERROR));
      return;
    }

    let settled = false;
    let forwardedSignal;
    const forwardSignal = (signal) => {
      if (forwardedSignal) {
        return;
      }
      forwardedSignal = signal;
      child.kill(signal);
    };
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    const removeSignalListeners = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      removeSignalListeners();
      callback();
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    child.once("error", () => finish(() => reject(new Error(COMMAND_ERROR))));
    child.once("close", (code, signal) => finish(() => resolve({ code, signal })));
  });
}

async function main() {
  const { manifestPath, command, commandArgs } = parseArguments(process.argv.slice(2));
  const sourceSha = resolveSourceSha();
  assertCleanSourceInputs();
  const result = await runChildWithSignalForwarding(command, commandArgs, sourceSha);

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }

  if (manifestPath) {
    await writeManifestAtomically(manifestPath, sourceSha);
  }
}

await main();
