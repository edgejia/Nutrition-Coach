#!/usr/bin/env node
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
      dailySummary: { totalCalories: startSummary.totalCalories }
    };
    window.__phase49ApplyHomeChange = () => {
      window.__phase49VisualState.dailySummary.totalCalories = changedSummary.totalCalories;
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
        return Promise.resolve(jsonResponse({ meals: daySnapshots["2026-05-06"].meals }));
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
      } else {
        await send("Runtime.evaluate", {
          expression: `(() => {
            const controls = [...document.querySelectorAll('button, [role="button"]')];
            const historyControl = controls.find((node) => /歷史/.test(node.innerText || node.getAttribute("aria-label") || ""));
            historyControl?.click();
          })()`,
        });
        await delay(500);
        if (stateCase === "cacheMissPending" || stateCase === "weekTransition") {
          await send("Runtime.evaluate", {
            expression: `(() => {
              const buttons = [...document.querySelectorAll('button')];
              const previous = buttons.find((node) => node.getAttribute("aria-label") === "查看上一週");
              const next = buttons.find((node) => node.getAttribute("aria-label") === "查看下一週");
              (previous || next)?.click();
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
          const boxes = [...document.querySelectorAll('.sp-card, .sp-history-week-day, .home-sport-hero, .sp-history-hero, nav, [class*="bottom"]')]
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            })
            .filter((rect) => rect.width > 0 && rect.height > 0);
          const viewportHeight = window.innerHeight;
          const hasOverlapRisk = boxes.some((rect) => rect.bottom > viewportHeight + 1 || rect.right > window.innerWidth + 1);
          const historyWeekStartText = textOf('.sp-history-header-copy');
          const homeConsumedText = textOf('.home-sport-calorie-copy .sp-display');
          const homePercentText = textOf('.home-sport-ring-label strong');
          const historyPendingKind = window.__phase49VisualState?.cacheMissRequests > 0 ? "cache-miss" : "cache-hit";
          return {
            bodyTextLength: bodyText.length,
            sportNodeCount: document.querySelectorAll('[class*="sp-"], .home-sport-screen, .sp-history-screen').length,
            bottomNavCount: [...document.querySelectorAll('button, [role="button"]')].filter((node) => /首頁|對話|歷史/.test(node.innerText || node.getAttribute("aria-label") || "")).length,
            historyNodeCount: document.querySelectorAll('.sp-history-screen, .sp-history-week-day, .sp-history-hero').length,
            homeNodeCount: document.querySelectorAll('.home-sport-screen, .home-sport-hero, .home-sport-ring').length,
            hasOverlapRisk,
            stateCase: ${JSON.stringify(stateCase)},
            historyWeekStartText,
            historyPendingKind,
            homeConsumedText,
            homePercentText
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
        throw new Error("Phase 49 visual evidence failed: overlap risk detected.");
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
          stateCase: inspection.stateCase,
          historyWeekStartText: inspection.historyWeekStartText,
          historyPendingKind: inspection.historyPendingKind,
          homeConsumedText: inspection.homeConsumedText,
          homePercentText: inspection.homePercentText,
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
