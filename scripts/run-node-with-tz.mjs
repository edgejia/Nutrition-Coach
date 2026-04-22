#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const REQUIRED_TZ = "Asia/Taipei";

const result = spawnSync(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    TZ: REQUIRED_TZ,
  },
});

process.exit(result.status ?? 1);
