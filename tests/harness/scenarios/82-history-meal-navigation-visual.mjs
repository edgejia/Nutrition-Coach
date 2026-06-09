#!/usr/bin/env node
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
    const deleteControls = [...document.querySelectorAll('button, [role="button"]']
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
      returnedToDayDetailAfterCancel: Boolean(dayDetail && !mealEdit && /雞胸藜麥便當|當日餐點|歷史快照|今天 · 即時/.test(dayDetailText) && !historyScreen),
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
