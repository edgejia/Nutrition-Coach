#!/usr/bin/env node
// Visual evidence command:
// yarn node tests/harness/scenarios/110-home-nutrition-animation-visual.mjs --output-dir tests/harness/artifacts/110-home-nutrition-animation/latest
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCENARIO = "110-home-nutrition-animation-visual";
const DEFAULT_OUTPUT_DIR = "tests/harness/artifacts/110-home-nutrition-animation/latest";
const ARTIFACT_ROOT = resolve("tests/harness/artifacts/110-home-nutrition-animation");
const LATEST_ROOT = resolve(DEFAULT_OUTPUT_DIR);
const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const MIN_SCREENSHOT_BYTES = 10000;
const KCAL_SAMPLE_INTERVAL_MS = 16;
const ANIMATION_TIMEOUT_MS = 1500;
const MIN_INTERIOR_SAMPLES = 3;
const MIN_INTERIOR_SPAN_MS = 32;
const FRAME_CAPTURE_DELAY_MS = 80;
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const CASES = [
  { id: "cold-start-replay", trigger: "initial-load", animationKind: "replay", mealSet: "base" },
  { id: "manual-replay-unchanged", trigger: "pull-to-refresh", animationKind: "replay", mealSet: "base" },
  { id: "delta-up", trigger: "pull-to-refresh", animationKind: "delta", mealSet: "up" },
  { id: "delta-down", trigger: "pull-to-refresh", animationKind: "delta", mealSet: "down" },
];
const BROWSER_CANDIDATES = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
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

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate.path, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Google Chrome or Microsoft Edge executable is required for Phase 110 visual evidence.");
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

function runBuildCommand(argv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal || code !== 0) {
        reject(new Error(`Phase 110 current-worktree browser build failed (${signal ?? code}).`));
        return;
      }
      resolvePromise();
    });
  });
}

async function prepareHarnessBundle(outputDir) {
  const bundleRoot = join(outputDir, "browser-bundle");
  const outDirArgument = relative(join(REPO_ROOT, "client"), bundleRoot).split(sep).join("/");
  await runBuildCommand([
    "yarn",
    "vite",
    "build",
    "--config",
    "client/vite.config.ts",
    "--outDir",
    outDirArgument,
    "--emptyOutDir",
  ]);
  await access(join(bundleRoot, "index.html"), constants.R_OK);
  return { bundleRoot };
}

function startStaticServer(bundleContext) {
  const root = bundleContext.bundleRoot;
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
        reject(new Error("Could not start Phase 110 visual evidence HTTP server"));
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
    throw new Error(`Phase 110 screenshot byte mismatch for ${path}.`);
  }
  if (bytes.length < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 110 screenshot is too small (${bytes.length} bytes): ${path}`);
  }
  const uniqueBytes = new Set(bytes).size;
  if (uniqueBytes < 32) {
    throw new Error(`Phase 110 screenshot appears blank: ${path}`);
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
    throw new Error(result.exceptionDetails.text ?? "Phase 110 browser evaluation failed.");
  }
  return result.result?.value;
}

function assertTrue(value, message) {
  if (value !== true) throw new Error(message);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isStrictlyBetween(value, start, terminal) {
  return Math.min(start, terminal) < value && value < Math.max(start, terminal);
}

export function assertAnimationReadings({
  caseName,
  expectedStartKcal,
  requireStartSample = false,
  midKcal,
  terminalKcal,
  expectedTerminalKcal,
  sampleSequence,
  midFrameBinding,
  terminalFrameBinding,
  terminalAnimationState,
}) {
  const readings = { expectedStartKcal, midKcal, terminalKcal, expectedTerminalKcal };
  for (const [name, value] of Object.entries(readings)) {
    if (!isFiniteNumber(value)) {
      throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: ${name} must be a finite number.`);
    }
  }
  if (expectedStartKcal === expectedTerminalKcal) {
    throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: animation endpoints must differ.`);
  }
  if (terminalKcal !== expectedTerminalKcal) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: terminal kcal ${terminalKcal} did not match expected ${expectedTerminalKcal}.`,
    );
  }
  if (!isStrictlyBetween(midKcal, expectedStartKcal, expectedTerminalKcal)) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: midpoint kcal ${midKcal} was not strictly between semantic start ${expectedStartKcal} and terminal ${expectedTerminalKcal}.`,
    );
  }
  if (terminalAnimationState !== "complete") {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: terminal frame was captured before animation completion.`,
    );
  }
  assertFrameBinding({ caseName, kind: "mid", binding: midFrameBinding, expectedKcal: midKcal });
  assertFrameBinding({
    caseName,
    kind: "terminal",
    binding: terminalFrameBinding,
    expectedKcal: terminalKcal,
  });
  if (!Array.isArray(sampleSequence) || sampleSequence.length === 0) {
    throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: sample sequence is required.`);
  }
  const ascending = expectedTerminalKcal > expectedStartKcal;
  let previousKcal;
  let previousElapsedMs = -Infinity;
  let observedRunning = false;
  const distinctInterior = new Map();
  for (const sample of sampleSequence) {
    if (!isFiniteNumber(sample?.kcal) || !isFiniteNumber(sample?.elapsedMs)) {
      throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: samples must be finite.`);
    }
    if (sample.elapsedMs < previousElapsedMs) {
      throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: sample time must be monotonic.`);
    }
    if (
      sample.kcal < Math.min(expectedStartKcal, expectedTerminalKcal) ||
      sample.kcal > Math.max(expectedStartKcal, expectedTerminalKcal)
    ) {
      throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: sample left animation endpoints.`);
    }
    if (
      isFiniteNumber(previousKcal) &&
      ((ascending && sample.kcal < previousKcal) || (!ascending && sample.kcal > previousKcal))
    ) {
      const direction = ascending ? "non-decreasing" : "non-increasing";
      throw new Error(
        `Phase 110 interpolation evidence failed for ${caseName}: sample sequence must be monotonically ${direction}.`,
      );
    }
    if (sample.animationState === "running") observedRunning = true;
    if (isStrictlyBetween(sample.kcal, expectedStartKcal, expectedTerminalKcal)) {
      distinctInterior.set(sample.kcal, distinctInterior.get(sample.kcal) ?? sample.elapsedMs);
    }
    previousKcal = sample.kcal;
    previousElapsedMs = sample.elapsedMs;
  }
  if (distinctInterior.size < MIN_INTERIOR_SAMPLES) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: at least ${MIN_INTERIOR_SAMPLES} distinct interior samples are required.`,
    );
  }
  const interiorTimes = [...distinctInterior.values()];
  const interiorSpanMs = Math.max(...interiorTimes) - Math.min(...interiorTimes);
  if (interiorSpanMs < MIN_INTERIOR_SPAN_MS) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: interior samples must span at least ${MIN_INTERIOR_SPAN_MS}ms.`,
    );
  }
  const finalSample = sampleSequence.at(-1);
  if (
    requireStartSample &&
    !sampleSequence.some(
      (sample) => sample.animationState === "running" && sample.kcal === expectedStartKcal,
    )
  ) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: semantic start kcal ${expectedStartKcal} was not observed before interpolation.`,
    );
  }
  if (
    !observedRunning ||
    finalSample?.animationState !== "complete" ||
    finalSample?.kcal !== expectedTerminalKcal
  ) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: running-to-complete lifecycle was not observed.`,
    );
  }
  return {
    midKcalStrictlyBetween: true,
    terminalKcalMatchesExpected: true,
    monotonicSequenceObserved: true,
    terminalCapturedAfterCompletion: true,
    frameBindingsStable: true,
    distinctInteriorSampleCount: distinctInterior.size,
    interiorSampleSpanMs: interiorSpanMs,
  };
}

export function assertFrameBinding({ caseName, kind, binding, expectedKcal }) {
  const comparableFrame = (frame) => {
    if (!frame || typeof frame !== "object") return frame;
    const { observedAtMs: _observedAtMs, ...comparable } = frame;
    return comparable;
  };
  if (
    !binding ||
    !isFiniteNumber(binding.captureDelayMs) ||
    binding.captureDelayMs < 0 ||
    !binding.before ||
    !binding.after
  ) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: ${kind} frame binding was incomplete.`,
    );
  }
  if (binding.before.animationFramesFrozen !== true || binding.after.animationFramesFrozen !== true) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: ${kind} frame was not captured while frozen.`,
    );
  }
  if (JSON.stringify(comparableFrame(binding.before)) !== JSON.stringify(comparableFrame(binding.after))) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: ${kind} frame changed during capture delay.`,
    );
  }
  if (binding.after.kcal !== expectedKcal) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseName}: ${kind} manifest kcal was not the frozen reread.`,
    );
  }
  return { stable: true, manifestKcal: binding.after.kcal };
}

export async function captureFrozenFrame({
  caseName,
  kind,
  freezeAndRead,
  readFrozen,
  capture,
  resume,
  captureDelayMs = FRAME_CAPTURE_DELAY_MS,
  wait = delay,
}) {
  let before;
  try {
    before = await freezeAndRead();
    await wait(captureDelayMs);
    const screenshot = await capture();
    const after = await readFrozen();
    const binding = { before, after, captureDelayMs };
    assertFrameBinding({ caseName, kind, binding, expectedKcal: after?.kcal });
    return { screenshot, binding, frame: after };
  } finally {
    const resumed = await resume();
    if (resumed !== true) {
      throw new Error(`Phase 110 interpolation evidence failed for ${caseName}: ${kind} frame did not resume.`);
    }
  }
}

function phase110MockScript() {
  return `(() => {
    window.__phase110VisualState = { unsafeCalls: [], interceptedCalls: [] };
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    let nextAnimationFrameId = 1;
    let animationFramesFrozen = false;
    const scheduledAnimationFrames = new Map();
    const queuedAnimationFrames = new Map();
    const scheduleAnimationFrame = (id, callback) => {
      const nativeId = nativeRequestAnimationFrame((timestamp) => {
        scheduledAnimationFrames.delete(id);
        if (animationFramesFrozen) {
          queuedAnimationFrames.set(id, callback);
          return;
        }
        callback(timestamp);
      });
      scheduledAnimationFrames.set(id, { nativeId, callback });
    };
    window.requestAnimationFrame = (callback) => {
      const id = nextAnimationFrameId++;
      if (animationFramesFrozen) queuedAnimationFrames.set(id, callback);
      else scheduleAnimationFrame(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const scheduled = scheduledAnimationFrames.get(id);
      if (scheduled) nativeCancelAnimationFrame(scheduled.nativeId);
      scheduledAnimationFrames.delete(id);
      queuedAnimationFrames.delete(id);
    };
    window.__phase110AnimationFrameGate = {
      freeze() {
        if (animationFramesFrozen) throw new Error("Phase 110 animation frame gate is already frozen");
        animationFramesFrozen = true;
        for (const [id, scheduled] of scheduledAnimationFrames) {
          nativeCancelAnimationFrame(scheduled.nativeId);
          queuedAnimationFrames.set(id, scheduled.callback);
        }
        scheduledAnimationFrames.clear();
      },
      resume() {
        if (!animationFramesFrozen) return;
        animationFramesFrozen = false;
        const queued = [...queuedAnimationFrames];
        queuedAnimationFrames.clear();
        for (const [id, callback] of queued) scheduleAnimationFrame(id, callback);
      },
      isFrozen() { return animationFramesFrozen; }
    };
    window.localStorage.clear();
    const fixedNow = new Date("2026-07-08T12:00:00+08:00");
    const NativeDate = Date;
    class Phase110Date extends NativeDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow.getTime()] : args));
      }
      static now() { return fixedNow.getTime(); }
      static parse(value) { return NativeDate.parse(value); }
      static UTC(...args) { return NativeDate.UTC(...args); }
    }
    Object.setPrototypeOf(Phase110Date, NativeDate);
    window.Date = Phase110Date;

    const today = "2026-07-08";
    const dailyTargets = { calories: 2100, protein: 130, carbs: 240, fat: 70 };
    const mealSets = {
      base: [
        { id: "phase110-breakfast", mealRevisionId: "rev-base-1", foodName: "燕麥優格碗", calories: 410, protein: 28, carbs: 58, fat: 10, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T08:15:00+08:00", mealPeriod: "breakfast" },
        { id: "phase110-lunch", mealRevisionId: "rev-base-2", foodName: "雞胸糙米餐", calories: 620, protein: 46, carbs: 72, fat: 18, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T12:35:00+08:00", mealPeriod: "lunch" }
      ],
      up: [
        { id: "phase110-breakfast", mealRevisionId: "rev-up-1", foodName: "燕麥優格碗", calories: 410, protein: 28, carbs: 58, fat: 10, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T08:15:00+08:00", mealPeriod: "breakfast" },
        { id: "phase110-lunch", mealRevisionId: "rev-up-2", foodName: "雞胸糙米餐", calories: 620, protein: 46, carbs: 72, fat: 18, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T12:35:00+08:00", mealPeriod: "lunch" },
        { id: "phase110-snack", mealRevisionId: "rev-up-3", foodName: "香蕉乳清", calories: 260, protein: 26, carbs: 34, fat: 4, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T15:20:00+08:00", mealPeriod: "late_night" }
      ],
      down: [
        { id: "phase110-breakfast", mealRevisionId: "rev-down-1", foodName: "燕麥優格碗", calories: 410, protein: 28, carbs: 58, fat: 10, itemCount: 1, items: [], imageAssetId: null, imageUrl: null, loggedAt: today + "T08:15:00+08:00", mealPeriod: "breakfast" }
      ]
    };

    window.__phase110SetMealSet = (name) => {
      window.__phase110CurrentMealSet = name;
    };
    window.__phase110MealTotals = (name = window.__phase110CurrentMealSet) =>
      (mealSets[name] || []).reduce((sum, meal) => ({
        kcal: sum.kcal + meal.calories,
        protein: sum.protein + meal.protein,
        carbs: sum.carbs + meal.carbs,
        fat: sum.fat + meal.fat
      }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

    window.localStorage.setItem("deviceId", "phase110-device");
    window.localStorage.setItem("goal", "phase110-demo-goal");
    window.localStorage.setItem("dailyTargets", JSON.stringify(dailyTargets));
    window.__phase110CurrentMealSet = "base";

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url || "";
      const requestUrl = new URL(url, window.location.href);
      const path = requestUrl.pathname;
      const method = String(init.method || "GET").toUpperCase();
      if (requestUrl.origin !== window.location.origin) {
        window.__phase110VisualState.unsafeCalls.push("blocked-external-fetch");
        throw new Error("Phase 110 blocked external fetch");
      }
      if (path === "/api/chat" || path.includes("openai") || path.includes("railway")) {
        window.__phase110VisualState.unsafeCalls.push("blocked-backend-or-provider-fetch");
        throw new Error("Phase 110 blocked unmocked backend/provider fetch");
      }
      if (path === "/api/device/session" && method === "POST") {
        window.__phase110VisualState.interceptedCalls.push("device-session");
        return new Response(JSON.stringify({
          deviceId: "phase110-device",
          goal: "phase110-demo-goal",
          dailyTargets
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/meals" && method === "GET") {
        window.__phase110VisualState.interceptedCalls.push("meals-" + window.__phase110CurrentMealSet);
        return new Response(JSON.stringify({
          meals: mealSets[window.__phase110CurrentMealSet] || []
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/chat/history" && method === "GET") {
        window.__phase110VisualState.interceptedCalls.push("chat-history");
        return new Response(JSON.stringify({ messages: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.startsWith("/api/history") || path.startsWith("/api/day-snapshot")) {
        window.__phase110VisualState.interceptedCalls.push("history-stub");
        return new Response(JSON.stringify({ daily: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, averages: { calories: 0, protein: 0, carbs: 0, fat: 0 }, date: today, summary: { date: today, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 }, meals: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.startsWith("/api/observability")) {
        window.__phase110VisualState.interceptedCalls.push("observability");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.startsWith("/api/")) {
        window.__phase110VisualState.unsafeCalls.push("blocked-unmocked-api");
        throw new Error("Phase 110 blocked unmocked API call: " + path);
      }
      return nativeFetch(input, init);
    };

    class Phase110EventSource {
      constructor() {
        window.__phase110VisualState.interceptedCalls.push("eventsource-noop");
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    window.EventSource = Phase110EventSource;
  })();`;
}

async function waitForHome(send) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(send, `Boolean(document.querySelector('.home-sport-hero') && document.querySelector('.home-sport-scroll'))`);
    if (ready) return;
    await delay(100);
  }
  throw new Error("Phase 110 visual evidence failed: Home screen did not become ready.");
}

function homeFrameExpression(freeze) {
  return `(() => {
    if (${freeze ? "true" : "false"}) window.__phase110AnimationFrameGate?.freeze();
    const parseNumber = (text) => {
      const parsed = Number(String(text || "").replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const hero = document.querySelector('.home-sport-hero');
    const macroCards = [...document.querySelectorAll('.home-sport-macro-card')];
    return {
      kcal: parseNumber(hero?.querySelector('.home-sport-calorie-copy .sp-display')?.textContent),
      percent: parseNumber(hero?.querySelector('.home-sport-ring-label .sp-display')?.textContent),
      ringDashOffset: parseNumber(hero?.querySelector('.sp-ring-progress')?.getAttribute('stroke-dashoffset')),
      macros: macroCards.map((card) => ({
        grams: parseNumber(card.querySelector('.home-sport-macro-value span')?.textContent),
        percent: parseNumber(card.querySelector('.home-sport-macro-percent')?.textContent),
        barWidth: card.querySelector('.sp-bar-fill')?.style.width || null
      })),
      animationState: hero?.getAttribute('data-home-animation-state') || null,
      observedAtMs: Math.round(performance.now() * 1000) / 1000,
      animationFramesFrozen: window.__phase110AnimationFrameGate?.isFrozen() === true
    };
  })()`;
}

async function readHomeFrame(send) {
  return evaluate(send, homeFrameExpression(false));
}

async function freezeAndReadHomeFrame(send) {
  return evaluate(send, homeFrameExpression(true));
}

async function resumeAnimationFrames(send) {
  return evaluate(send, `(() => {
    window.__phase110AnimationFrameGate?.resume();
    return window.__phase110AnimationFrameGate?.isFrozen() === false;
  })()`);
}

async function freezeAnimationFrames(send) {
  return evaluate(send, `(() => {
    window.__phase110AnimationFrameGate?.freeze();
    return window.__phase110AnimationFrameGate?.isFrozen() === true;
  })()`);
}

async function waitForSemanticStart(send, expectedStartKcal) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const frame = await readHomeFrame(send);
    if (frame?.animationState === "running" && frame.kcal === expectedStartKcal) return frame;
    await delay(KCAL_SAMPLE_INTERVAL_MS);
  }
  throw new Error(
    `Phase 110 interpolation evidence failed: semantic start kcal ${expectedStartKcal} was not observed while rAF was frozen.`,
  );
}

async function readKcal(send) {
  const frame = await readHomeFrame(send);
  return isFiniteNumber(frame?.kcal) ? frame.kcal : null;
}

async function inspectHome(send) {
  const inspection = await evaluate(send, `(() => {
    const hero = document.querySelector('.home-sport-hero');
    const scroll = document.querySelector('.home-sport-scroll');
    const rect = hero?.getBoundingClientRect();
    return {
      hasHero: Boolean(hero),
      hasScroll: Boolean(scroll),
      scrollTop: scroll?.scrollTop ?? null,
      heroRect: rect ? { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      kcal: (() => {
        const node = document.querySelector('.home-sport-hero .sp-display');
        const parsed = Number((node?.textContent || "").replace(/,/g, "").trim());
        return Number.isFinite(parsed) ? parsed : null;
      })(),
      animationState: hero?.getAttribute('data-home-animation-state') || null,
      unsafeCalls: window.__phase110VisualState?.unsafeCalls ?? [],
      interceptedCallCount: window.__phase110VisualState?.interceptedCalls?.length ?? 0
    };
  })()`);
  assertTrue(Boolean(inspection?.hasHero), "Phase 110 visual evidence failed: Home hero not present.");
  assertTrue(Boolean(inspection?.hasScroll), "Phase 110 visual evidence failed: Home scroll container not present.");
  if (inspection.unsafeCalls.length > 0) {
    throw new Error(`Phase 110 visual evidence failed: unsafe calls detected: ${inspection.unsafeCalls.join(", ")}`);
  }
  return inspection;
}

async function triggerPullRefresh(send, mealSet) {
  await evaluate(send, `window.__phase110SetMealSet(${JSON.stringify(mealSet)})`);
  const point = await evaluate(send, `(() => {
    const scroll = document.querySelector('.home-sport-scroll');
    if (!scroll) return null;
    scroll.scrollTop = 0;
    const rect = scroll.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 24) };
  })()`);
  if (!point) {
    throw new Error("Phase 110 visual evidence failed: could not locate pull-to-refresh touch point.");
  }
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1, id: 110 }],
  });
  await delay(40);
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: point.x, y: point.y + 96, radiusX: 4, radiusY: 4, force: 1, id: 110 }],
  });
  await delay(40);
  await send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

function toAnimationSample(frame, sequenceStartedAtMs) {
  return {
    kcal: frame.kcal,
    elapsedMs: Math.max(0, Math.round((frame.observedAtMs - sequenceStartedAtMs) * 1000) / 1000),
    animationState: frame.animationState,
  };
}

function midpointCandidateReady(samples, expectedStartKcal, expectedTerminalKcal) {
  const distinctInterior = new Map();
  for (const sample of samples) {
    if (isStrictlyBetween(sample.kcal, expectedStartKcal, expectedTerminalKcal)) {
      distinctInterior.set(sample.kcal, distinctInterior.get(sample.kcal) ?? sample.elapsedMs);
    }
  }
  if (distinctInterior.size < MIN_INTERIOR_SAMPLES) return false;
  const times = [...distinctInterior.values()];
  return Math.max(...times) - Math.min(...times) >= MIN_INTERIOR_SPAN_MS;
}

async function captureFramePair({
  send,
  outputDir,
  caseId,
  expectedStartKcal,
  expectedTerminalKcal,
  initialFrame = null,
}) {
  const wallStartedAt = Date.now();
  let sequenceStartedAtMs = initialFrame?.observedAtMs ?? null;
  let sawRunning = initialFrame?.animationState === "running";
  let midCapture = null;
  let terminalCapture = null;
  const sampleSequence = initialFrame
    ? [toAnimationSample(initialFrame, initialFrame.observedAtMs)]
    : [];

  while (Date.now() - wallStartedAt < ANIMATION_TIMEOUT_MS) {
    const frame = await readHomeFrame(send);
    if (frame?.animationState === "running") {
      if (!sawRunning) sequenceStartedAtMs = frame.observedAtMs;
      sawRunning = true;
    }
    if (sawRunning && isFiniteNumber(frame?.kcal) && isFiniteNumber(frame?.observedAtMs)) {
      sampleSequence.push(toAnimationSample(frame, sequenceStartedAtMs));
    }

    if (
      sawRunning &&
      !midCapture &&
      frame?.animationState === "running" &&
      midpointCandidateReady(sampleSequence, expectedStartKcal, expectedTerminalKcal)
    ) {
      midCapture = await captureFrozenFrame({
        caseName: caseId,
        kind: "mid",
        freezeAndRead: () => freezeAndReadHomeFrame(send),
        readFrozen: () => readHomeFrame(send),
        capture: () =>
          captureScreenshot({ send, output: join(outputDir, `${caseId}-mid.png`) }),
        resume: () => resumeAnimationFrames(send),
      });
      if (
        midCapture.frame.animationState !== "running" ||
        !isStrictlyBetween(midCapture.frame.kcal, expectedStartKcal, expectedTerminalKcal)
      ) {
        throw new Error(
          `Phase 110 interpolation evidence failed for ${caseId}: frozen midpoint was not an active interior frame.`,
        );
      }
      sampleSequence.push(toAnimationSample(midCapture.frame, sequenceStartedAtMs));
    }

    if (sawRunning && frame?.animationState === "complete") {
      if (!midCapture) {
        throw new Error(
          `Phase 110 interpolation evidence failed for ${caseId}: animation completed before midpoint proof was captured.`,
        );
      }
      terminalCapture = await captureFrozenFrame({
        caseName: caseId,
        kind: "terminal",
        freezeAndRead: () => freezeAndReadHomeFrame(send),
        readFrozen: () => readHomeFrame(send),
        capture: () =>
          captureScreenshot({ send, output: join(outputDir, `${caseId}-terminal.png`) }),
        resume: () => resumeAnimationFrames(send),
      });
      break;
    }
    await delay(KCAL_SAMPLE_INTERVAL_MS);
  }

  if (!terminalCapture) {
    throw new Error(
      `Phase 110 interpolation evidence failed for ${caseId}: timed out waiting for running-to-complete lifecycle.`,
    );
  }
  const midFrame = midCapture.frame;
  const terminalFrame = terminalCapture.frame;
  const mid = midCapture.screenshot;
  const terminal = terminalCapture.screenshot;
  return {
    frames: [
      {
        kind: "mid",
        file: `${caseId}-mid.png`,
        path: mid.path,
        bytes: mid.bytes,
        nonblank: mid.nonblank,
        kcal: midFrame.kcal,
        animationState: midFrame.animationState,
        binding: midCapture.binding,
      },
      {
        kind: "terminal",
        file: `${caseId}-terminal.png`,
        path: terminal.path,
        bytes: terminal.bytes,
        nonblank: terminal.nonblank,
        kcal: terminalFrame.kcal,
        animationState: terminalFrame.animationState,
        binding: terminalCapture.binding,
      },
    ],
    sampleSequence,
    sampleElapsedMs: {
      midpoint: midCapture.binding.after.observedAtMs - sequenceStartedAtMs,
      completion: terminalCapture.binding.after.observedAtMs - sequenceStartedAtMs,
    },
  };
}

async function runHomeCase({ send, outputDir, state }) {
  await waitForHome(send);
  let startKcal = null;
  let initialFrame = null;
  const expectedTotals = await evaluate(send, `window.__phase110MealTotals(${JSON.stringify(state.mealSet)})`);
  let expectedStartKcal = state.animationKind === "replay" ? 0 : null;
  if (state.trigger === "pull-to-refresh") {
    startKcal = await readKcal(send);
    expectedStartKcal = state.animationKind === "replay" ? 0 : startKcal;
    const replayStartKcal = state.animationKind === "replay" ? 0 : startKcal;
    assertTrue(await freezeAnimationFrames(send), `Phase 110 failed to freeze rAF before ${state.id}.`);
    try {
      await triggerPullRefresh(send, state.mealSet);
      initialFrame = await waitForSemanticStart(send, replayStartKcal);
    } finally {
      if (!(await resumeAnimationFrames(send))) {
        throw new Error(`Phase 110 failed to resume rAF after semantic start for ${state.id}.`);
      }
    }
  }
  const framePair = await captureFramePair({
    send,
    outputDir,
    caseId: state.id,
    expectedStartKcal,
    expectedTerminalKcal: expectedTotals?.kcal,
    initialFrame,
  });
  const midKcal = framePair.frames[0]?.kcal ?? null;
  const terminalKcal = framePair.frames[1]?.kcal ?? null;
  const assertionBooleans = assertAnimationReadings({
    caseName: state.id,
    expectedStartKcal,
    requireStartSample: state.trigger !== "initial-load",
    midKcal,
    terminalKcal,
    expectedTerminalKcal: expectedTotals?.kcal,
    sampleSequence: framePair.sampleSequence,
    midFrameBinding: framePair.frames[0]?.binding,
    terminalFrameBinding: framePair.frames[1]?.binding,
    terminalAnimationState: framePair.frames[1]?.animationState,
  });
  const inspection = await inspectHome(send);
  return {
    name: state.id,
    trigger: state.trigger,
    animationKind: state.animationKind,
    expectedMealSet: state.mealSet,
    expectedTotals,
    readings: {
      startKcal,
      expectedStartKcal,
      midKcal,
      terminalKcal,
      strictlyBetweenKcal: assertionBooleans.midKcalStrictlyBetween,
      terminalMatchesExpectedKcal: assertionBooleans.terminalKcalMatchesExpected,
      sampleElapsedMs: framePair.sampleElapsedMs,
      sampleSequence: framePair.sampleSequence,
      distinctInteriorSampleCount: assertionBooleans.distinctInteriorSampleCount,
      interiorSampleSpanMs: assertionBooleans.interiorSampleSpanMs,
      terminalAnimationState: framePair.frames[1]?.animationState ?? null,
    },
    assertionBooleans,
    triggerDocumentation:
      state.trigger === "initial-load"
        ? "initial load: Home mounts and the first authoritative meals response arms the cold-start replay"
        : "pull-to-refresh at scrollTop 0 after reissuing the mocked /api/meals payload",
    frames: framePair.frames,
    screenshots: framePair.frames.map((frame) => frame.file),
    homeInspection: inspection,
  };
}

async function withBrowserPage({ browser, url, outputDir, run }) {
  await mkdir(outputDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-110-visual-"));
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
      await send("Page.addScriptToEvaluateOnNewDocument", { source: phase110MockScript() });
      await send("Page.navigate", { url });
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
    command: "yarn node tests/harness/scenarios/110-home-nutrition-animation-visual.mjs --output-dir tests/harness/artifacts/110-home-nutrition-animation/latest",
    generatedArtifactPolicy: "latest outputs are generated evidence and must be regenerated by the harness, not hand-edited.",
    bundlePolicy: "Each run builds a fresh scenario-owned Vite bundle with --emptyOutDir; no pre-existing dist/client is used.",
    cases,
    framePolicy: "Each PNG is captured while the injected requestAnimationFrame gate is frozen; DOM nutrition fields are reread after an intentional capture delay, must remain identical, and the reread is the manifest value.",
    timingProofPolicy: `The harness requires a running-to-complete lifecycle, a monotonic endpoint-bounded sequence with at least ${MIN_INTERIOR_SAMPLES} distinct interior kcal samples spanning at least ${MIN_INTERIOR_SPAN_MS}ms, and terminal capture only after the Home DOM reports complete.`,
    syncVerdictPolicy: "Subjective motion quality, synchrony, and perception remain recorded only in the fixed human visual checklist; this automated evidence does not claim to prove them.",
    screenshots: cases.flatMap((entry) => entry.screenshots),
  };
}

async function validateHarness({ outputDir, bundleContext }) {
  let artifactRootRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/110-home-nutrition-animation");
  } catch {
    artifactRootRejected = true;
  }
  assertTrue(artifactRootRejected, "Phase 110 validate-harness failed: artifact root was not rejected.");

  let outsideRejected = false;
  try {
    resolveSafeOutputDir("tests/harness/artifacts/110-home-nutrition-animation/latest/../outside");
  } catch {
    outsideRejected = true;
  }
  assertTrue(outsideRejected, "Phase 110 validate-harness failed: path outside latest root was not rejected.");

  const browser = await findBrowser();
  const server = await startStaticServer(bundleContext);
  let output;
  try {
    output = await withBrowserPage({
      browser,
      url: server.origin,
      outputDir,
      run: async (send) => {
        await waitForHome(send);
        const bodyTextLength = await evaluate(send, `document.body.innerText.length`);
        if (bodyTextLength < 20) {
          throw new Error(`Phase 110 validate-harness failed: body text length was ${bodyTextLength}.`);
        }
        const screenshot = await captureScreenshot({ send, output: join(outputDir, "validate-harness.png") });
        return {
          name: "validate-harness",
          trigger: "validation",
          expectedMealSet: "base",
          expectedTotals: null,
          readings: { startKcal: null, expectedStartKcal: null, midKcal: null, terminalKcal: null, strictlyBetweenKcal: null, terminalMatchesExpectedKcal: null, sampleElapsedMs: null },
          triggerDocumentation: "validation-only Home load",
          frames: [{ kind: "validation", file: "validate-harness.png", path: screenshot.path, bytes: screenshot.bytes, nonblank: screenshot.nonblank, kcal: null }],
          screenshots: ["validate-harness.png"],
          validationOnly: true,
        };
      },
    });
  } finally {
    await server.close();
  }
  const manifest = buildManifest([output]);
  manifest.validationOnly = true;
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveSafeOutputDir(args.outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const bundleContext = await prepareHarnessBundle(outputDir);
  if (args.validateHarness) {
    await validateHarness({ outputDir, bundleContext });
    return;
  }

  const browser = await findBrowser();
  const server = await startStaticServer(bundleContext);
  let caseOutputs;
  try {
    caseOutputs = await withBrowserPage({
      browser,
      url: server.origin,
      outputDir,
      run: async (send) => {
        const outputs = [];
        outputs.push(await runHomeCase({ send, outputDir, state: CASES[0] }));
        await waitForHome(send);
        await delay(450);
        for (const state of CASES.slice(1)) {
          outputs.push(await runHomeCase({ send, outputDir, state }));
        }
        return outputs;
      },
    });

    const requiredNames = new Set(CASES.map((entry) => entry.id));
    for (const output of caseOutputs) {
      if (!requiredNames.has(output.name)) {
        throw new Error(`Phase 110 visual evidence produced unexpected case: ${output.name}`);
      }
      if (!Array.isArray(output.frames) || output.frames.length < 2) {
        throw new Error(`Phase 110 visual evidence failed: missing frame pair for ${output.name}`);
      }
      for (const frame of output.frames) {
        if (!frame.nonblank || frame.bytes < MIN_SCREENSHOT_BYTES) {
          throw new Error(`Phase 110 visual evidence failed final frame assertion for ${output.name}/${frame.file}.`);
        }
      }
      assertAnimationReadings({
        caseName: output.name,
        expectedStartKcal: output.readings.expectedStartKcal,
        midKcal: output.readings.midKcal,
        terminalKcal: output.readings.terminalKcal,
        expectedTerminalKcal: output.expectedTotals?.kcal,
        sampleSequence: output.readings.sampleSequence,
        midFrameBinding: output.frames[0]?.binding,
        terminalFrameBinding: output.frames[1]?.binding,
        terminalAnimationState: output.frames[1]?.animationState,
      });
    }
  } finally {
    await server.close();
  }
  const manifest = buildManifest(caseOutputs);
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
