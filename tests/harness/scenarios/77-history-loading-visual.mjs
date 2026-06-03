#!/usr/bin/env node
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
