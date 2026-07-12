#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { parseSourceRevision } from "../server/lib/source-revision.js";

const ARGUMENT_ERROR = "Source revision wrapper arguments are invalid.";
const COMMAND_ERROR = "Source revision child command could not be started.";

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

async function main() {
  const { manifestPath, command, commandArgs } = parseArguments(process.argv.slice(2));
  const sourceSha = resolveSourceSha();
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, SOURCE_SHA: sourceSha },
  });

  if (result.error) {
    throw new Error(COMMAND_ERROR);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (manifestPath) {
    await writeManifestAtomically(manifestPath, sourceSha);
  }
}

await main();
