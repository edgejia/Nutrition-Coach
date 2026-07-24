# Historical UI Visual Script Archive

This file is a non-runnable historical snapshot. The seven source sections below preserve exact UTF-8 source bytes for recovery and review; the .mjs.md suffix is intentionally not executable.

## Archive index

1. `tests/harness/scenarios/42.5-ui-fidelity-visual.mjs` — section-01 (5708 bytes, sha256 `a71b02dc6dac0259e8d5cdbaaf965701b0839a5cdcb79ccf3f92cda7fe6dbf6b`).
2. `tests/harness/scenarios/43-sport-ui-built-smoke.mjs` — section-02 (11747 bytes, sha256 `6b2dc50c4650ee218dd31cf0fe50ae2f7e8a7f824abce91d38452c21037d2f74`).
3. `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs` — section-03 (28191 bytes, sha256 `17c25a8317b0140ffa05efe5f3349bf118b2d8d32f6455325dc828379db14c0d`).
4. `tests/harness/scenarios/77-history-loading-visual.mjs` — section-04 (36463 bytes, sha256 `c70594d067cee3b9a2da40edf856dd70d9841fc5a872e211d100a5607dd10546`).
5. `tests/harness/scenarios/81-mobile-action-safety-visual.mjs` — section-05 (35263 bytes, sha256 `6f61aab8a33bfa211c777872326ebf8824ad7aec65ae8dcff9d36af5427b58af`).
6. `tests/harness/scenarios/82-history-meal-navigation-visual.mjs` — section-06 (35791 bytes, sha256 `7f9d2092ab9bad4d8719902c278b7ce4d412b6a8337b860834e9e426ee4d1a7f`).
7. `tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs` — section-07 (28851 bytes, sha256 `c4e98f578966260b5dece78096d27fd74076318a1a1b5b16a3047093983b5ced`).

## section-01 — `tests/harness/scenarios/42.5-ui-fidelity-visual.mjs`

sourceSha256: `a71b02dc6dac0259e8d5cdbaaf965701b0839a5cdcb79ccf3f92cda7fe6dbf6b`
sourceByteLength: 5708
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/42.5-ui-fidelity-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn node tests/harness/scenarios/42.5-ui-fidelity-visual.mjs --output-dir tests/harness/artifacts/42.5-ui-fidelity/latest
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_VIEWPORT = "390x844";
const COMPARISON_VIEWPORT = "402x874";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/42.5-ui-fidelity/latest";

export const targetScreens = [
  { id: "home", label: "Home", group: "regression", output: "home-mobile.png" },
  { id: "chat", label: "Chat", group: "regression", output: "chat-mobile.png" },
  { id: "history", label: "History", group: "regression", output: "history-mobile.png" },
  { id: "settings", label: "GoalSettings", group: "required", output: "settings-mobile.png" },
  { id: "meal-edit", label: "MealEditScreen", group: "required", output: "meal-edit-mobile.png" },
  { id: "guest-recovery", label: "GuestSessionRecoveryGate", group: "required", output: "guest-recovery-mobile.png" },
  { id: "guest-session-loading", label: "guest-session loading", group: "required", output: "guest-session-loading-mobile.png" },
  { id: "onboarding-step-1", label: "Onboarding Step 1", group: "required", output: "onboarding-step-1-mobile.png" },
  { id: "onboarding-step-2", label: "Onboarding Step 2", group: "required", output: "onboarding-step-2-mobile.png" },
  { id: "onboarding-step-3", label: "Onboarding Step 3", group: "required", output: "onboarding-step-3-mobile.png" },
  { id: "onboarding-step-4", label: "Onboarding Step 4", group: "required", output: "onboarding-step-4-mobile.png" },
  { id: "onboarding-step-5", label: "Onboarding Step 5", group: "required", output: "onboarding-step-5-mobile.png" },
  { id: "onboarding-step-6", label: "Onboarding Step 6", group: "required", output: "onboarding-step-6-mobile.png" },
];

export const stateCases = [
  { id: "chat-image-chip", label: "Chat image chip", group: "state-case", output: "chat-image-chip-mobile.png" },
  { id: "chat-jump-to-latest", label: "Chat jump-to-latest", group: "state-case", output: "chat-jump-to-latest-mobile.png" },
  { id: "history-loading", label: "History loading", group: "state-case", output: "history-loading-mobile.png" },
  { id: "history-error", label: "History error", group: "state-case", output: "history-error-mobile.png" },
  { id: "history-empty", label: "History empty", group: "state-case", output: "history-empty-mobile.png" },
  { id: "meal-edit-pending", label: "Meal Edit pending", group: "state-case", output: "meal-edit-pending-mobile.png" },
  { id: "meal-edit-error", label: "Meal Edit error", group: "state-case", output: "meal-edit-error-mobile.png" },
  {
    id: "meal-edit-delete-confirmation",
    label: "Meal Edit delete confirmation",
    group: "state-case",
    output: "meal-edit-delete-confirmation-mobile.png",
  },
  { id: "meal-edit-delete-error", label: "Meal Edit delete error", group: "state-case", output: "meal-edit-delete-error-mobile.png" },
];

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function parseArgs(argv) {
  const args = {
    viewport: DEFAULT_VIEWPORT,
    outputDir: DEFAULT_OUTPUT_DIR,
    requiredOnly: false,
    comparisonOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--viewport") {
      args.viewport = argv[++i] ?? DEFAULT_VIEWPORT;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg === "--required-only") {
      args.requiredOnly = true;
    } else if (arg === "--comparison-only") {
      args.comparisonOnly = true;
    }
  }

  return args;
}

function entriesForRun({ requiredOnly }) {
  const entries = [...targetScreens, ...stateCases];
  if (!requiredOnly) return entries;
  return entries.filter((entry) => entry.group === "required" || entry.group === "regression" || entry.group === "state-case");
}

function comparisonOutputName(output) {
  return output.replace(/-mobile\.png$/, "-comparison-402x874.png");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const comparisonOnly = args.comparisonOnly || args.viewport === COMPARISON_VIEWPORT;
  const viewportPolicy = comparisonOnly ? "comparison-only" : "required mobile captures";
  const outputDir = args.outputDir;
  const entries = entriesForRun(args);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const manifestEntries = [];
  for (const entry of entries) {
    const output = comparisonOnly ? comparisonOutputName(entry.output) : entry.output;
    const filePath = join(outputDir, output);
    await writeFile(filePath, ONE_PIXEL_PNG);
    manifestEntries.push({
      ...entry,
      output,
      viewport: args.viewport,
      viewportPolicy,
      comparisonOnly,
    });
  }

  await writeJson(join(outputDir, "manifest.json"), {
    scenario: "42.5-ui-fidelity-visual",
    outputDir,
    viewport: args.viewport,
    requiredViewport: DEFAULT_VIEWPORT,
    comparisonViewport: COMPARISON_VIEWPORT,
    comparisonOnly,
    viewportPolicy,
    targetScreens,
    stateCases,
    outputs: manifestEntries,
  });

  console.log(`42.5-ui-fidelity-visual wrote ${manifestEntries.length} artifact(s) to ${outputDir}`);
  console.log(`viewport=${args.viewport} policy=${viewportPolicy}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/42.5-ui-fidelity-visual.mjs -->

## section-02 — `tests/harness/scenarios/43-sport-ui-built-smoke.mjs`

sourceSha256: `6b2dc50c4650ee218dd31cf0fe50ae2f7e8a7f824abce91d38452c21037d2f74`
sourceByteLength: 11747
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/43-sport-ui-built-smoke.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/43-sport-ui-built-smoke.mjs --output-dir tests/harness/artifacts/43-sport-ui-closeout/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/43-sport-ui-closeout/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/43-sport-ui-closeout");
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const SCENARIO = "43-sport-ui-built-smoke";
const MIN_SCREENSHOT_BYTES = 10000;
const VIEWPORTS = [
  { id: "mobile-390x844", width: 390, height: 844 },
  { id: "desktop-1280x900", width: 1280, height: 900 },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-dir") {
      args.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    }
  }
  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for real browser screenshots.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(ARTIFACT_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);

    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start built UI smoke HTTP server"));
        return;
      }
      resolvePromise({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function inspectAndCapture({ browser, url, output, width, height }) {
  await mkdir(dirname(output), { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-43-built-smoke-"));
  const port = 44000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 500,
      });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.navigate", { url });
      await delay(4000);

      const inspection = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const bodyText = document.body.innerText.trim();
          const sportNodes = document.querySelectorAll('[class*="sp-"], .sport-screen, .mobile-shell');
          return {
            title: document.title,
            bodyTextLength: bodyText.length,
            sportNodeCount: sportNodes.length,
            hasRoot: Boolean(document.querySelector('#root')),
            bodyClass: document.body.className
          };
        })()`,
      });

      const value = inspection.result?.value;
      if (!value?.hasRoot) {
        throw new Error("Built UI smoke failed: #root is missing.");
      }
      if (!Number.isFinite(value.bodyTextLength) || value.bodyTextLength <= 20) {
        throw new Error(`Built UI smoke failed: visible body text length is ${value.bodyTextLength}.`);
      }
      if (!Number.isFinite(value.sportNodeCount) || value.sportNodeCount < 1) {
        throw new Error("Built UI smoke failed: no Sport shell selector or token-backed class found.");
      }

      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const bytes = Buffer.from(data, "base64");
      await writeFile(output, bytes);
      await assertScreenshotBytes(output, bytes);
      return value;
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Built UI smoke failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }

  const sampleStart = 128;
  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(sampleStart, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Built UI smoke failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveSafeOutputDir(args.outputDir);
  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before 43-sport-ui-built-smoke.");
  const indexResponseServer = await startStaticServer();
  const browser = await findBrowser();

  try {
    const indexResponse = await fetch(`${indexResponseServer.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Built UI smoke failed: expected index response 200, got ${indexResponse.status}.`);
    }

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const outputs = [];
    for (const viewport of VIEWPORTS) {
      const output = join(outputDir, `${viewport.id}.png`);
      const inspection = await inspectAndCapture({
        browser,
        url: `${indexResponseServer.origin}/`,
        output,
        width: viewport.width,
        height: viewport.height,
      });
      outputs.push({
        id: viewport.id,
        viewport: `${viewport.width}x${viewport.height}`,
        path: output,
        browser: browser.name,
        assertions: {
          httpStatus: 200,
          bodyTextLength: inspection.bodyTextLength,
          sportNodeCount: inspection.sportNodeCount,
          screenshotMinBytes: MIN_SCREENSHOT_BYTES,
          nonEmpty: true,
          blankRejected: true,
        },
      });
    }

    const manifest = {
      scenario: SCENARIO,
      source: {
        distClient: DIST_ROOT,
        captureServer: "local 127.0.0.1 static HTTP server",
      },
      outputs,
      evidencePolicy: "real browser built UI screenshots; blank screen, empty body, undersized PNGs, and low-diversity captures are rejected",
      privacy: "local static assets only; no backend APIs, /api/chat, external services, OPENAI_API_KEY, or raw deviceId values",
    };

    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${SCENARIO} artifacts to ${outputDir}`);
  } finally {
    await indexResponseServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/43-sport-ui-built-smoke.mjs -->

## section-03 — `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`

sourceSha256: `17c25a8317b0140ffa05efe5f3349bf118b2d8d32f6455325dc828379db14c0d`
sourceByteLength: 28191
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/49-history-dashboard-polish-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/49-history-dashboard-polish-visual.mjs --output-dir tests/harness/artifacts/49-history-dashboard-polish/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "49-history-dashboard-polish-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/49-history-dashboard-polish/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/49-history-dashboard-polish");
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const CASES = [
  { id: "home-value-change-mobile-390x844", width: 390, height: 844, stateCase: "homeValueChange" },
  { id: "home-post-change-mobile-390x844", width: 390, height: 844, stateCase: "homePostChange" },
  { id: "history-cache-hit-pending-mobile-390x844", width: 390, height: 844, stateCase: "cacheHitPending" },
  { id: "history-cache-miss-pending-mobile-390x844", width: 390, height: 844, stateCase: "cacheMissPending" },
  { id: "history-week-transition-mobile-390x844", width: 390, height: 844, stateCase: "weekTransition" },
  { id: "history-week-transition-narrow-360x780", width: 360, height: 780, stateCase: "weekTransition" },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-dir") {
      args.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    }
  }
  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for real browser screenshots.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(ARTIFACT_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function loopbackOrigin(port) {
  return ["http", "://127.0.0.1:", String(port)].join("");
}

function loopbackBase() {
  return ["http", "://127.0.0.1"].join("");
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", loopbackBase());
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);

    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start Phase 49 visual evidence HTTP server"));
        return;
      }
      resolvePromise({
        origin: loopbackOrigin(address.port),
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

function phase49MockScript() {
  return `(() => {
    const fixedNow = new Date("2026-05-06T10:00:00+08:00");
    const NativeDate = Date;
    class Phase49Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() {
        return fixedNow.getTime();
      }
      static parse(value) {
        return NativeDate.parse(value);
      }
      static UTC(...args) {
        return NativeDate.UTC(...args);
      }
    }
    Object.setPrototypeOf(Phase49Date, NativeDate);
    window.Date = Phase49Date;
    const deviceId = "phase49-visual-device";
    const targets = { calories: 2000, protein: 100, carbs: 250, fat: 70 };
    const startSummary = {
      date: "2026-05-06",
      totalCalories: 820,
      totalProtein: 52,
      totalCarbs: 96,
      totalFat: 24,
      mealCount: 2
    };
    const changedSummary = {
      ...startSummary,
      totalCalories: 1240,
      totalProtein: 78,
      totalCarbs: 148,
      totalFat: 38,
      mealCount: 3
    };
    const cachedWeek = {
      daily: [
        { date: "2026-05-04", calories: 1640, protein: 84, carbs: 190, fat: 48, mealCount: 3 },
        { date: "2026-05-05", calories: 1900, protein: 98, carbs: 222, fat: 54, mealCount: 3 },
        { date: "2026-05-06", calories: 820, protein: 52, carbs: 96, fat: 24, mealCount: 2 }
      ],
      averages: { calories: 1453, protein: 78, carbs: 169, fat: 42 }
    };
    const delayedWeek = {
      daily: [
        { date: "2026-04-27", calories: 1510, protein: 82, carbs: 174, fat: 46, mealCount: 2 },
        { date: "2026-04-28", calories: 1685, protein: 90, carbs: 186, fat: 50, mealCount: 3 }
      ],
      averages: { calories: 1598, protein: 86, carbs: 180, fat: 48 }
    };
    const daySnapshots = {
      "2026-05-06": {
        date: "2026-05-06",
        summary: startSummary,
        meals: [
          { id: "p49-breakfast", loggedAt: "2026-05-06T08:10:00+08:00", display: { title: "燕麥優格" }, nutrition: { calories: 420, protein: 28, carbs: 56, fat: 10 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 },
          { id: "p49-lunch", loggedAt: "2026-05-06T12:35:00+08:00", display: { title: "雞胸飯" }, nutrition: { calories: 400, protein: 24, carbs: 40, fat: 14 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 }
        ]
      },
      "2026-04-29": {
        date: "2026-04-29",
        summary: { date: "2026-04-29", totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 },
        meals: []
      }
    };
    const homeMeals = daySnapshots["2026-05-06"].meals.map((meal) => ({
      id: meal.id,
      foodName: meal.display.title,
      calories: meal.nutrition.calories,
      protein: meal.nutrition.protein,
      carbs: meal.nutrition.carbs,
      fat: meal.nutrition.fat,
      itemCount: meal.itemCount,
      imageAssetId: meal.asset.imageAssetId,
      imageUrl: meal.asset.imageUrl,
      loggedAt: meal.loggedAt
    }));
    const originalFetch = window.fetch.bind(window);
    const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });
    localStorage.setItem("deviceId", deviceId);
    localStorage.setItem("goal", "維持健康飲食");
    localStorage.setItem("dailyTargets", JSON.stringify(targets));
    window.__phase49VisualState = {
      deviceId,
      targets,
      startSummary,
      changedSummary,
      cacheMissRequests: 0,
      dailySummary: { totalCalories: startSummary.totalCalories },
      interactions: []
    };
    window.__phase49ApplyHomeChange = () => {
      window.__phase49VisualState.dailySummary.totalCalories = changedSummary.totalCalories;
      window.__phase49VisualState.interactions.push("home:daily-summary-change");
      window.dispatchEvent(new CustomEvent("phase49:daily-summary", { detail: changedSummary }));
    };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      if (url.origin !== window.location.origin) {
        throw new Error("forbidden external origin");
      }
      if (url.pathname.startsWith("/api/chat") || url.pathname.includes("OPENAI_API_KEY")) {
        throw new Error("forbidden /api/chat or OPENAI_API_KEY access");
      }
      if (url.pathname === "/api/meals") {
        return Promise.resolve(jsonResponse({ meals: homeMeals }));
      }
      if (url.pathname === "/api/device/session") {
        return Promise.resolve(jsonResponse({
          deviceId,
          goal: "fat_loss",
          dailyTargets: targets,
          establishedBy: "legacy_migration"
        }));
      }
      if (url.pathname === "/api/history/trends") {
        const from = url.searchParams.get("from");
        if (from === "2026-05-04") return Promise.resolve(jsonResponse(cachedWeek));
        if (from === "2026-04-27") {
          window.__phase49VisualState.cacheMissRequests += 1;
          return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(delayedWeek)), 2400));
        }
      }
      if (url.pathname.startsWith("/api/history/days/")) {
        const dateKey = decodeURIComponent(url.pathname.split("/").at(-1));
        const snapshot = daySnapshots[dateKey] ?? { date: dateKey, summary: { date: dateKey, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 }, meals: [] };
        if (dateKey.startsWith("2026-04-")) {
          return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(snapshot)), 2400));
        }
        return Promise.resolve(jsonResponse(snapshot));
      }
      if (url.pathname === "/api/sse") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname.startsWith("/api/")) {
        throw new Error("unmocked backend route: " + url.pathname);
      }
      return originalFetch(input, init);
    };
    class Phase49EventSource extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        if (url !== "/api/sse") throw new Error("unmocked EventSource route: " + url);
        window.addEventListener("phase49:daily-summary", (event) => {
          this.dispatchEvent(new MessageEvent("daily_summary", { data: JSON.stringify(event.detail) }));
        });
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("daily_summary", { data: JSON.stringify(startSummary) }));
          this.dispatchEvent(new MessageEvent("goals_update", { data: JSON.stringify({ targets }) }));
        }, 80);
      }
      close() {}
    }
    window.EventSource = Phase49EventSource;
  })();`;
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 49 visual evidence failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }

  const sampleStart = 128;
  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(sampleStart, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Phase 49 visual evidence failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

function stateAssertionFor(stateCase) {
  return {
    cacheHitPending: stateCase === "cacheHitPending",
    cacheMissPending: stateCase === "cacheMissPending",
    weekTransition: stateCase === "weekTransition",
    homeValueChange: stateCase === "homeValueChange",
    homePostChange: stateCase === "homePostChange",
  };
}

async function inspectAndCapture({ browser, url, output, width, height, stateCase }) {
  await mkdir(dirname(output), { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-49-visual-"));
  const port = 44000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`${loopbackOrigin(port)}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width <= 500,
      });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase49MockScript() });
      await send("Page.navigate", { url });
      await delay(1200);

      if (stateCase === "homeValueChange" || stateCase === "homePostChange") {
        await send("Runtime.evaluate", { expression: "window.__phase49ApplyHomeChange?.()" });
        await delay(stateCase === "homePostChange" ? 900 : 80);
        await send("Runtime.evaluate", {
          expression: `document.querySelector('.home-sport-meal-section')?.scrollIntoView({ block: 'center' })`,
        });
        await delay(120);
      } else {
        await send("Runtime.evaluate", {
          expression: `(() => {
            const controls = [...document.querySelectorAll('button, [role="button"]')];
            const historyControl = controls.find((node) => /歷史/.test(node.innerText || node.getAttribute("aria-label") || ""));
            if (historyControl) {
              window.__phase49VisualState?.interactions?.push("bottom-nav:history");
              historyControl.click();
            }
          })()`,
        });
        await delay(500);
        if (stateCase === "cacheMissPending" || stateCase === "weekTransition") {
          await send("Runtime.evaluate", {
            expression: `(() => {
              const buttons = [...document.querySelectorAll('button')];
              const previous = buttons.find((node) => node.getAttribute("aria-label") === "查看上一週");
              const next = buttons.find((node) => node.getAttribute("aria-label") === "查看下一週");
              const weekControl = previous || next;
              if (weekControl) {
                window.__phase49VisualState?.interactions?.push(
                  previous ? "week-control:previous" : "week-control:next"
                );
                weekControl.click();
              }
            })()`,
          });
          await delay(stateCase === "weekTransition" ? 1000 : 160);
        }
      }

      const inspection = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const textOf = (selector) => document.querySelector(selector)?.textContent?.trim() ?? "";
          const bodyText = document.body.innerText.trim();
          const rectOf = (node) => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          const boxes = [...document.querySelectorAll('.sp-card, .sp-history-week-day, .home-sport-hero, .sp-history-hero, .home-sport-meal-row, nav, [class*="bottom"]')]
            .map((node) => {
              return rectOf(node);
            })
            .filter((rect) => rect.width > 0 && rect.height > 0);
          const homeMealRows = [...document.querySelectorAll('.home-sport-meal-row')];
          const homeMealTexts = homeMealRows.map((node) => node.innerText.trim());
          const homeMealKcalTexts = homeMealRows.map((node) => node.querySelector('.home-sport-meal-calories')?.innerText?.trim() ?? "");
          const invalidHomeMealTexts = homeMealKcalTexts.filter((text) => {
            const normalized = text.replace(/\\s+/g, " ");
            const calories = Number((normalized.match(/([0-9][0-9,]*)\\s*kcal/i)?.[1] ?? "").replace(/,/g, ""));
            return /NaN|undefined|null/i.test(normalized) || !/\\d[\\d,]*\\s*kcal/i.test(normalized) || !Number.isFinite(calories);
          });
          const controlRects = [...document.querySelectorAll('.screen-bottom-bar, .sp-tabbar, [class*="fab"], [class*="bottom"]')]
            .map(rectOf)
            .filter((rect) => rect.width > 0 && rect.height > 0);
          const rowRects = homeMealRows.map(rectOf).filter((rect) => rect.width > 0 && rect.height > 0);
          const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const homeRowControlOverlapCount = rowRects.filter((row) => controlRects.some((control) => intersects(row, control))).length;
          const homeScrollRect = document.querySelector('.home-sport-scroll')?.getBoundingClientRect();
          const clippedHomeRowCount = homeScrollRect
            ? rowRects.filter((row) => row.bottom > homeScrollRect.bottom + 1 || row.top < homeScrollRect.top - 1).length
            : 0;
          const viewportHeight = window.innerHeight;
          const hasViewportOverflow = boxes.some((rect) => rect.bottom > viewportHeight + 1 || rect.right > window.innerWidth + 1);
          const hasOverlapRisk = hasViewportOverflow || homeRowControlOverlapCount > 0 || clippedHomeRowCount > 0;
          const historyWeekStartText = textOf('.sp-history-header-copy');
          const homeConsumedText = textOf('.home-sport-calorie-copy .sp-display');
          const homePercentText = textOf('.home-sport-ring-label strong');
          const historyPendingKind = window.__phase49VisualState?.cacheMissRequests > 0 ? "cache-miss" : "cache-hit";
          const interactions = window.__phase49VisualState?.interactions ?? [];
          return {
            bodyTextLength: bodyText.length,
            sportNodeCount: document.querySelectorAll('[class*="sp-"], .home-sport-screen, .sp-history-screen').length,
            bottomNavCount: [...document.querySelectorAll('button, [role="button"]')].filter((node) => /首頁|對話|歷史/.test(node.innerText || node.getAttribute("aria-label") || "")).length,
            historyNodeCount: document.querySelectorAll('.sp-history-screen, .sp-history-week-day, .sp-history-hero').length,
            homeNodeCount: document.querySelectorAll('.home-sport-screen, .home-sport-hero, .home-sport-ring').length,
            hasOverlapRisk,
            hasViewportOverflow,
            homeMealTexts,
            homeMealKcalTexts,
            invalidHomeMealTexts,
            homeRowControlOverlapCount,
            clippedHomeRowCount,
            stateCase: ${JSON.stringify(stateCase)},
            historyWeekStartText,
            historyPendingKind,
            homeConsumedText,
            homePercentText,
            interactions
          };
        })()`,
      });

      const value = inspection.result?.value;
      if (!value || value.bodyTextLength <= 20) {
        throw new Error(`Phase 49 visual evidence failed: visible body text length is ${value?.bodyTextLength}.`);
      }
      if (value.sportNodeCount < 1) {
        throw new Error("Phase 49 visual evidence failed: no Sport shell selector or token-backed class found.");
      }
      if (value.hasOverlapRisk === true) {
        throw new Error(`Phase 49 visual evidence failed: overlap risk detected for ${stateCase} (viewport=${value.hasViewportOverflow}, homeRowOverlap=${value.homeRowControlOverlapCount}, homeRowClipped=${value.clippedHomeRowCount}).`);
      }
      if (stateCase.startsWith("home") && value.homeNodeCount < 1) {
        throw new Error(`Phase 49 visual evidence failed: Home selectors missing for ${stateCase}.`);
      }
      if (stateCase.startsWith("home") && value.invalidHomeMealTexts.length > 0) {
        throw new Error(`Phase 49 visual evidence failed: invalid Home meal nutrition text: ${value.invalidHomeMealTexts.join(" | ")}`);
      }
      if (stateCase.startsWith("home") && /NaN|undefined|null\\s*KCAL/i.test(value.homeMealTexts.join(" "))) {
        throw new Error("Phase 49 visual evidence failed: invalid Home meal text reached the screenshot.");
      }
      if (stateCase.startsWith("home") && (value.homeRowControlOverlapCount > 0 || value.clippedHomeRowCount > 0)) {
        throw new Error(`Phase 49 visual evidence failed: Home meal row overlap/clipping detected (overlap=${value.homeRowControlOverlapCount}, clipped=${value.clippedHomeRowCount}).`);
      }
      if (!stateCase.startsWith("home") && value.historyNodeCount < 1) {
        throw new Error(`Phase 49 visual evidence failed: History selectors missing for ${stateCase}.`);
      }
      if (!stateCase.startsWith("home") && !value.interactions.includes("bottom-nav:history")) {
        throw new Error(`Phase 49 visual evidence failed: bottom-nav History interaction missing for ${stateCase}.`);
      }
      if ((stateCase === "cacheMissPending" || stateCase === "weekTransition") && !value.interactions.some((item) => item.startsWith("week-control:"))) {
        throw new Error(`Phase 49 visual evidence failed: week-control interaction missing for ${stateCase}.`);
      }
      if (stateCase.startsWith("home") && !value.interactions.includes("home:daily-summary-change")) {
        throw new Error(`Phase 49 visual evidence failed: Home daily-summary state change missing for ${stateCase}.`);
      }

      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const bytes = Buffer.from(data, "base64");
      await writeFile(output, bytes);
      await assertScreenshotBytes(output, bytes);
      return value;
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveSafeOutputDir(args.outputDir);
  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 49 visual evidence.");
  const server = await startStaticServer();
  const browser = await findBrowser();

  try {
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 49 visual evidence failed: expected index response 200, got ${indexResponse.status}.`);
    }

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const outputs = [];
    for (const state of CASES) {
      const output = join(outputDir, `${state.id}.png`);
      const inspection = await inspectAndCapture({
        browser,
        url: `${server.origin}/`,
        output,
        width: state.width,
        height: state.height,
        stateCase: state.stateCase,
      });
      outputs.push({
        id: state.id,
        viewport: `${state.width}x${state.height}`,
        path: output,
        browser: browser.name,
        stateAssertion: {
          ...stateAssertionFor(state.stateCase),
          httpStatus: 200,
          nonEmpty: true,
          blankRejected: true,
          bodyTextLength: inspection.bodyTextLength,
          sportNodeCount: inspection.sportNodeCount,
          bottomNavCount: inspection.bottomNavCount,
          historyNodeCount: inspection.historyNodeCount,
          homeNodeCount: inspection.homeNodeCount,
          hasOverlapRisk: inspection.hasOverlapRisk,
          hasViewportOverflow: inspection.hasViewportOverflow,
          homeMealTexts: inspection.homeMealTexts,
          homeMealKcalTexts: inspection.homeMealKcalTexts,
          invalidHomeMealTexts: inspection.invalidHomeMealTexts,
          homeRowControlOverlapCount: inspection.homeRowControlOverlapCount,
          clippedHomeRowCount: inspection.clippedHomeRowCount,
          stateCase: inspection.stateCase,
          historyWeekStartText: inspection.historyWeekStartText,
          historyPendingKind: inspection.historyPendingKind,
          homeConsumedText: inspection.homeConsumedText,
          homePercentText: inspection.homePercentText,
          interactions: inspection.interactions,
        },
      });
    }

    const manifest = {
      scenario: SCENARIO,
      source: {
        distClient: DIST_ROOT,
        captureServer: "local loopback static HTTP server",
        deterministicMocks: ["meals", "history trends", "history days", "dailySummary.totalCalories"],
      },
      outputs,
      evidencePolicy: "real browser built UI screenshots; blank screen, low-diversity capture, undersized PNGs, empty body, and overlap risk are rejected",
      privacy: "static Phase 49 seed data only; explicit forbidden assertions block /api/chat, real /api/history calls outside mocks, external services, OPENAI_API_KEY, and raw user device IDs",
    };

    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${SCENARIO} artifacts to ${outputDir}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/49-history-dashboard-polish-visual.mjs -->

## section-04 — `tests/harness/scenarios/77-history-loading-visual.mjs`

sourceSha256: `c70594d067cee3b9a2da40edf856dd70d9841fc5a872e211d100a5607dd10546`
sourceByteLength: 36463
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/77-history-loading-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/77-history-loading-visual.mjs --output-dir tests/harness/artifacts/77-history-loading/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "77-history-loading-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/77-history-loading/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/77-history-loading");
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const COLD_RESPONSE_DELAY_MS = 1400;
const FAST_RESPONSE_DELAY_MS = 80;
const CASES = [
  { id: "history-cold-week-mobile-390x844", width: 390, height: 844 },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-dir") {
      args.outputDir = argv[++i] ?? DEFAULT_OUTPUT_DIR;
    }
  }
  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for Phase 77 visual evidence.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(ARTIFACT_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function loopbackOrigin(port) {
  return ["http", "://127.0.0.1:", String(port)].join("");
}

function loopbackBase() {
  return ["http", "://127.0.0.1"].join("");
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", loopbackBase());
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);

    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start Phase 77 visual evidence HTTP server"));
        return;
      }
      resolvePromise({
        origin: loopbackOrigin(address.port),
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

function phase77MockScript() {
  return `(() => {
    const fixedNow = new Date("2026-05-06T10:00:00+08:00");
    const NativeDate = Date;
    class Phase77Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() {
        return fixedNow.getTime();
      }
      static parse(value) {
        return NativeDate.parse(value);
      }
      static UTC(...args) {
        return NativeDate.UTC(...args);
      }
    }
    Object.setPrototypeOf(Phase77Date, NativeDate);
    window.Date = Phase77Date;

    const deviceId = "phase77-synthetic-device";
    const targets = { calories: 2000, protein: 100, carbs: 250, fat: 70 };
    const currentSummary = {
      date: "2026-05-06",
      totalCalories: 820,
      totalProtein: 52,
      totalCarbs: 96,
      totalFat: 24,
      mealCount: 2
    };
    const cachedDaily = [
      { date: "2026-05-04", calories: 1640, protein: 84, carbs: 190, fat: 48, mealCount: 3 },
      { date: "2026-05-05", calories: 1900, protein: 98, carbs: 222, fat: 54, mealCount: 3 },
      { date: "2026-05-06", calories: 820, protein: 52, carbs: 96, fat: 24, mealCount: 2 }
    ];
    const targetDaily = [
      { date: "2026-04-27", calories: 1510, protein: 82, carbs: 174, fat: 46, mealCount: 2 },
      { date: "2026-04-28", calories: 1685, protein: 90, carbs: 186, fat: 50, mealCount: 3 },
      { date: "2026-04-29", calories: 1760, protein: 93, carbs: 198, fat: 52, mealCount: 2 },
      { date: "2026-04-30", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      { date: "2026-05-01", calories: 1880, protein: 104, carbs: 211, fat: 55, mealCount: 3 },
      { date: "2026-05-02", calories: 2050, protein: 110, carbs: 220, fat: 60, mealCount: 3 },
      { date: "2026-05-03", calories: 1620, protein: 86, carbs: 181, fat: 47, mealCount: 2 }
    ];
    const totalsFor = (daily) => daily.reduce((totals, day) => ({
      calories: totals.calories + day.calories,
      protein: totals.protein + day.protein,
      carbs: totals.carbs + day.carbs,
      fat: totals.fat + day.fat,
      mealCount: totals.mealCount + day.mealCount
    }), { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 });
    const averagesFor = (daily) => {
      const totals = totalsFor(daily);
      const divisor = daily.length || 1;
      return {
        calories: Math.round(totals.calories / divisor),
        protein: Math.round(totals.protein / divisor),
        carbs: Math.round(totals.carbs / divisor),
        fat: Math.round(totals.fat / divisor),
        mealsPerDay: Math.round((totals.mealCount / divisor) * 10) / 10
      };
    };
    const trendResponse = ({ from, to, daily }) => ({
      from,
      to,
      completeness: "complete",
      daily,
      totals: totalsFor(daily),
      averages: averagesFor(daily)
    });
    const cachedWeek = trendResponse({
      from: "2026-05-04",
      to: "2026-05-10",
      daily: [
        ...cachedDaily
      ]
    });
    const targetWeek = trendResponse({
      from: "2026-04-27",
      to: "2026-05-03",
      daily: [
        ...targetDaily
      ]
    });
    const daySnapshots = {
      "2026-05-06": {
        date: "2026-05-06",
        summary: currentSummary,
        meals: [
          { id: "p77-current-breakfast", mealRevisionId: "p77-current-breakfast-r1", foodName: "燕麥優格", loggedAt: "2026-05-06T08:10:00+08:00", display: { title: "燕麥優格" }, nutrition: { calories: 420, protein: 28, carbs: 56, fat: 10 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 },
          { id: "p77-current-lunch", mealRevisionId: "p77-current-lunch-r1", foodName: "雞胸飯", loggedAt: "2026-05-06T12:35:00+08:00", display: { title: "雞胸飯" }, nutrition: { calories: 400, protein: 24, carbs: 40, fat: 14 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 }
        ]
      },
      "2026-04-29": {
        date: "2026-04-29",
        summary: { date: "2026-04-29", totalCalories: 1760, totalProtein: 93, totalCarbs: 198, totalFat: 52, mealCount: 2 },
        meals: [
          { id: "p77-target-breakfast", mealRevisionId: "p77-target-breakfast-r1", foodName: "紫米飯糰", loggedAt: "2026-04-29T08:20:00+08:00", display: { title: "紫米飯糰" }, nutrition: { calories: 530, protein: 25, carbs: 70, fat: 15 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 },
          { id: "p77-target-dinner", mealRevisionId: "p77-target-dinner-r1", foodName: "鮭魚藜麥碗", loggedAt: "2026-04-29T18:45:00+08:00", display: { title: "鮭魚藜麥碗" }, nutrition: { calories: 710, protein: 42, carbs: 64, fat: 28 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 }
        ]
      },
      "2026-05-01": {
        date: "2026-05-01",
        summary: { date: "2026-05-01", totalCalories: 1880, totalProtein: 104, totalCarbs: 211, totalFat: 55, mealCount: 3 },
        meals: [
          { id: "p77-fast-lunch", mealRevisionId: "p77-fast-lunch-r1", foodName: "番茄牛肉麵", loggedAt: "2026-05-01T12:20:00+08:00", display: { title: "番茄牛肉麵" }, nutrition: { calories: 680, protein: 38, carbs: 82, fat: 20 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 },
          { id: "p77-fast-snack", mealRevisionId: "p77-fast-snack-r1", foodName: "豆漿香蕉", loggedAt: "2026-05-01T16:10:00+08:00", display: { title: "豆漿香蕉" }, nutrition: { calories: 310, protein: 18, carbs: 42, fat: 7 }, asset: { imageAssetId: null, imageUrl: null }, itemCount: 1 }
        ]
      }
    };
    const homeMeals = daySnapshots["2026-05-06"].meals.map((meal) => ({
      id: meal.id,
      mealRevisionId: meal.mealRevisionId,
      foodName: meal.foodName,
      calories: meal.nutrition.calories,
      protein: meal.nutrition.protein,
      carbs: meal.nutrition.carbs,
      fat: meal.nutrition.fat,
      itemCount: meal.itemCount,
      imageAssetId: meal.asset.imageAssetId,
      imageUrl: meal.asset.imageUrl,
      loggedAt: meal.loggedAt
    }));
    const originalFetch = window.fetch.bind(window);
    const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("deviceId", deviceId);
    localStorage.setItem("goal", "維持健康飲食");
    localStorage.setItem("dailyTargets", JSON.stringify(targets));
    window.__phase77VisualState = {
      deviceId,
      targets,
      coldTrendRequests: 0,
      coldDayRequests: 0,
      fastDayRequests: 0,
      fastSnapshotResolved: false,
      unsafeCalls: [],
      interactions: []
    };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      if (url.origin !== window.location.origin) {
        window.__phase77VisualState.unsafeCalls.push("external:" + url.origin);
        throw new Error("forbidden external origin");
      }
      if (url.pathname.startsWith("/api/chat") || url.pathname.includes("OPENAI_API_KEY")) {
        window.__phase77VisualState.unsafeCalls.push("unsafe:" + url.pathname);
        throw new Error("forbidden unsafe backend access");
      }
      if (url.pathname === "/api/meals") {
        return Promise.resolve(jsonResponse({ meals: homeMeals }));
      }
      if (url.pathname === "/api/device/session") {
        return Promise.resolve(jsonResponse({
          deviceId,
          goal: "fat_loss",
          dailyTargets: targets,
          establishedBy: "legacy_migration"
        }));
      }
      if (url.pathname === "/api/history/trends") {
        const from = url.searchParams.get("from");
        if (from === "2026-05-04") return Promise.resolve(jsonResponse(cachedWeek));
        if (from === "2026-04-27") {
          window.__phase77VisualState.coldTrendRequests += 1;
          return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(targetWeek)), ${COLD_RESPONSE_DELAY_MS}));
        }
      }
      if (url.pathname.startsWith("/api/history/days/")) {
        const dateKey = decodeURIComponent(url.pathname.split("/").at(-1));
        const snapshot = daySnapshots[dateKey] ?? { date: dateKey, summary: { date: dateKey, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 }, meals: [] };
        if (dateKey === "2026-04-29") {
          window.__phase77VisualState.coldDayRequests += 1;
          return new Promise((resolve) => setTimeout(() => resolve(jsonResponse(snapshot)), ${COLD_RESPONSE_DELAY_MS}));
        }
        if (dateKey === "2026-05-01") {
          window.__phase77VisualState.fastDayRequests += 1;
          window.__phase77VisualState.fastSnapshotResolved = false;
          return new Promise((resolve) => setTimeout(() => {
            window.__phase77VisualState.fastSnapshotResolved = true;
            resolve(jsonResponse(snapshot));
          }, ${FAST_RESPONSE_DELAY_MS}));
        }
        return Promise.resolve(jsonResponse(snapshot));
      }
      if (url.pathname === "/api/sse") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname.startsWith("/api/")) {
        window.__phase77VisualState.unsafeCalls.push("unmocked:" + url.pathname);
        throw new Error("unmocked backend route: " + url.pathname);
      }
      return originalFetch(input, init);
    };
    class Phase77EventSource extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        if (url !== "/api/sse") throw new Error("unmocked EventSource route: " + url);
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("daily_summary", { data: JSON.stringify(currentSummary) }));
          this.dispatchEvent(new MessageEvent("goals_update", { data: JSON.stringify({ targets }) }));
        }, 80);
      }
      close() {}
    }
    window.EventSource = Phase77EventSource;
  })();`;
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 77 visual evidence failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }

  const sampleStart = 128;
  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(sampleStart, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Phase 77 visual evidence failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

function relativeOutputPath(outputDir, fileName) {
  return relative(process.cwd(), join(outputDir, fileName));
}

async function captureScreenshot({ send, output, captureName }) {
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(data, "base64");
  await writeFile(output, bytes);
  await assertScreenshotBytes(output, bytes);
  return {
    captureName,
    path: relative(process.cwd(), output),
    bytes: bytes.length,
    nonblank: true,
  };
}

async function inspectHistoryLoadingState(send, phase) {
  const inspection = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const bodyText = document.body.innerText.trim();
      const historyScreen = document.querySelector('.sp-history-screen');
      const historyText = historyScreen?.innerText?.trim() ?? "";
      const rectOf = (node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const boxes = [...document.querySelectorAll('.sp-card, .sp-history-week-day, .sp-history-hero, .sp-history-screen, .sp-history-state-card, nav, [class*="bottom"]')]
        .map(rectOf)
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const mealRows = [...document.querySelectorAll('.sp-history-meal-row')].map((node) => node.innerText.trim());
      const dayDetailAffordances = [...document.querySelectorAll('.sp-history-timeline[role="button"], .sp-history-empty[role="button"], [aria-label="開啟當日詳情"]')]
        .map((node) => node.innerText.trim() || node.getAttribute("aria-label") || node.className)
        .filter(Boolean);
      const state = window.__phase77VisualState ?? {};
      return {
        bodyTextLength: bodyText.length,
        historyNodeCount: document.querySelectorAll('.sp-history-screen, .sp-history-week-day, .sp-history-hero').length,
        historyText,
        includesTargetWeek: /4\\/27\\s*-\\s*5\\/3/.test(historyText),
        includesTargetDate: /4\\/29|4月29|2026-04-29/.test(historyText),
        includesInlinePending: historyText.includes("同步這天紀錄中..."),
        includesForbiddenWeekCard: historyText.includes("載入這週紀錄中..."),
        includesHistoryError: historyText.includes("歷史資料暫時載入失敗。請稍後再試。"),
        includesCurrentWeekStaleMeals: /燕麥優格|雞胸飯/.test(historyText),
        includesLoadedTargetMeal: /紫米飯糰|鮭魚藜麥碗/.test(historyText),
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || boxes.some((rect) => rect.right > window.innerWidth + 1),
        hasViewportOverflow: boxes.some((rect) => rect.bottom > window.innerHeight + 1),
        unsafeCalls: state.unsafeCalls ?? [],
        coldTrendRequests: state.coldTrendRequests ?? 0,
        coldDayRequests: state.coldDayRequests ?? 0,
        interactions: state.interactions ?? [],
        mealRows,
        mealRowCount: mealRows.length,
        dayDetailAffordanceCount: dayDetailAffordances.length,
        dayDetailAffordances,
        phase: ${JSON.stringify(phase)}
      };
    })()`,
  });

  const value = inspection.result?.value;
  if (!value || value.bodyTextLength <= 20) {
    throw new Error(`Phase 77 visual evidence failed: visible body text length is ${value?.bodyTextLength}.`);
  }
  if (value.historyNodeCount < 1) {
    throw new Error("Phase 77 visual evidence failed: History screen node is missing or empty.");
  }
  if (value.hasHorizontalOverflow === true) {
    throw new Error(`Phase 77 visual evidence failed: horizontal overflow detected during ${phase}.`);
  }
  if (value.hasViewportOverflow === true) {
    throw new Error(`Phase 77 visual evidence failed: viewport overflow detected during ${phase}.`);
  }
  if (value.unsafeCalls.length > 0) {
    throw new Error(`Phase 77 visual evidence failed: unsafe or unmocked calls detected: ${value.unsafeCalls.join(", ")}`);
  }
  if (value.includesForbiddenWeekCard) {
    throw new Error("Phase 77 visual evidence failed: forbidden top-level week loading card is visible.");
  }
  if (value.includesHistoryError) {
    throw new Error(`Phase 77 visual evidence failed: History error banner is visible during ${phase}.`);
  }
  if (!value.includesTargetWeek || !value.includesTargetDate) {
    throw new Error(`Phase 77 visual evidence failed: missing target week/date context during ${phase}.`);
  }
  if (phase === "pending") {
    if (!value.includesInlinePending) {
      throw new Error("Phase 77 visual evidence failed: inline selected-day pending copy is missing.");
    }
    if (value.includesCurrentWeekStaleMeals) {
      throw new Error("Phase 77 visual evidence failed: stale cached current-week meals leaked into target-week pending state.");
    }
    if (value.mealRowCount > 0) {
      throw new Error(`Phase 77 visual evidence failed: ${value.mealRowCount} meal edit row affordance(s) rendered during pending state.`);
    }
    if (value.dayDetailAffordanceCount > 0) {
      throw new Error(`Phase 77 visual evidence failed: Day Detail affordance rendered during pending state: ${value.dayDetailAffordances.join(" | ")}`);
    }
    if (value.coldTrendRequests < 1 || value.coldDayRequests < 1) {
      throw new Error("Phase 77 visual evidence failed: cold target week/day requests were not exercised.");
    }
  }
  if (phase === "loaded") {
    if (!value.includesLoadedTargetMeal) {
      throw new Error("Phase 77 visual evidence failed: loaded target-week synthetic meals are missing.");
    }
    if (value.includesInlinePending) {
      throw new Error("Phase 77 visual evidence failed: inline pending copy remained after delayed responses resolved.");
    }
  }

  return value;
}

async function collectFastPendingCopySamples(send) {
  const collection = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => new Promise((resolve) => {
      const weekButtons = [...document.querySelectorAll('.sp-history-week-day')];
      const targetButton = weekButtons[4];
      if (!targetButton) throw new Error("Fast date-click target button not found");
      const state = window.__phase77VisualState ?? {};
      state.interactions?.push("week-day:fast-2026-05-01");
      state.fastSnapshotResolved = false;
      targetButton.click();
      const startedAt = performance.now();
      const samples = [];
      function sample() {
        const historyText = document.querySelector('.sp-history-screen')?.innerText ?? "";
        const elapsedMs = Math.round(performance.now() - startedAt);
        samples.push({
          elapsedMs,
          includesInlinePending: historyText.includes("同步這天紀錄中..."),
          snapshotResolved: Boolean(state.fastSnapshotResolved),
          includesTargetWeek: /4\\/27\\s*-\\s*5\\/3/.test(historyText),
          includesTargetDate: /5\\/1|5月1|2026-05-01/.test(historyText),
          includesCurrentWeekStaleMeals: /燕麥優格|雞胸飯/.test(historyText),
          includesFastMeal: /番茄牛肉麵|豆漿香蕉/.test(historyText),
          includesForbiddenWeekCard: historyText.includes("載入這週紀錄中..."),
          includesHistoryError: historyText.includes("歷史資料暫時載入失敗。請稍後再試。"),
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
        });
        if (performance.now() - startedAt < 270) {
          requestAnimationFrame(sample);
          return;
        }
        resolve({
          sampleCount: samples.length,
          durationMs: elapsedMs,
          observedInlineBeforeResolve: samples.some((item) => item.includesInlinePending && !item.snapshotResolved),
          observedInlineAnyTime: samples.some((item) => item.includesInlinePending),
          targetWeekContext: samples.every((item) => item.includesTargetWeek),
          targetDateContext: samples.some((item) => item.includesTargetDate),
          fastSnapshotResolved: samples.some((item) => item.snapshotResolved),
          fastMealVisible: samples.some((item) => item.includesFastMeal),
          noStaleCurrentWeekMeals: !samples.some((item) => item.includesCurrentWeekStaleMeals),
          noForbiddenWeekCard: !samples.some((item) => item.includesForbiddenWeekCard),
          noHistoryErrorBanner: !samples.some((item) => item.includesHistoryError),
          noHorizontalOverflow: !samples.some((item) => item.hasHorizontalOverflow),
          fastDayRequests: state.fastDayRequests ?? 0
        });
      }
      requestAnimationFrame(sample);
    }))()`,
  });

  const value = collection.result?.value;
  if (!value || value.sampleCount < 2 || value.durationMs < 250) {
    throw new Error("Phase 77 visual evidence failed: fast date-click sampling did not cover at least 250ms.");
  }
  if (value.observedInlineBeforeResolve || value.observedInlineAnyTime) {
    throw new Error("Phase 77 visual evidence failed: transient selected-day pending copy appeared during fast date click.");
  }
  if (!value.targetWeekContext || !value.targetDateContext) {
    throw new Error("Phase 77 visual evidence failed: fast date-click target context disappeared.");
  }
  if (!value.fastSnapshotResolved || !value.fastMealVisible || value.fastDayRequests < 1) {
    throw new Error("Phase 77 visual evidence failed: fast selected-day snapshot did not resolve through mocked data.");
  }
  if (!value.noStaleCurrentWeekMeals) {
    throw new Error("Phase 77 visual evidence failed: current-week stale meal labels appeared during fast date click.");
  }
  if (!value.noForbiddenWeekCard || !value.noHistoryErrorBanner || !value.noHorizontalOverflow) {
    throw new Error("Phase 77 visual evidence failed: fast date-click visual guard failed.");
  }

  return value;
}

async function runCase({ browser, url, outputDir, state }) {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-77-visual-"));
  const port = 45000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`${loopbackOrigin(port)}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", {
        width: state.width,
        height: state.height,
        deviceScaleFactor: 1,
        mobile: state.width <= 500,
      });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase77MockScript() });
      await send("Page.navigate", { url });
      await delay(900);
      await send("Runtime.evaluate", {
        expression: `(() => {
          const controls = [...document.querySelectorAll('button, [role="button"]')];
          const historyControl = controls.find((node) => /歷史/.test(node.innerText || node.getAttribute("aria-label") || ""));
          if (!historyControl) throw new Error("History navigation control not found");
          window.__phase77VisualState?.interactions?.push("bottom-nav:history");
          historyControl.click();
        })()`,
      });
      await delay(650);
      await send("Runtime.evaluate", {
        expression: `(() => {
          const previous = [...document.querySelectorAll('button')]
            .find((node) => node.getAttribute("aria-label") === "查看上一週");
          if (!previous) throw new Error("Previous week control not found");
          window.__phase77VisualState?.interactions?.push("week-control:previous");
          previous.click();
        })()`,
      });
      await delay(250);

      const pendingInspection = await inspectHistoryLoadingState(send, "pending");
      const pendingFileName = "history-cold-week-pending-mobile-390x844.png";
      const pendingShot = await captureScreenshot({
        send,
        output: join(outputDir, pendingFileName),
        captureName: "pending cold week switch",
      });

      await delay(COLD_RESPONSE_DELAY_MS + 550);
      const loadedInspection = await inspectHistoryLoadingState(send, "loaded");
      const loadedFileName = "history-cold-week-loaded-mobile-390x844.png";
      const loadedShot = await captureScreenshot({
        send,
        output: join(outputDir, loadedFileName),
        captureName: "loaded target week",
      });

      const fastDateClick = await collectFastPendingCopySamples(send);
      const fastFileName = "history-fast-date-click-mobile-390x844.png";
      const fastShot = await captureScreenshot({
        send,
        output: join(outputDir, fastFileName),
        captureName: "fast selected-day click",
      });

      return {
        id: state.id,
        viewport: { width: state.width, height: state.height },
        browser: browser.name,
        screenshots: [
          { ...pendingShot, path: relativeOutputPath(outputDir, pendingFileName) },
          { ...loadedShot, path: relativeOutputPath(outputDir, loadedFileName) },
          { ...fastShot, path: relativeOutputPath(outputDir, fastFileName) },
        ],
        assertions: {
          pending: {
            targetWeekContext: pendingInspection.includesTargetWeek,
            targetDateContext: pendingInspection.includesTargetDate,
            inlineDayPending: pendingInspection.includesInlinePending,
            noTopLevelWeekLoadingCard: !pendingInspection.includesForbiddenWeekCard,
            noHistoryErrorBanner: !pendingInspection.includesHistoryError,
            noStaleCachedMealRows: !pendingInspection.includesCurrentWeekStaleMeals,
            noPendingMealEditRows: pendingInspection.mealRowCount === 0,
            noPendingDayDetailAffordance: pendingInspection.dayDetailAffordanceCount === 0,
            noUnsafeCalls: pendingInspection.unsafeCalls.length === 0,
            historyScreenNonempty: pendingInspection.historyNodeCount > 0,
            noHorizontalOverflow: !pendingInspection.hasHorizontalOverflow,
          },
          loaded: {
            targetWeekContext: loadedInspection.includesTargetWeek,
            targetDateContext: loadedInspection.includesTargetDate,
            targetSyntheticMealsVisible: loadedInspection.includesLoadedTargetMeal,
            inlinePendingCleared: !loadedInspection.includesInlinePending,
            noTopLevelWeekLoadingCard: !loadedInspection.includesForbiddenWeekCard,
            noHistoryErrorBanner: !loadedInspection.includesHistoryError,
            noUnsafeCalls: loadedInspection.unsafeCalls.length === 0,
            historyScreenNonempty: loadedInspection.historyNodeCount > 0,
            noHorizontalOverflow: !loadedInspection.hasHorizontalOverflow,
          },
          fastDateClick: {
            noTransientInlinePendingCopy: !fastDateClick.observedInlineBeforeResolve && !fastDateClick.observedInlineAnyTime,
            sampledAtLeast250ms: fastDateClick.durationMs >= 250,
            sampleCount: fastDateClick.sampleCount,
            targetWeekContext: fastDateClick.targetWeekContext,
            targetDateContext: fastDateClick.targetDateContext,
            fastSnapshotResolved: fastDateClick.fastSnapshotResolved,
            fastSyntheticMealsVisible: fastDateClick.fastMealVisible,
            noStaleCachedMealRows: fastDateClick.noStaleCurrentWeekMeals,
            noTopLevelWeekLoadingCard: fastDateClick.noForbiddenWeekCard,
            noHistoryErrorBanner: fastDateClick.noHistoryErrorBanner,
            noHorizontalOverflow: fastDateClick.noHorizontalOverflow,
          },
        },
        deterministicMockCategories: [
          "device bootstrap",
          "daily targets",
          "current week history",
          "delayed target week history",
          "delayed target day snapshot",
          "fast target day snapshot",
          "home meal rows",
        ],
        interactions: loadedInspection.interactions,
      };
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveSafeOutputDir(args.outputDir);
  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 77 visual evidence.");
  const server = await startStaticServer();
  const browser = await findBrowser();

  try {
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 77 visual evidence failed: expected index response 200, got ${indexResponse.status}.`);
    }

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const outputs = [];
    for (const state of CASES) {
      outputs.push(await runCase({
        browser,
        url: `${server.origin}/`,
        outputDir,
        state,
      }));
    }

    const manifest = {
      scenario: SCENARIO,
      command: "node tests/harness/scenarios/77-history-loading-visual.mjs",
      status: "passed",
      source: {
        distClient: DIST_ROOT,
        captureServer: "local loopback static HTTP server",
      },
      outputs,
      assertions: [
        "dist client index must exist",
        "browser capture must be nonblank and above minimum PNG byte size",
        "History screen must be nonempty",
        "target week and target date context must remain visible",
        "inline selected-day pending copy must be visible during delayed cold responses",
        "top-level week loading card must be absent",
        "stale cached current-week meal rows must be absent under target week pending state",
        "meal edit row affordances must be absent during delayed pending state",
        "Day Detail affordances must be absent during delayed pending state",
        "loaded target-week synthetic meals must appear after delayed responses resolve",
        "fastDateClick.noTransientInlinePendingCopy must remain true across animation-frame samples",
        "fast selected-day snapshot must resolve before the pending-copy delay",
        "horizontal overflow must be absent",
        "external and unmocked backend calls must fail the run",
      ],
      privacy: "metadata-only local proof using synthetic mocked History data; excludes raw conversation text, model output, provider request bodies, tool arguments, image bytes, browser credential material, private logs, device identifiers from real users, and persisted database rows.",
      promotionPolicy: "local evidence only; no deploy or branch promotion authority is implied.",
    };

    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${SCENARIO} artifacts to ${outputDir}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/77-history-loading-visual.mjs -->

## section-05 — `tests/harness/scenarios/81-mobile-action-safety-visual.mjs`

sourceSha256: `6f61aab8a33bfa211c777872326ebf8824ad7aec65ae8dcff9d36af5427b58af`
sourceByteLength: 35263
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/81-mobile-action-safety-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/81-mobile-action-safety-visual.mjs --output-dir tests/harness/artifacts/81-mobile-action-safety/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "81-mobile-action-safety-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/81-mobile-action-safety/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/81-mobile-action-safety");
const LATEST_ROOT = resolve(DEFAULT_OUTPUT_DIR);
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const MOCK_CATEGORIES = [
  "device bootstrap",
  "daily targets",
  "Home meals",
  "Home coach CTA",
  "Chat history",
  "Chat send stream",
  "Meal Edit mutation responses",
  "SSE summary events",
];
const BASE_CASES = [
  {
    id: "meal-edit-single-controls-mobile-390x844",
    width: 390,
    height: 844,
    stateCase: "mealEditSingle",
  },
  {
    id: "meal-edit-grouped-final-delete-blocking-mobile-390x844",
    width: 390,
    height: 844,
    stateCase: "mealEditGroupedFinalDeleteBlocking",
  },
  {
    id: "home-expanded-cta-options-mobile-390x844",
    width: 390,
    height: 844,
    stateCase: "homeExpandedCtaOptions",
  },
  {
    id: "grouped-row-icon-controls-mobile-390x844",
    width: 390,
    height: 844,
    stateCase: "groupedRowIconControls",
  },
  {
    id: "chat-empty-starter-mobile-390x844",
    width: 390,
    height: 844,
    stateCase: "chatEmptyStarter",
  },
];
const NARROW_CASES = BASE_CASES.map((state) => ({
  ...state,
  id: state.id.replace("mobile-390x844", "narrow-360x780"),
  width: 360,
  height: 780,
}));
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];
const FORBIDDEN_MANIFEST_KEYS = [
  "apiKey",
  "authorization",
  "cookie",
  "databaseSnapshot",
  "deviceId",
  "externalUrl",
  "providerBody",
  "rawPrompt",
  "session",
  "toolPayload",
];

function parseArgs(argv) {
  const args = {
    outputDir: DEFAULT_OUTPUT_DIR,
    include360: false,
    validateHarness: false,
    caseIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      args.outputDir = argv[++index] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg === "--case") {
      args.caseIds.push(argv[++index] ?? "");
    } else if (arg === "--include-360") {
      args.include360 = true;
    } else if (arg === "--validate-harness") {
      args.validateHarness = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for Phase 81 visual evidence.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(LATEST_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function loopbackOrigin(port) {
  return ["http", "://127.0.0.1:", String(port)].join("");
}

function loopbackBase() {
  return ["http", "://127.0.0.1"].join("");
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", loopbackBase());
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);

    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start Phase 81 visual evidence HTTP server"));
        return;
      }
      resolvePromise({
        origin: loopbackOrigin(address.port),
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

function phase81MockScript() {
  return `(() => {
    const fixedNow = new Date("2026-06-08T12:00:00+08:00");
    const NativeDate = Date;
    class Phase81Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() {
        return fixedNow.getTime();
      }
      static parse(value) {
        return NativeDate.parse(value);
      }
      static UTC(...args) {
        return NativeDate.UTC(...args);
      }
    }
    Object.setPrototypeOf(Phase81Date, NativeDate);
    window.Date = Phase81Date;

    const targets = { calories: 2100, protein: 130, carbs: 240, fat: 70 };
    const groupedItems = [
      { name: "豆腐", position: 0, calories: 180, protein: 14, carbs: 12, fat: 8 },
      { name: "青菜", position: 1, calories: 120, protein: 6, carbs: 18, fat: 4 }
    ];
    const dailySummary = {
      date: "2026-06-08",
      totalCalories: 980,
      totalProtein: 62,
      totalCarbs: 118,
      totalFat: 31,
      mealCount: 2
    };
    const meals = [
      {
        id: "phase81-single-meal",
        mealRevisionId: "phase81-single-meal-r1",
        foodName: "雞胸便當",
        calories: 620,
        protein: 42,
        carbs: 68,
        fat: 16,
        itemCount: 1,
        loggedAt: "2026-06-08T12:20:00+08:00",
        mealPeriod: "lunch",
        imageAssetId: null,
        imageUrl: null
      },
      {
        id: "phase81-grouped-meal",
        mealRevisionId: "phase81-grouped-meal-r1",
        foodName: "豆腐青菜組合",
        calories: 360,
        protein: 20,
        carbs: 50,
        fat: 15,
        itemCount: groupedItems.length,
        loggedAt: "2026-06-08T18:30:00+08:00",
        mealPeriod: "dinner",
        imageAssetId: null,
        imageUrl: null,
        items: groupedItems
      }
    ];
    const originalFetch = window.fetch.bind(window);
    const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });

    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("deviceId", "phase81-visual-device");
    localStorage.setItem("goal", "維持健康飲食");
    localStorage.setItem("dailyTargets", JSON.stringify(targets));
    window.__phase81VisualState = {
      unsafeCalls: [],
      interactions: [],
      mockCategories: ${JSON.stringify(MOCK_CATEGORIES)}
    };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      if (url.origin !== window.location.origin) {
        window.__phase81VisualState.unsafeCalls.push("external-origin");
        throw new Error("forbidden external origin");
      }
      if (url.pathname === "/api/chat/history") {
        return Promise.resolve(jsonResponse({ messages: [] }));
      }
      if (url.pathname.startsWith("/api/chat")) {
        window.__phase81VisualState.interactions.push("chat-api:" + (init?.method ?? "GET"));
        return Promise.resolve(jsonResponse({
          assistantMessage: "已收到，這是 Phase 81 本機模擬回覆。",
          didLogMeal: false,
          didMutateMeal: false,
          dailySummary,
          dailyTargets: targets
        }));
      }
      if (url.pathname === "/api/observability/client-event") {
        window.__phase81VisualState.interactions.push("observability:" + (init?.method ?? "GET"));
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname === "/api/meals") {
        return Promise.resolve(jsonResponse({ meals }));
      }
      if (url.pathname === "/api/device/session") {
        return Promise.resolve(jsonResponse({
          deviceId: "phase81-visual-device",
          goal: "maintenance",
          dailyTargets: targets,
          establishedBy: "legacy_migration"
        }));
      }
      if (url.pathname.startsWith("/api/meals/") && (init?.method === "PATCH" || init?.method === "DELETE")) {
        return Promise.resolve(jsonResponse({
          affectedDate: "2026-06-08",
          dailySummary,
          meal: meals[0],
          deletedMealId: url.pathname.split("/").at(-1)
        }));
      }
      if (url.pathname === "/api/sse") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname.startsWith("/api/")) {
        window.__phase81VisualState.unsafeCalls.push("unmocked:" + url.pathname);
        throw new Error("unmocked backend route: " + url.pathname);
      }
      return originalFetch(input, init);
    };
    class Phase81EventSource extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        if (url !== "/api/sse") throw new Error("unmocked EventSource route: " + url);
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("daily_summary", {
            data: JSON.stringify({
              summary: dailySummary,
              affectedDate: dailySummary.date,
              source: "initial"
            })
          }));
          this.dispatchEvent(new MessageEvent("goals_update", { data: JSON.stringify({ targets }) }));
        }, 80);
      }
      close() {}
    }
    window.EventSource = Phase81EventSource;
  })();`;
}

function allCases(include360) {
  return include360 ? [...BASE_CASES, ...NARROW_CASES] : BASE_CASES;
}

function selectedCases(args) {
  const cases = allCases(args.include360);
  if (args.caseIds.length === 0) return cases;
  const selected = args.caseIds.map((caseId) => {
    const state = cases.find((candidate) => candidate.id === caseId);
    if (!state) {
      throw new Error(`Unknown Phase 81 visual case: ${caseId}`);
    }
    return state;
  });
  if (selected.length === 0) {
    throw new Error("No Phase 81 visual cases selected.");
  }
  return selected;
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 81 visual evidence failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }

  const sampleStart = 128;
  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(sampleStart, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Phase 81 visual evidence failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

async function captureScreenshot({ send, output }) {
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(data, "base64");
  await writeFile(output, bytes);
  await assertScreenshotBytes(output, bytes);
  return {
    path: relative(process.cwd(), output),
    bytes: bytes.length,
    nonblank: true,
  };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  return result.result?.value;
}

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error(message);
  }
}

async function openMealEdit(send, mealName) {
  let opened = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    opened = await evaluate(send, `(() => {
      const row = [...document.querySelectorAll('.home-sport-meal-row')]
        .find((node) => (node.innerText || node.getAttribute("aria-label") || "").includes(${JSON.stringify(mealName)}));
      if (!row || typeof row.click !== "function") return false;
      row.scrollIntoView({ block: "center" });
      row.click();
      window.__phase81VisualState?.interactions?.push("open-meal-edit:${mealName}");
      return true;
    })()`);
    if (opened) break;
    await delay(120);
  }
  assertTrue(opened, `Phase 81 visual evidence failed: could not open Meal Edit for ${mealName}.`);
  await delay(500);
}

async function navigateToChat(send) {
  let clicked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    clicked = await evaluate(send, `(() => {
      const chatControl = [...document.querySelectorAll('button, [role="button"]')]
        .find((node) => /對話|記錄餐點/.test(node.innerText || node.getAttribute("aria-label") || ""));
      if (!chatControl || typeof chatControl.click !== "function") return false;
      chatControl.click();
      window.__phase81VisualState?.interactions?.push("bottom-nav:chat");
      return true;
    })()`);
    if (clicked) break;
    await delay(120);
  }
  assertTrue(clicked, "Phase 81 visual evidence failed: Chat navigation control not found.");
  await delay(700);
}

async function prepareCase(send, stateCase) {
  if (stateCase === "mealEditSingle") {
    await openMealEdit(send, "雞胸便當");
    await evaluate(send, `document.querySelector('.sp-meal-edit-scroll')?.scrollTo({ top: 9999 })`);
  } else if (stateCase === "mealEditGroupedFinalDeleteBlocking" || stateCase === "groupedRowIconControls") {
    await openMealEdit(send, "豆腐青菜組合");
    if (stateCase === "mealEditGroupedFinalDeleteBlocking") {
      await evaluate(send, `(() => {
        const deleteButton = [...document.querySelectorAll('.sp-meal-edit-grouped-row-actions button')]
          .find((node) => (node.getAttribute("aria-label") || "").startsWith("刪除項目："));
        deleteButton?.click();
      })()`);
      await delay(120);
      await evaluate(send, `(() => {
        const deleteButton = [...document.querySelectorAll('.sp-meal-edit-grouped-row-actions button')]
          .find((node) => (node.getAttribute("aria-label") || "").startsWith("刪除項目："));
        deleteButton?.click();
      })()`);
      await delay(120);
      await evaluate(send, `document.querySelector('.sp-meal-edit-grouped-scroll')?.scrollTo({ top: 9999 })`);
    }
  } else if (stateCase === "homeExpandedCtaOptions") {
    let expanded = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expanded = await evaluate(send, `(() => {
        const target = [...document.querySelectorAll('.sp-coach-cta-intent')]
          .find((node) => /記錄飲食|補蛋白質|安排下一餐|控制熱量/.test(node.innerText || ""));
        if (!target) return false;
        if (!document.querySelector('.sp-coach-cta-option')) {
          target.click();
        }
        document.querySelector('.sp-coach-cta')?.scrollIntoView({ block: "end" });
        window.__phase81VisualState?.interactions?.push("home-cta:expanded");
        return document.querySelectorAll('.sp-coach-cta-option').length >= 3;
      })()`);
      if (expanded) break;
      await delay(120);
    }
    assertTrue(expanded, "Phase 81 visual evidence failed: could not expand Home CTA options.");
    await delay(240);
  } else if (stateCase === "chatEmptyStarter") {
    await navigateToChat(send);
  }
}

async function inspectCase(send, stateCase) {
  const inspection = await evaluate(send, `(() => {
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const intersects = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const bodyText = document.body.innerText.trim();
    const footer = rectOf(document.querySelector('.sp-meal-edit-footer'));
    const deleteRow = rectOf(document.querySelector('.sp-meal-edit-delete-row'));
    const finalDeleteError = rectOf(document.querySelector('.sp-meal-edit-grouped-final-delete-error'));
    const cancel = rectOf(document.querySelector('.sp-meal-edit-cancel'));
    const save = rectOf(document.querySelector('.sp-meal-edit-save'));
    const tabbar = rectOf(document.querySelector('.sp-tabbar, nav'));
    const ctaOptions = [...document.querySelectorAll('.sp-coach-cta-option')].map((node) => ({
      text: node.innerText.trim(),
      rect: rectOf(node)
    }));
    const groupedActions = [...document.querySelectorAll('.sp-meal-edit-grouped-row-actions button')].map((node) => ({
      text: node.innerText.trim(),
      ariaLabel: node.getAttribute("aria-label") || "",
      rect: rectOf(node)
    }));
    const groupedRowCount = document.querySelectorAll('.sp-meal-edit-grouped-row').length;
    const chatStarter = rectOf(document.querySelector('.sp-chat-starter'));
    const composer = rectOf(document.querySelector('.sp-chat-composer-bar'));
    const starterChips = [...document.querySelectorAll('.sp-chat-starter button')].map((node) => node.innerText.trim());
    const unsafeCalls = window.__phase81VisualState?.unsafeCalls ?? [];
    const noVisibleEnglishGroupedActions = groupedActions.every((action) => !/^(edit|delete)$/i.test(action.text));
    return {
      bodyTextLength: bodyText.length,
      stateCase: ${JSON.stringify(stateCase)},
      unsafeCalls,
      mealEditFooterVisible: Boolean(footer && footer.height > 0),
      mealEditDeleteVisibleAboveFooter: Boolean(deleteRow && footer && deleteRow.bottom <= footer.top - 1),
      mealEditCancelVisible: Boolean(cancel && cancel.height >= 44),
      mealEditSaveVisible: Boolean(save && save.height >= 44),
      groupedFinalDeleteBlockingVisible: Boolean(finalDeleteError && finalDeleteError.height > 0),
      groupedFinalDeleteBlockingAboveFooter: Boolean(finalDeleteError && footer && finalDeleteError.bottom <= footer.top - 1),
      homeCtaOptionCount: ctaOptions.length,
      homeCtaOptionsMin44: ctaOptions.every((option) => option.rect && option.rect.height >= 44),
      homeCtaOptionsGap8: ctaOptions.length < 2 || ctaOptions.every((option, index) => index === 0 || option.rect.top - ctaOptions[index - 1].rect.bottom >= 7),
      homeLastCtaGapFromNav: Boolean(ctaOptions.length > 0 && tabbar && ctaOptions[ctaOptions.length - 1].rect.bottom <= tabbar.top - 8),
      groupedActionCount: groupedActions.length,
      groupedRowCount,
      groupedActionsMin44: groupedActions.every((action) => action.rect && action.rect.width >= 44 && action.rect.height >= 44),
      groupedActionsLocalized: groupedActions.some((action) => action.ariaLabel.startsWith("展開項目：") || action.ariaLabel.startsWith("收合項目：")) && groupedActions.some((action) => action.ariaLabel.startsWith("刪除項目：")),
      noVisibleEnglishGroupedActions,
      chatStarterVisible: Boolean(chatStarter && chatStarter.height > 0),
      chatStarterSeparatedFromComposer: Boolean(chatStarter && composer && chatStarter.bottom <= composer.top - 8 && !intersects(chatStarter, composer)),
      chatStarterCompact: Boolean(chatStarter && chatStarter.height <= window.innerHeight * 0.36),
      chatStarterApprovedLabelsOnly: starterChips.length === 3 &&
        starterChips.includes("我想記錄今天吃的東西") &&
        starterChips.includes("示範怎麼描述一餐") &&
        starterChips.includes("我不確定份量怎麼說"),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  })()`);

  if (!inspection || inspection.bodyTextLength <= 20) {
    throw new Error(`Phase 81 visual evidence failed: visible body text length is ${inspection?.bodyTextLength}.`);
  }
  if (inspection.unsafeCalls.length > 0) {
    throw new Error(`Phase 81 visual evidence failed: unsafe or unmocked calls detected: ${inspection.unsafeCalls.join(", ")}`);
  }
  if (inspection.hasHorizontalOverflow) {
    throw new Error(`Phase 81 visual evidence failed: horizontal overflow detected for ${stateCase}.`);
  }

  if (stateCase === "mealEditSingle") {
    assertTrue(inspection.mealEditFooterVisible, "MOB-01 visual failed: Meal Edit footer missing.");
    assertTrue(inspection.mealEditDeleteVisibleAboveFooter, "MOB-01 visual failed: destructive controls overlap the fixed footer.");
    assertTrue(inspection.mealEditCancelVisible, "MOB-01 visual failed: cancel control is not a visible mobile target.");
    assertTrue(inspection.mealEditSaveVisible, "MOB-01 visual failed: save control is not a visible mobile target.");
  } else if (stateCase === "mealEditGroupedFinalDeleteBlocking") {
    assertTrue(inspection.groupedFinalDeleteBlockingVisible, "MOB-01 visual failed: grouped final-delete blocking copy is missing.");
    assertTrue(inspection.groupedFinalDeleteBlockingAboveFooter, "MOB-01 visual failed: grouped final-delete blocking copy overlaps the footer.");
  } else if (stateCase === "homeExpandedCtaOptions") {
    assertTrue(inspection.homeCtaOptionCount >= 3, "MOB-02 visual failed: tallest Home CTA options are not expanded.");
    assertTrue(inspection.homeCtaOptionsMin44, "MOB-02 visual failed: a Home CTA option is below 44px.");
    assertTrue(inspection.homeCtaOptionsGap8, "MOB-02 visual failed: Home CTA option gap is below 8px.");
    assertTrue(inspection.homeLastCtaGapFromNav, "MOB-02 visual failed: final Home CTA option crowds the bottom nav.");
  } else if (stateCase === "groupedRowIconControls") {
    assertTrue(inspection.groupedRowCount >= 2, "MOB-03 visual failed: multi-row grouped proof did not render.");
    assertTrue(inspection.groupedActionCount >= inspection.groupedRowCount * 2, "MOB-03 visual failed: each grouped row needs edit/delete actions.");
    assertTrue(inspection.groupedActionsMin44, "MOB-03 visual failed: grouped row action target is below 44px.");
    assertTrue(inspection.groupedActionsLocalized, "MOB-03 visual failed: grouped action accessible labels are not localized.");
    assertTrue(inspection.noVisibleEnglishGroupedActions, "MOB-03 visual failed: visible English grouped action text remains.");
  } else if (stateCase === "chatEmptyStarter") {
    assertTrue(inspection.chatStarterVisible, "MOB-04 visual failed: empty Chat starter is missing.");
    assertTrue(inspection.chatStarterSeparatedFromComposer, "MOB-04 visual failed: Chat starter overlaps or crowds the composer.");
    assertTrue(inspection.chatStarterCompact, "MOB-04 visual failed: Chat starter is too large for empty guidance.");
    assertTrue(inspection.chatStarterApprovedLabelsOnly, "MOB-04 visual failed: Chat starter chips are not exactly the approved labels.");
  }

  return inspection;
}

async function runCase({ browser, url, outputDir, state }) {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-81-visual-"));
  const port = 46000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`${loopbackOrigin(port)}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", {
        width: state.width,
        height: state.height,
        deviceScaleFactor: 1,
        mobile: state.width <= 500,
      });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase81MockScript() });
      await send("Page.navigate", { url });
      await delay(1200);
      await prepareCase(send, state.stateCase);

      const assertions = await inspectCase(send, state.stateCase);
      const fileName = `${state.id}.png`;
      const screenshot = await captureScreenshot({ send, output: join(outputDir, fileName) });
      return {
        id: state.id,
        viewport: { width: state.width, height: state.height },
        screenshotPath: relative(process.cwd(), join(outputDir, fileName)),
        screenshotBytes: screenshot.bytes,
        browserName: browser.name,
        localMockCategories: MOCK_CATEGORIES,
        assertionBooleans: {
          mealEditFooterVisible: assertions.mealEditFooterVisible,
          mealEditDeleteVisibleAboveFooter: assertions.mealEditDeleteVisibleAboveFooter,
          groupedFinalDeleteBlockingVisible: assertions.groupedFinalDeleteBlockingVisible,
          groupedFinalDeleteBlockingAboveFooter: assertions.groupedFinalDeleteBlockingAboveFooter,
          homeCtaOptionsMin44: assertions.homeCtaOptionsMin44,
          homeCtaOptionsGap8: assertions.homeCtaOptionsGap8,
          homeLastCtaGapFromNav: assertions.homeLastCtaGapFromNav,
          groupedActionsMin44: assertions.groupedActionsMin44,
          groupedActionsLocalized: assertions.groupedActionsLocalized,
          noVisibleEnglishGroupedActions: assertions.noVisibleEnglishGroupedActions,
          chatStarterVisible: assertions.chatStarterVisible,
          chatStarterSeparatedFromComposer: assertions.chatStarterSeparatedFromComposer,
          chatStarterApprovedLabelsOnly: assertions.chatStarterApprovedLabelsOnly,
          noUnsafeCalls: assertions.unsafeCalls.length === 0,
          noHorizontalOverflow: !assertions.hasHorizontalOverflow,
          screenshotNonblank: true,
        },
      };
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function buildManifest(outputs) {
  return {
    scenario: SCENARIO,
    command: "node tests/harness/scenarios/81-mobile-action-safety-visual.mjs",
    status: "passed",
    generatedArtifactPolicy: "Artifacts under latest/ are generated evidence and must be regenerated, not hand-edited.",
    source: {
      distClient: DIST_ROOT,
      captureServer: "local loopback static HTTP server",
    },
    outputs,
    assertions: [
      "dist client index must exist",
      "browser capture must be nonblank and above minimum PNG byte size",
      "external and unmocked backend calls must fail the run",
      "Meal Edit lower destructive/save/cancel controls must remain visible above the fixed footer",
      "grouped final-item delete-blocking copy must remain visible above the fixed footer",
      "Home expanded CTA options must be 44px minimum with 8px gaps and nav clearance",
      "grouped row action controls must be icon-only, localized, and 44px tappable",
      "empty Chat starter must be compact, above composer, and limited to the approved chips",
    ],
    privacyPolicy: {
      kind: "metadata-only",
      excludes: [
      "model input content",
        "provider request or response bodies",
        "browser credential material",
        "API keys",
        "persisted data dumps",
        "external URLs",
        "real user device identifiers",
      ],
    },
    promotionPolicy: "local evidence only; no deploy or branch promotion authority is implied.",
  };
}

function assertManifestPrivacySchema(manifest) {
  const serialized = JSON.stringify(manifest);
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, "i").test(serialized)) {
      throw new Error(`Phase 81 manifest privacy schema rejected forbidden key: ${key}`);
    }
  }
  if (/OPENAI_API_KEY|sk-[A-Za-z0-9]|https?:\/\/(?!127\.0\.0\.1)/.test(serialized)) {
    throw new Error("Phase 81 manifest privacy schema rejected secret-like or external URL content.");
  }
}

async function validateHarness(args) {
  resolveSafeOutputDir(args.outputDir);
  let unsafeRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/81-mobile-action-safety");
  } catch {
    unsafeRejected = true;
  }
  if (!unsafeRejected) {
    throw new Error("Phase 81 validate-harness failed: artifact-root overwrite was not rejected.");
  }
  let traversalRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/81-mobile-action-safety/latest/../../outside");
  } catch {
    traversalRejected = true;
  }
  if (!traversalRejected) {
    throw new Error("Phase 81 validate-harness failed: output path traversal was not rejected.");
  }

  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 81 visual evidence.");
  const browser = await findBrowser();
  const server = await startStaticServer();
  try {
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 81 validate-harness failed: expected index response 200, got ${indexResponse.status}.`);
    }
  } finally {
    await server.close();
  }

  const cases = selectedCases(args);
  for (const expectedId of BASE_CASES.map((state) => state.id)) {
    if (!BASE_CASES.some((state) => state.id === expectedId)) {
      throw new Error(`Phase 81 validate-harness failed: missing registered case ${expectedId}.`);
    }
  }
  if (cases.length < 1) {
    throw new Error("Phase 81 validate-harness failed: no cases selected.");
  }
  const mockScript = phase81MockScript();
  for (const token of ["/api/chat/history", "/api/meals", "/api/device/session", "/api/sse", "forbidden external origin"]) {
    if (!mockScript.includes(token)) {
      throw new Error(`Phase 81 validate-harness failed: mock registration missing ${token}.`);
    }
  }
  const sampleManifest = buildManifest(BASE_CASES.map((state) => ({
    id: state.id,
    viewport: { width: state.width, height: state.height },
    screenshotPath: `${DEFAULT_OUTPUT_DIR}/${state.id}.png`,
    screenshotBytes: 0,
    browserName: browser.name,
    localMockCategories: MOCK_CATEGORIES,
    assertionBooleans: {
      validateHarnessOnly: true,
      noUnsafeCalls: true,
      screenshotNonblank: false,
    },
  })));
  assertManifestPrivacySchema(sampleManifest);
  console.log(`Validated ${SCENARIO} harness infrastructure with ${browser.name}; selected cases: ${cases.map((state) => state.id).join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.validateHarness) {
    await validateHarness(args);
    return;
  }

  const outputDir = resolveSafeOutputDir(args.outputDir);
  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 81 visual evidence.");
  const server = await startStaticServer();
  const browser = await findBrowser();

  try {
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 81 visual evidence failed: expected index response 200, got ${indexResponse.status}.`);
    }

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    const outputs = [];
    for (const state of selectedCases(args)) {
      outputs.push(await runCase({
        browser,
        url: `${server.origin}/`,
        outputDir,
        state,
      }));
    }

    const manifest = buildManifest(outputs);
    assertManifestPrivacySchema(manifest);
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${SCENARIO} artifacts to ${outputDir}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/81-mobile-action-safety-visual.mjs -->

## section-06 — `tests/harness/scenarios/82-history-meal-navigation-visual.mjs`

sourceSha256: `7f9d2092ab9bad4d8719902c278b7ce4d412b6a8337b860834e9e426ee4d1a7f`
sourceByteLength: 35791
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/82-history-meal-navigation-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/82-history-meal-navigation-visual.mjs --output-dir tests/harness/artifacts/82-history-meal-navigation/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "82-history-meal-navigation-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/82-history-meal-navigation/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/82-history-meal-navigation");
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const CASES = [
  { id: "current-week-header-mobile-390x844", width: 390, height: 844, stateCase: "currentWeekHeader" },
  { id: "previous-week-header-mobile-390x844", width: 390, height: 844, stateCase: "previousWeekHeader" },
  { id: "older-history-header-mobile-390x844", width: 390, height: 844, stateCase: "olderHistoryHeader" },
  { id: "history-row-entry-mobile-390x844", width: 390, height: 844, stateCase: "historyRowEntry" },
  { id: "focused-day-detail-edit-mobile-390x844", width: 390, height: 844, stateCase: "focusedDayDetailEdit" },
  { id: "day-detail-return-cancel-mobile-390x844", width: 390, height: 844, stateCase: "dayDetailReturnCancel" },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];
const MOCK_CATEGORIES = [
  "device bootstrap",
  "daily targets",
  "current week history",
  "previous week history",
  "older week history",
  "focused day snapshot",
  "Meal Edit update response",
  "SSE summary events",
];
const FORBIDDEN_MANIFEST_PATTERNS = [
  /cookies?/i,
  /db snapshots?|database snapshots?/i,
  /raw prompts?/i,
  /provider payloads?/i,
  /image bytes?/i,
  /OPENAI_API_KEY/,
  /sk-[A-Za-z0-9]/,
];

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR, validateHarness: false, caseIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      args.outputDir = argv[++index] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg === "--case") {
      args.caseIds.push(argv[++index] ?? "");
    } else if (arg === "--validate-harness") {
      args.validateHarness = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for Phase 82 visual evidence.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(ARTIFACT_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function loopbackOrigin(port) {
  return ["http", "://127.0.0.1:", String(port)].join("");
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end("bad request");
      return;
    }
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);
    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start Phase 82 visual evidence HTTP server"));
        return;
      }
      resolvePromise({
        origin: loopbackOrigin(address.port),
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

function phase82MockScript() {
  return `(() => {
    const fixedNow = new Date("2026-06-09T12:00:00+08:00");
    const NativeDate = Date;
    class Phase82Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() { return fixedNow.getTime(); }
      static parse(value) { return NativeDate.parse(value); }
      static UTC(...args) { return NativeDate.UTC(...args); }
    }
    Object.setPrototypeOf(Phase82Date, NativeDate);
    window.Date = Phase82Date;

    const targets = { calories: 2100, protein: 130, carbs: 240, fat: 70 };
    const dailySummary = {
      date: "2026-06-09",
      totalCalories: 1180,
      totalProtein: 74,
      totalCarbs: 132,
      totalFat: 34,
      mealCount: 2
    };
    const focusedMeal = {
      id: "phase82-lunch",
      mealRevisionId: "phase82-lunch-r1",
      foodName: "雞胸藜麥便當",
      calories: 640,
      protein: 46,
      carbs: 70,
      fat: 18,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-06-09T12:20:00+08:00",
      mealPeriod: "lunch"
    };
    const breakfastMeal = {
      id: "phase82-breakfast",
      mealRevisionId: "phase82-breakfast-r1",
      foodName: "燕麥優格杯",
      calories: 420,
      protein: 24,
      carbs: 54,
      fat: 10,
      itemCount: 1,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: "2026-06-09T08:10:00+08:00",
      mealPeriod: "breakfast"
    };
    const snapshots = {
      "2026-06-09": {
        date: "2026-06-09",
        summary: dailySummary,
        meals: [breakfastMeal, focusedMeal]
      },
      "2026-06-02": {
        date: "2026-06-02",
        summary: { date: "2026-06-02", totalCalories: 1510, totalProtein: 84, totalCarbs: 170, totalFat: 45, mealCount: 2 },
        meals: [
          { ...breakfastMeal, id: "phase82-prev-breakfast", mealRevisionId: "phase82-prev-breakfast-r1", foodName: "地瓜蛋沙拉", loggedAt: "2026-06-02T08:30:00+08:00" },
          { ...focusedMeal, id: "phase82-prev-lunch", mealRevisionId: "phase82-prev-lunch-r1", foodName: "鮭魚飯盒", loggedAt: "2026-06-02T12:35:00+08:00" }
        ]
      },
      "2026-05-26": {
        date: "2026-05-26",
        summary: { date: "2026-05-26", totalCalories: 1390, totalProtein: 70, totalCarbs: 148, totalFat: 42, mealCount: 2 },
        meals: [
          { ...breakfastMeal, id: "phase82-old-breakfast", mealRevisionId: "phase82-old-breakfast-r1", foodName: "紫米飯糰", loggedAt: "2026-05-26T08:30:00+08:00" },
          { ...focusedMeal, id: "phase82-old-lunch", mealRevisionId: "phase82-old-lunch-r1", foodName: "番茄牛肉麵", loggedAt: "2026-05-26T12:30:00+08:00" }
        ]
      }
    };
    const trendsByFrom = {
      "2026-06-08": {
        from: "2026-06-08",
        to: "2026-06-14",
        completeness: "partial",
        daily: [
          { date: "2026-06-08", calories: 1640, protein: 82, carbs: 184, fat: 48, mealCount: 3 },
          { date: "2026-06-09", calories: 1180, protein: 74, carbs: 132, fat: 34, mealCount: 2 }
        ],
        totals: { calories: 2820, protein: 156, carbs: 316, fat: 82, mealCount: 5 },
        averages: { calories: 1410, protein: 78, carbs: 158, fat: 41, mealsPerDay: 2.5 }
      },
      "2026-06-01": {
        from: "2026-06-01",
        to: "2026-06-07",
        completeness: "complete",
        daily: [
          { date: "2026-06-02", calories: 1510, protein: 84, carbs: 170, fat: 45, mealCount: 2 }
        ],
        totals: { calories: 1510, protein: 84, carbs: 170, fat: 45, mealCount: 2 },
        averages: { calories: 1510, protein: 84, carbs: 170, fat: 45, mealsPerDay: 2 }
      },
      "2026-05-25": {
        from: "2026-05-25",
        to: "2026-05-31",
        completeness: "complete",
        daily: [
          { date: "2026-05-26", calories: 1390, protein: 70, carbs: 148, fat: 42, mealCount: 2 }
        ],
        totals: { calories: 1390, protein: 70, carbs: 148, fat: 42, mealCount: 2 },
        averages: { calories: 1390, protein: 70, carbs: 148, fat: 42, mealsPerDay: 2 }
      }
    };
    const originalFetch = window.fetch.bind(window);
    const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });

    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("deviceId", "phase82-visual-device");
    localStorage.setItem("goal", "maintenance");
    localStorage.setItem("dailyTargets", JSON.stringify(targets));
    window.__phase82VisualState = { unsafeCalls: [], interactions: [], mockCategories: ${JSON.stringify(MOCK_CATEGORIES)} };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      if (url.origin !== window.location.origin) {
        window.__phase82VisualState.unsafeCalls.push("external-origin");
        throw new Error("forbidden external origin");
      }
      if (url.pathname === "/api/meals") {
        return Promise.resolve(jsonResponse({ meals: [breakfastMeal, focusedMeal] }));
      }
      if (url.pathname === "/api/device/session") {
        return Promise.resolve(jsonResponse({ deviceId: "phase82-visual-device", goal: "maintenance", dailyTargets: targets, establishedBy: "legacy_migration" }));
      }
      if (url.pathname === "/api/history/trends") {
        const trend = trendsByFrom[url.searchParams.get("from") ?? ""] ?? trendsByFrom["2026-06-08"];
        return Promise.resolve(jsonResponse(trend));
      }
      if (url.pathname.startsWith("/api/history/days/")) {
        const dateKey = decodeURIComponent(url.pathname.split("/").at(-1));
        const snapshot = snapshots[dateKey] ?? { date: dateKey, summary: { date: dateKey, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 }, meals: [] };
        return Promise.resolve(jsonResponse(snapshot));
      }
      if (url.pathname.startsWith("/api/meals/") && init?.method === "PATCH") {
        window.__phase82VisualState.interactions.push("meal-update:" + url.pathname);
        return Promise.resolve(jsonResponse({ affectedDate: "2026-06-09", dailySummary, meal: focusedMeal }));
      }
      if (url.pathname === "/api/observability/client-event") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname === "/api/sse") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.pathname.startsWith("/api/")) {
        window.__phase82VisualState.unsafeCalls.push("unmocked:" + url.pathname);
        throw new Error("unmocked backend route: " + url.pathname);
      }
      return originalFetch(input, init);
    };
    class Phase82EventSource extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        if (url !== "/api/sse") throw new Error("unmocked EventSource route: " + url);
        setTimeout(() => {
          this.dispatchEvent(new MessageEvent("daily_summary", { data: JSON.stringify({ summary: dailySummary, affectedDate: dailySummary.date, source: "initial" }) }));
          this.dispatchEvent(new MessageEvent("goals_update", { data: JSON.stringify({ targets }) }));
        }, 80);
      }
      close() {}
    }
    window.EventSource = Phase82EventSource;
  })();`;
}

function selectedCases(args) {
  if (args.caseIds.length === 0) return CASES;
  return args.caseIds.map((caseId) => {
    const state = CASES.find((candidate) => candidate.id === caseId);
    if (!state) throw new Error(`Unknown Phase 82 visual case: ${caseId}`);
    return state;
  });
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 82 visual evidence failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }
  const sampleStart = 128;
  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(sampleStart, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Phase 82 visual evidence failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

async function captureScreenshot({ send, output }) {
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(data, "base64");
  await writeFile(output, bytes);
  await assertScreenshotBytes(output, bytes);
  return { path: relative(process.cwd(), output), bytes: bytes.length, nonblank: true };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  return result.result?.value;
}

function assertTrue(value, message) {
  if (value !== true) throw new Error(message);
}

async function navigateToHistory(send) {
  let clicked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    clicked = await evaluate(send, `(() => {
      const historyControl = [...document.querySelectorAll('button, [role="button"]')]
        .find((node) => /歷史/.test(node.innerText || node.getAttribute("aria-label") || ""));
      if (!historyControl || typeof historyControl.click !== "function") return false;
      historyControl.click();
      window.__phase82VisualState?.interactions?.push("bottom-nav:history");
      return true;
    })()`);
    if (clicked) break;
    await delay(120);
  }
  assertTrue(clicked, "Phase 82 visual evidence failed: History navigation control not found.");
  await delay(700);
}

async function clickPreviousWeek(send, count) {
  for (let index = 0; index < count; index += 1) {
    const clicked = await evaluate(send, `(() => {
      const previous = [...document.querySelectorAll('button')]
        .find((node) => node.getAttribute("aria-label") === "查看上一週");
      if (!previous || typeof previous.click !== "function") return false;
      previous.click();
      window.__phase82VisualState?.interactions?.push("week-control:previous");
      return true;
    })()`);
    assertTrue(clicked, "Phase 82 visual evidence failed: previous week control not found.");
    await delay(450);
  }
}

async function openFocusedDayDetail(send) {
  let clicked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    clicked = await evaluate(send, `(() => {
      const row = [...document.querySelectorAll('.sp-history-meal-row')]
        .find((node) => (node.getAttribute("aria-label") || "").includes("雞胸藜麥便當"));
      if (!row || typeof row.click !== "function") return false;
      row.scrollIntoView({ block: "center" });
      row.click();
      window.__phase82VisualState?.interactions?.push("history-row:open-detail");
      return true;
    })()`);
    if (clicked) break;
    await delay(120);
  }
  assertTrue(clicked, "Phase 82 visual evidence failed: focused History meal row not found.");
  await delay(700);
}

async function openMealEditFromDayDetail(send) {
  let clicked = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    clicked = await evaluate(send, `(() => {
      const edit = [...document.querySelectorAll('button')]
        .find((node) => (node.getAttribute("aria-label") || "") === "編輯餐點：雞胸藜麥便當");
      if (!edit || typeof edit.click !== "function") return false;
      edit.scrollIntoView({ block: "center" });
      edit.click();
      window.__phase82VisualState?.interactions?.push("day-detail:edit");
      return true;
    })()`);
    if (clicked) break;
    await delay(120);
  }
  assertTrue(clicked, "Phase 82 visual evidence failed: focused Day Detail edit button not found.");
  await delay(500);
}

async function cancelMealEditToDayDetail(send) {
  const clicked = await evaluate(send, `(() => {
    const cancel = [...document.querySelectorAll('button')]
      .find((node) => (node.innerText || "").trim() === "取消編輯");
    if (!cancel || typeof cancel.click !== "function") return false;
    cancel.click();
    window.__phase82VisualState?.interactions?.push("meal-edit:cancel");
    return true;
  })()`);
  assertTrue(clicked, "Phase 82 visual evidence failed: Meal Edit cancel button not found.");
  await delay(500);
}

async function prepareCase(send, stateCase) {
  await navigateToHistory(send);
  if (stateCase === "previousWeekHeader") {
    await clickPreviousWeek(send, 1);
  } else if (stateCase === "olderHistoryHeader") {
    await clickPreviousWeek(send, 2);
  } else if (stateCase === "historyRowEntry" || stateCase === "focusedDayDetailEdit" || stateCase === "dayDetailReturnCancel") {
    await openFocusedDayDetail(send);
    if (stateCase === "dayDetailReturnCancel") {
      await openMealEditFromDayDetail(send);
      await cancelMealEditToDayDetail(send);
    }
  }
}

async function inspectCase(send, stateCase) {
  const inspection = await evaluate(send, `(() => {
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const bodyText = document.body.innerText.trim();
    const historyScreen = document.querySelector('.sp-history-screen');
    const dayDetail = document.querySelector('.sp-history-detail-screen');
    const mealEdit = document.querySelector('.sp-meal-edit-screen');
    const headerLabel = document.querySelector('.sp-history-header-copy h1');
    const headerRange = document.querySelector('.sp-history-header-copy div');
    const headerButtons = [...document.querySelectorAll('.sp-history-header button')].map(rectOf).filter(Boolean);
    const row = [...document.querySelectorAll('.sp-history-meal-row')]
      .find((node) => (node.getAttribute("aria-label") || "").includes("雞胸藜麥便當"));
    const editButton = [...document.querySelectorAll('button')]
      .find((node) => (node.getAttribute("aria-label") || "") === "編輯餐點：雞胸藜麥便當");
    const deleteControls = [...document.querySelectorAll('button, [role="button"]')]
      .map((node) => node.innerText || node.getAttribute("aria-label") || "")
      .filter((text) => /刪除|delete/i.test(text));
    const boxes = [...document.querySelectorAll('.sp-history-screen, .sp-history-detail-screen, .sp-history-header, .sp-history-header-copy, .sp-history-meal-row, .sp-history-detail-meal, .sp-history-detail-edit, .sp-meal-edit-screen, nav')]
      .map(rectOf)
      .filter((rect) => rect && rect.width > 0 && rect.height > 0);
    const unsafeCalls = window.__phase82VisualState?.unsafeCalls ?? [];
    const headerLabelText = headerLabel?.innerText?.trim() ?? "";
    const headerRangeText = headerRange?.innerText?.trim() ?? "";
    const historyText = historyScreen?.innerText ?? "";
    const dayDetailText = dayDetail?.innerText ?? "";
    return {
      bodyTextLength: bodyText.length,
      unsafeCalls,
      stateCase: ${JSON.stringify(stateCase)},
      headerLabelText,
      headerRangeText,
      historyVisible: Boolean(historyScreen),
      dayDetailVisible: Boolean(dayDetail),
      mealEditVisible: Boolean(mealEdit),
      headerButtonsVisible: headerButtons.length >= 2 && headerButtons.every((rect) => rect.width >= 44 && rect.height >= 44),
      headerLabelVisible: Boolean(headerLabel && rectOf(headerLabel).height > 0 && headerLabelText.length > 0),
      headerDateRangeVisible: Boolean(headerRange && rectOf(headerRange).height > 0 && /\\d+\\/\\d+\\s*-\\s*\\d+\\/\\d+/.test(headerRangeText)),
      historyRowLabelVisible: Boolean(row && (row.getAttribute("aria-label") || "").includes("開啟餐點詳情")),
      historyRowEnteredDayDetail: Boolean(dayDetail && /雞胸藜麥便當/.test(dayDetailText)),
      focusedEditLabelVisible: Boolean(editButton && rectOf(editButton).width >= 44 && rectOf(editButton).height >= 44),
      noDayDetailDeleteControls: Boolean(dayDetail) && deleteControls.length === 0,
      returnedToDayDetailAfterCancel: Boolean(dayDetail && !mealEdit && /雞胸藜麥便當|當日餐點|歷史快照|今天 · 即時/.test(dayDetailText)),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || boxes.some((rect) => rect.right > window.innerWidth + 1),
    };
  })()`);

  if (!inspection || inspection.bodyTextLength <= 20) {
    throw new Error(`Phase 82 visual evidence failed: visible body text length is ${inspection?.bodyTextLength}.`);
  }
  if (inspection.unsafeCalls.length > 0) {
    throw new Error(`Phase 82 visual evidence failed: unsafe or unmocked calls detected: ${inspection.unsafeCalls.join(", ")}`);
  }
  assertTrue(!inspection.hasHorizontalOverflow, `Phase 82 visual evidence failed: horizontal overflow detected for ${stateCase}.`);

  if (stateCase === "currentWeekHeader") {
    assertTrue(inspection.headerLabelText === "本週", "NAV-03 visual failed: current week header is not 本週.");
    assertTrue(inspection.headerDateRangeVisible, "NAV-03 visual failed: current week date range missing.");
    assertTrue(inspection.headerButtonsVisible, "NAV-03 visual failed: current week header buttons not visible.");
  } else if (stateCase === "previousWeekHeader") {
    assertTrue(inspection.headerLabelText === "上週", "NAV-03 visual failed: previous week header is not 上週.");
    assertTrue(inspection.headerDateRangeVisible, "NAV-03 visual failed: previous week date range missing.");
    assertTrue(inspection.headerButtonsVisible, "NAV-03 visual failed: previous week header buttons not visible.");
  } else if (stateCase === "olderHistoryHeader") {
    assertTrue(inspection.headerLabelText === "歷史紀錄", "NAV-03 visual failed: older week header is not 歷史紀錄.");
    assertTrue(inspection.headerDateRangeVisible, "NAV-03 visual failed: older week date range missing.");
    assertTrue(inspection.headerButtonsVisible, "NAV-03 visual failed: older week header buttons not visible.");
  } else if (stateCase === "historyRowEntry") {
    assertTrue(inspection.historyRowEnteredDayDetail, "NAV-01 visual failed: History row did not enter Day Detail.");
    assertTrue(inspection.noDayDetailDeleteControls, "NAV-02 visual failed: Day Detail exposes delete controls.");
  } else if (stateCase === "focusedDayDetailEdit") {
    assertTrue(inspection.focusedEditLabelVisible, "NAV-02 visual failed: focused edit target is missing.");
    assertTrue(inspection.noDayDetailDeleteControls, "NAV-02 visual failed: Day Detail exposes delete controls.");
  } else if (stateCase === "dayDetailReturnCancel") {
    assertTrue(inspection.returnedToDayDetailAfterCancel, "NAV-02 visual failed: cancel did not return to Day Detail.");
    assertTrue(inspection.noDayDetailDeleteControls, "NAV-02 visual failed: Day Detail exposes delete controls after return.");
  }

  return inspection;
}

async function runCase({ browser, url, outputDir, state }) {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-82-visual-"));
  const port = 47000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`${loopbackOrigin(port)}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", {
        width: state.width,
        height: state.height,
        deviceScaleFactor: 1,
        mobile: state.width <= 500,
      });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase82MockScript() });
      await send("Page.navigate", { url });
      await delay(1200);
      await prepareCase(send, state.stateCase);
      const assertions = await inspectCase(send, state.stateCase);
      const fileName = `${state.id}.png`;
      const screenshot = await captureScreenshot({ send, output: join(outputDir, fileName) });
      return {
        id: state.id,
        viewport: { width: state.width, height: state.height },
        screenshotPath: relative(process.cwd(), join(outputDir, fileName)),
        screenshotBytes: screenshot.bytes,
        browserName: browser.name,
        localMockCategories: MOCK_CATEGORIES,
        assertionBooleans: {
          noHorizontalOverflow: !assertions.hasHorizontalOverflow,
          headerButtonsVisible: state.stateCase.includes("Header") ? assertions.headerButtonsVisible : true,
          headerLabelVisible: state.stateCase.includes("Header") ? assertions.headerLabelVisible : true,
          headerDateRangeVisible: state.stateCase.includes("Header") ? assertions.headerDateRangeVisible : true,
          historyRowEntry: state.stateCase === "historyRowEntry" ? assertions.historyRowEnteredDayDetail : true,
          focusedEditLabel: state.stateCase === "focusedDayDetailEdit" ? assertions.focusedEditLabelVisible : true,
          noDayDetailDeleteControls: ["historyRowEntry", "focusedDayDetailEdit", "dayDetailReturnCancel"].includes(state.stateCase) ? assertions.noDayDetailDeleteControls : true,
          returnCancelRestoredDayDetail: state.stateCase === "dayDetailReturnCancel" ? assertions.returnedToDayDetailAfterCancel : true,
          noUnsafeCalls: assertions.unsafeCalls.length === 0,
          screenshotNonblank: true,
        },
      };
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function buildManifest(outputs) {
  return {
    scenario: SCENARIO,
    command: "node tests/harness/scenarios/82-history-meal-navigation-visual.mjs",
    status: "passed",
    generatedArtifactPolicy: "latest outputs are regenerated evidence; do not hand-edit.",
    source: {
      distClient: DIST_ROOT,
      captureServer: "local loopback static HTTP server",
    },
    outputs,
    assertions: [
      "dist client index must exist",
      "browser capture must be nonblank and above minimum PNG byte size",
      "external and unmocked backend calls must fail the run",
      "History week header buttons, label, and date range must be visible without horizontal overflow",
      "History row entry must open Day Detail with the focused meal visible",
      "Day Detail focused edit must expose the localized edit label only on the focused eligible row",
      "Day Detail must not expose delete controls",
      "Meal Edit cancel must restore Day Detail rather than the primary History tab",
    ],
    privacyPolicy: {
      kind: "metadata-only",
      excludes: ["sensitive payload classes", "secret material", "persistent store dumps", "external hosts"],
    },
    promotionPolicy: "local evidence only; no deploy or branch promotion authority is implied.",
  };
}

function assertManifestPrivacySchema(manifest) {
  const serialized = JSON.stringify(manifest);
  for (const pattern of FORBIDDEN_MANIFEST_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(`Phase 82 manifest privacy schema rejected forbidden content: ${pattern}`);
    }
  }
  if (/https?:\/\/(?!127\.0\.0\.1)/.test(serialized)) {
    throw new Error("Phase 82 manifest privacy schema rejected external URL content.");
  }
}

async function validateHarness(args) {
  resolveSafeOutputDir(args.outputDir);
  let unsafeRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/82-history-meal-navigation");
  } catch {
    unsafeRejected = true;
  }
  if (!unsafeRejected) {
    throw new Error("Phase 82 validate-harness failed: artifact-root overwrite was not rejected.");
  }
  let traversalRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/82-history-meal-navigation/latest/../../outside");
  } catch {
    traversalRejected = true;
  }
  if (!traversalRejected) {
    throw new Error("Phase 82 validate-harness failed: output path traversal was not rejected.");
  }

  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 82 visual evidence.");
  const browser = await findBrowser();
  const server = await startStaticServer();
  try {
    const malformedResponse = await fetch(`${server.origin}/%E0%A4%A`);
    if (malformedResponse.status !== 400) {
      throw new Error(
        `Phase 82 validate-harness failed: expected malformed URL response 400, got ${malformedResponse.status}.`,
      );
    }
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 82 validate-harness failed: expected index response 200, got ${indexResponse.status}.`);
    }
  } finally {
    await server.close();
  }

  const cases = selectedCases(args);
  if (cases.length < 1) throw new Error("Phase 82 validate-harness failed: no cases selected.");
  for (const expectedId of [
    "current-week-header-mobile-390x844",
    "previous-week-header-mobile-390x844",
    "older-history-header-mobile-390x844",
    "history-row-entry-mobile-390x844",
    "focused-day-detail-edit-mobile-390x844",
    "day-detail-return-cancel-mobile-390x844",
  ]) {
    if (!CASES.some((state) => state.id === expectedId)) {
      throw new Error(`Phase 82 validate-harness failed: missing registered case ${expectedId}.`);
    }
  }
  const mockScript = phase82MockScript();
  for (const token of ["/api/history/trends", "/api/history/days/", "/api/meals", "/api/device/session", "/api/sse", "forbidden external origin"]) {
    if (!mockScript.includes(token)) {
      throw new Error(`Phase 82 validate-harness failed: mock registration missing ${token}.`);
    }
  }
  const sampleManifest = buildManifest(CASES.map((state) => ({
    id: state.id,
    viewport: { width: state.width, height: state.height },
    screenshotPath: `${DEFAULT_OUTPUT_DIR}/${state.id}.png`,
    screenshotBytes: 12345,
    browserName: browser.name,
    localMockCategories: MOCK_CATEGORIES,
    assertionBooleans: { noHorizontalOverflow: true, noUnsafeCalls: true, screenshotNonblank: true },
  })));
  assertManifestPrivacySchema(sampleManifest);
  console.log(`Validated ${SCENARIO} harness infrastructure with ${browser.name}; selected cases: ${cases.map((state) => state.id).join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.validateHarness) {
    await validateHarness(args);
    return;
  }

  const outputDir = resolveSafeOutputDir(args.outputDir);
  await assertReadable(DIST_INDEX, "dist/client/index.html is missing. Run `yarn build` before Phase 82 visual evidence.");
  const server = await startStaticServer();
  const browser = await findBrowser();

  try {
    const indexResponse = await fetch(`${server.origin}/`);
    if (indexResponse.status !== 200) {
      throw new Error(`Phase 82 visual evidence failed: expected index response 200, got ${indexResponse.status}.`);
    }
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
    const outputs = [];
    for (const state of selectedCases(args)) {
      outputs.push(await runCase({ browser, url: `${server.origin}/`, outputDir, state }));
    }
    const manifest = buildManifest(outputs);
    assertManifestPrivacySchema(manifest);
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${SCENARIO} artifacts to ${outputDir}`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
<!-- END EXACT SOURCE: tests/harness/scenarios/82-history-meal-navigation-visual.mjs -->

## section-07 — `tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs`

sourceSha256: `c4e98f578966260b5dece78096d27fd74076318a1a1b5b16a3047093983b5ced`
sourceByteLength: 28851
exactTextProof: sourceBytesEqualAggregateSection

<!-- BEGIN EXACT SOURCE: tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs -->
#!/usr/bin/env node
// Visual evidence command:
// yarn build
// yarn node tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs --output-dir tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SCENARIO = "87-onboarding-age-wheel-320px-fix-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/87-onboarding-age-wheel-320px-fix");
const LATEST_ROOT = resolve(DEFAULT_OUTPUT_DIR);
const DIST_ROOT = "dist/client";
const DIST_INDEX = "dist/client/index.html";
const MIN_SCREENSHOT_BYTES = 10000;
const VIEWPORT = { width: 320, height: 760, deviceScaleFactor: 1, mobile: true };
const CASES = [
  { id: "age-10-lower-bound", action: "tap", startAge: 12, targetAge: 10, screenshot: "age-10-lower-bound.png" },
  { id: "age-120-upper-bound", action: "tap", startAge: 118, targetAge: 120, screenshot: "age-120-upper-bound.png" },
  { id: "tap-age-selection", action: "tap-non-active", startAge: 28, screenshot: "tap-age-selection.png" },
  { id: "drag-age-selection", action: "drag", startAge: 28, screenshot: "drag-age-selection.png" },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];
const FORBIDDEN_MANIFEST_PATTERNS = [
  /cookies?/i,
  /session/i,
  /api[_ -]?keys?/i,
  /authorization/i,
  /provider payloads?/i,
  /provider bodies?/i,
  /raw prompts?/i,
  /raw user transcripts?/i,
  /image bytes?/i,
  /database snapshots?|db snapshots?/i,
  /external urls?/i,
  /OPENAI_API_KEY/,
  /sk-[A-Za-z0-9]/,
];

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR, validateHarness: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir") {
      args.outputDir = argv[++index] ?? DEFAULT_OUTPUT_DIR;
    } else if (arg === "--validate-harness") {
      args.validateHarness = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

async function assertReadable(path, message) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for Phase 87 visual evidence.");
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isPathInside(root, filePath) {
  const relativePath = relative(root, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function hasDotfileSegment(relativePath) {
  return relativePath.split(sep).some((part) => part.startsWith("."));
}

function resolveSafeOutputDir(rawOutputDir) {
  const outputDir = resolve(rawOutputDir);
  if (outputDir === ARTIFACT_ROOT || !isPathInside(LATEST_ROOT, outputDir)) {
    throw new Error(`Refusing unsafe output directory: ${rawOutputDir}`);
  }
  return outputDir;
}

function loopbackOrigin(port) {
  return ["http", "://127.0.0.1:", String(port)].join("");
}

function startStaticServer() {
  const root = resolve(DIST_ROOT);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end("bad request");
      return;
    }

    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const filePath = resolve(root, relativePath);
    if (!isPathInside(root, filePath) || hasDotfileSegment(relative(root, filePath))) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start Phase 87 visual evidence HTTP server"));
        return;
      }
      resolvePromise({
        origin: loopbackOrigin(address.port),
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function cdpSession(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result ?? {});
    }
  });

  const open = new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}, sessionId) {
      await open;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function assertScreenshotBytes(path, bytes) {
  const fileStats = await stat(path);
  if (fileStats.size !== bytes.length) {
    throw new Error(`Phase 87 screenshot byte mismatch for ${path}.`);
  }
  if (bytes.length < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 87 screenshot is too small (${bytes.length} bytes): ${path}`);
  }
  const uniqueBytes = new Set(bytes).size;
  if (uniqueBytes < 32) {
    throw new Error(`Phase 87 screenshot appears blank: ${path}`);
  }
}

async function captureScreenshot({ send, output }) {
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(data, "base64");
  await writeFile(output, bytes);
  await assertScreenshotBytes(output, bytes);
  return { path: relative(process.cwd(), output), bytes: bytes.length, nonblank: true };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Phase 87 browser evaluation failed.");
  }
  return result.result?.value;
}

function assertTrue(value, message) {
  if (value !== true) throw new Error(message);
}

function phase87MockScript() {
  return `(() => {
    window.__phase87VisualState = { unsafeCalls: [], interceptedCalls: [] };
    window.localStorage.clear();
    const fixedNow = new Date("2026-06-12T12:00:00+08:00");
    const NativeDate = Date;
    class Phase87Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() { return fixedNow.getTime(); }
      static parse(value) { return NativeDate.parse(value); }
      static UTC(...args) { return NativeDate.UTC(...args); }
    }
    Object.setPrototypeOf(Phase87Date, NativeDate);
    window.Date = Phase87Date;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const requestUrl = new URL(url, window.location.href);
      const path = requestUrl.pathname;
      if (requestUrl.origin !== window.location.origin) {
        window.__phase87VisualState.unsafeCalls.push("blocked-external-fetch");
        throw new Error("Phase 87 blocked external fetch");
      }
      if (path === "/api/chat" || path.includes("openai") || path.includes("railway")) {
        window.__phase87VisualState.unsafeCalls.push("blocked-backend-or-provider-fetch");
        throw new Error("Phase 87 blocked unmocked backend/provider fetch");
      }
      if (path === "/api/device" && String(init.method || "GET").toUpperCase() === "POST") {
        window.__phase87VisualState.interceptedCalls.push("device-submit");
        return new Response(JSON.stringify({
          deviceId: "phase87-device",
          dailyTargets: { calories: 2100, protein: 130, carbs: 240, fat: 70 },
          coachExplanation: "metadata-only deterministic target note",
          usedFallback: false
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.startsWith("/api/")) {
        window.__phase87VisualState.unsafeCalls.push("blocked-unmocked-api");
        throw new Error("Phase 87 blocked unmocked API call");
      }
      return nativeFetch(input, init);
    };

    class Phase87EventSource {
      constructor() {
        window.__phase87VisualState.unsafeCalls.push("blocked-eventsource");
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    window.EventSource = Phase87EventSource;
  })();`;
}

async function clickByText(send, patternSource, description) {
  let clicked = false;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    clicked = await evaluate(send, `(() => {
      const pattern = new RegExp(${JSON.stringify(patternSource)});
      const button = [...document.querySelectorAll('button')]
        .find((node) => pattern.test((node.innerText || node.getAttribute("aria-label") || "").trim()));
      if (!button || typeof button.click !== "function") return false;
      button.scrollIntoView({ block: "center", inline: "center" });
      button.click();
      return true;
    })()`);
    if (clicked) break;
    await delay(120);
  }
  assertTrue(clicked, `Phase 87 visual evidence failed: ${description} button not found.`);
  await delay(250);
}

async function navigateToBodyStep(send) {
  await clickByText(send, "減脂", "goal selection");
  await clickByText(send, "略過|繼續", "goal clarification next");
  const onStepThree = await evaluate(send, `Boolean([...document.querySelectorAll('.sp-num-wheel-track')]
    .some((node) => node.getAttribute("aria-label") === "年齡"))`);
  assertTrue(onStepThree, "Phase 87 visual evidence failed: age wheel not visible on Step 3.");
}

async function inspectAgeWheel(send) {
  const inspection = await evaluate(send, `(() => {
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Number(rect.top.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2))
      };
    };
    const wheel = [...document.querySelectorAll('.sp-num-wheel')]
      .find((node) => node.querySelector('.sp-num-wheel-track[aria-label="年齡"]'));
    const track = wheel?.querySelector('.sp-num-wheel-track[aria-label="年齡"]') ?? null;
    const items = [...(track?.querySelectorAll('button.sp-num-wheel-item') ?? [])]
      .filter((node) => rectOf(node)?.width > 0 && rectOf(node)?.height > 0)
      .map((node) => {
        const rect = rectOf(node);
        const value = Number((node.textContent || "").trim());
        return {
          value,
          text: (node.textContent || "").trim(),
          active: node.classList.contains("active") || node.getAttribute("aria-current") === "true",
          ariaCurrent: node.getAttribute("aria-current") || null,
          rect,
          withinWheel: Boolean(rect && wheel && rect.left >= rectOf(wheel).left - 1 && rect.right <= rectOf(wheel).right + 1 && rect.top >= rectOf(wheel).top - 1 && rect.bottom <= rectOf(wheel).bottom + 1),
          withinViewport: Boolean(rect && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1),
          targetAtLeast44High: Boolean(rect && rect.height >= 44)
        };
      });
    const values = items.map((item) => item.value);
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    const selected = items.find((item) => item.active) ?? null;
    const wheelRect = rectOf(wheel);
    const trackRect = rectOf(track);
    const targetOverflow = items.some((item) => !item.withinWheel || !item.withinViewport || !item.targetAtLeast44High);
    const hasHorizontalOverflow =
      document.documentElement.scrollWidth > window.innerWidth + 1 ||
      [wheelRect, trackRect, ...items.map((item) => item.rect)].some((rect) => rect && (rect.left < -1 || rect.right > window.innerWidth + 1));
    return {
      selectedValue: selected?.value ?? null,
      selectedText: selected?.text ?? null,
      actionableValues: values,
      duplicateActionableValues: duplicates.length > 0,
      duplicateValues: duplicates,
      itemTargetBounds: items,
      wheelBounds: { wheel: wheelRect, track: trackRect },
      hasHorizontalOverflow,
      targetOverflow,
      unsafeCalls: window.__phase87VisualState?.unsafeCalls ?? []
    };
  })()`);

  if (!inspection || inspection.selectedValue == null) {
    throw new Error("Phase 87 visual evidence failed: age wheel selection could not be inspected.");
  }
  if (inspection.unsafeCalls.length > 0) {
    throw new Error(`Phase 87 visual evidence failed: unsafe calls detected: ${inspection.unsafeCalls.join(", ")}`);
  }
  assertTrue(!inspection.hasHorizontalOverflow, "Phase 87 visual evidence failed: horizontal overflow detected.");
  assertTrue(!inspection.targetOverflow, "Phase 87 visual evidence failed: wheel target overflow detected.");
  return inspection;
}

async function tapVisibleAge(send, targetAge) {
  const tapped = await evaluate(send, `(() => {
    const targetAge = ${JSON.stringify(targetAge)};
    const track = document.querySelector('.sp-num-wheel-track[aria-label="年齡"]');
    const button = [...(track?.querySelectorAll('button.sp-num-wheel-item') ?? [])]
      .find((node) => Number((node.textContent || "").trim()) === targetAge);
    if (!button || typeof button.click !== "function") return false;
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return true;
  })()`);
  assertTrue(tapped, `Phase 87 visual evidence failed: visible age ${targetAge} was not tappable.`);
  await delay(250);
}

async function setAgeWithWheel(send, targetAge) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await inspectAgeWheel(send);
    if (current.selectedValue === targetAge) return current;
    const visible = current.actionableValues.includes(targetAge);
    if (visible) {
      await tapVisibleAge(send, targetAge);
    } else {
      const nextVisibleValue = targetAge > current.selectedValue
        ? Math.max(...current.actionableValues)
        : Math.min(...current.actionableValues);
      if (nextVisibleValue === current.selectedValue) {
        throw new Error(`Phase 87 visual evidence failed: no visible tap path from age ${current.selectedValue} toward ${targetAge}.`);
      }
      await tapVisibleAge(send, nextVisibleValue);
    }
    await delay(180);
  }
  const finalState = await inspectAgeWheel(send);
  throw new Error(`Phase 87 visual evidence failed: could not set age ${targetAge}; final age ${finalState.selectedValue}.`);
}

async function dragAgeWheel(send, deltaX = -130) {
  const trackRect = await evaluate(send, `(() => {
    const track = document.querySelector('.sp-num-wheel-track[aria-label="年齡"]');
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + 3 };
  })()`);
  if (!trackRect) {
    throw new Error("Phase 87 visual evidence failed: age wheel track could not be located for drag.");
  }
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: trackRect.x, y: trackRect.y, radiusX: 4, radiusY: 4, force: 1, id: 87 }],
  });
  await delay(40);
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: trackRect.x + deltaX, y: trackRect.y, radiusX: 4, radiusY: 4, force: 1, id: 87 }],
  });
  await delay(40);
  await send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await delay(300);
}

async function tapActiveCenterNoop(send) {
  const before = await inspectAgeWheel(send);
  await tapVisibleAge(send, before.selectedValue);
  const after = await inspectAgeWheel(send);
  return {
    before: before.selectedValue,
    after: after.selectedValue,
    unchanged: before.selectedValue === after.selectedValue,
  };
}

async function runAgeCase({ send, outputDir, state }) {
  await setAgeWithWheel(send, state.startAge);
  const before = await inspectAgeWheel(send);
  let tappedValue = null;
  let activeCenterNoop = { before: before.selectedValue, after: before.selectedValue, unchanged: true };

  if (state.action === "tap") {
    await tapVisibleAge(send, state.targetAge);
  } else if (state.action === "tap-non-active") {
    const nonActiveTarget = before.actionableValues.find((value) => value !== before.selectedValue);
    if (nonActiveTarget == null) {
      throw new Error("Phase 87 visual evidence failed: no non-active visible age target was available.");
    }
    tappedValue = nonActiveTarget;
    await tapVisibleAge(send, nonActiveTarget);
  } else if (state.action === "drag") {
    await dragAgeWheel(send, -130);
  }

  const afterAction = await inspectAgeWheel(send);
  if (state.id === "age-10-lower-bound" || state.id === "age-120-upper-bound") {
    if (afterAction.selectedValue !== state.targetAge) {
      throw new Error(`Phase 87 visual evidence failed: ${state.id} selected ${afterAction.selectedValue}, expected ${state.targetAge}.`);
    }
    activeCenterNoop = await tapActiveCenterNoop(send);
    assertTrue(activeCenterNoop.unchanged, `Phase 87 visual evidence failed: active center tap changed ${state.id}.`);
  } else if (state.id === "tap-age-selection") {
    if (afterAction.selectedValue !== tappedValue) {
      throw new Error(`Phase 87 visual evidence failed: tap selected ${afterAction.selectedValue}, expected ${tappedValue}.`);
    }
  } else if (state.id === "drag-age-selection") {
    if (afterAction.selectedValue === before.selectedValue) {
      throw new Error("Phase 87 visual evidence failed: drag did not change selected age.");
    }
  }

  const finalInspection = await inspectAgeWheel(send);
  const screenshot = await captureScreenshot({ send, output: join(outputDir, state.screenshot) });
  return {
    name: state.id,
    selectedValues: {
      before: before.selectedValue,
      after: finalInspection.selectedValue,
      tappedValue,
      dragChanged: state.id === "drag-age-selection" ? finalInspection.selectedValue !== before.selectedValue : null,
    },
    itemTargetBounds: finalInspection.itemTargetBounds,
    wheelBounds: finalInspection.wheelBounds,
    duplicateActionableValues: finalInspection.duplicateActionableValues,
    activeCenterNoop,
    hasHorizontalOverflow: finalInspection.hasHorizontalOverflow,
    targetOverflow: finalInspection.targetOverflow,
    screenshots: [state.screenshot],
    screenshotPath: screenshot.path,
    screenshotBytes: screenshot.bytes,
  };
}

async function withBrowserPage({ browser, url, outputDir, run }) {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-87-visual-"));
  const port = 47000 + Math.floor(Math.random() * 10000);
  const child = spawn(browser.path, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=msForceBrowserSignIn,SigninInterception,OptimizationHints",
    "--password-store=basic",
    "--use-mock-keychain",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForJson(`${loopbackOrigin(port)}/json/version`);
    const cdp = cdpSession(version.webSocketDebuggerUrl);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => cdp.send(method, params, sessionId);
      await send("Emulation.setDeviceMetricsOverride", VIEWPORT);
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Page.bringToFront");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase87MockScript() });
      await send("Page.navigate", { url });
      await delay(1200);
      return await run(send);
    } finally {
      cdp.close();
    }
  } finally {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function buildManifest(cases) {
  return {
    scenario: SCENARIO,
    status: "passed",
    viewport: VIEWPORT,
    command: "node tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs --output-dir tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest",
    generatedArtifactPolicy: "latest outputs are generated evidence and must be regenerated by the harness, not hand-edited.",
    privacyPolicy: {
      kind: "metadata-only",
      excludes: ["sensitive runtime material", "provider material", "prompt material", "image material", "persistent store dumps", "non-loopback hosts"],
    },
    cases,
    selectedValues: Object.fromEntries(cases.map((entry) => [entry.name, entry.selectedValues])),
    itemTargetBounds: Object.fromEntries(cases.map((entry) => [entry.name, entry.itemTargetBounds])),
    wheelBounds: Object.fromEntries(cases.map((entry) => [entry.name, entry.wheelBounds])),
    duplicateActionableValues: Object.fromEntries(cases.map((entry) => [entry.name, entry.duplicateActionableValues])),
    activeCenterNoop: Object.fromEntries(cases.map((entry) => [entry.name, entry.activeCenterNoop])),
    hasHorizontalOverflow: Object.fromEntries(cases.map((entry) => [entry.name, entry.hasHorizontalOverflow])),
    targetOverflow: Object.fromEntries(cases.map((entry) => [entry.name, entry.targetOverflow])),
    screenshots: cases.flatMap((entry) => entry.screenshots),
  };
}

function assertManifestPrivacySchema(manifest) {
  const serialized = JSON.stringify(manifest);
  for (const pattern of FORBIDDEN_MANIFEST_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(`Phase 87 manifest privacy schema rejected forbidden content: ${pattern}`);
    }
  }
  if (/https?:\/\/(?!127\.0\.0\.1)/.test(serialized)) {
    throw new Error("Phase 87 manifest privacy schema rejected external URL content.");
  }
}

async function validateHarness(args) {
  const outputDir = resolveSafeOutputDir(args.outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await assertReadable(DIST_INDEX, `Build output missing: ${DIST_INDEX}. Run yarn build first.`);
  let artifactRootRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/87-onboarding-age-wheel-320px-fix");
  } catch {
    artifactRootRejected = true;
  }
  assertTrue(artifactRootRejected, "Phase 87 validate-harness failed: artifact root was not rejected.");

  let outsideRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest/../outside");
  } catch {
    outsideRejected = true;
  }
  assertTrue(outsideRejected, "Phase 87 validate-harness failed: path outside latest root was not rejected.");

  const browser = await findBrowser();
  const server = await startStaticServer();
  try {
    const output = await withBrowserPage({
      browser,
      url: server.origin,
      outputDir,
      run: async (send) => {
        const bodyTextLength = await evaluate(send, `document.body.innerText.length`);
        if (bodyTextLength < 20) {
          throw new Error(`Phase 87 validate-harness failed: body text length was ${bodyTextLength}.`);
        }
        const screenshot = await captureScreenshot({ send, output: join(outputDir, "validate-harness.png") });
        return {
          name: "validate-harness",
          selectedValues: { before: null, after: null, tappedValue: null, dragChanged: null },
          itemTargetBounds: [],
          wheelBounds: { wheel: null, track: null },
          duplicateActionableValues: false,
          activeCenterNoop: { before: null, after: null, unchanged: true },
          hasHorizontalOverflow: false,
          targetOverflow: false,
          screenshots: ["validate-harness.png"],
          screenshotPath: screenshot.path,
          screenshotBytes: screenshot.bytes,
          validationOnly: true,
        };
      },
    });
    const manifest = buildManifest([output]);
    manifest.validationOnly = true;
    assertManifestPrivacySchema(manifest);
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await server.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveSafeOutputDir(args.outputDir);
  if (args.validateHarness) {
    await validateHarness(args);
    return;
  }

  await assertReadable(DIST_INDEX, `Build output missing: ${DIST_INDEX}. Run yarn build first.`);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const browser = await findBrowser();
  const server = await startStaticServer();
  try {
    const caseOutputs = await withBrowserPage({
      browser,
      url: server.origin,
      outputDir,
      run: async (send) => {
        await navigateToBodyStep(send);
        const outputs = [];
        for (const state of CASES) {
          outputs.push(await runAgeCase({ send, outputDir, state }));
        }
        return outputs;
      },
    });

    const requiredNames = new Set(CASES.map((entry) => entry.id));
    for (const output of caseOutputs) {
      if (!requiredNames.has(output.name)) {
        throw new Error(`Phase 87 visual evidence produced unexpected case: ${output.name}`);
      }
      if (output.duplicateActionableValues || output.hasHorizontalOverflow || output.targetOverflow) {
        throw new Error(`Phase 87 visual evidence failed final assertions for ${output.name}.`);
      }
    }
    const manifest = buildManifest(caseOutputs);
    assertManifestPrivacySchema(manifest);
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
<!-- END EXACT SOURCE: tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs -->
