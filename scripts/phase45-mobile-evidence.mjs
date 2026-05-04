#!/usr/bin/env node
import { access, mkdir, mkdtemp, stat, writeFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_DIR = "output/playwright";
const MIN_SCREENSHOT_BYTES = 10000;
const BROWSER_CANDIDATES = [
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
];
const VIEWPORTS = {
  se: { id: "375x667", width: 375, height: 667 },
  standard: { id: "390x844", width: 390, height: 844 },
  pixel: { id: "412x915", width: 412, height: 915 },
};
const TARGETS = [
  { id: "chat-focused", surface: "chat-focused", viewports: ["se", "standard", "pixel"] },
  { id: "home", surface: "home", viewports: ["se", "standard", "pixel"] },
  { id: "history-list", surface: "history-list", viewports: ["se", "standard", "pixel"] },
  { id: "day-detail", surface: "day-detail", viewports: ["se", "standard", "pixel"] },
  { id: "meal-edit", surface: "meal-edit", viewports: ["se", "standard", "pixel"] },
  { id: "onboarding", surface: "onboarding", viewports: ["se", "standard", "pixel"] },
  { id: "settings", surface: "settings", viewports: ["se", "standard"] },
  { id: "guest-recovery", surface: "guest-recovery", viewports: ["se", "standard"] },
];

function printHelp() {
  console.log(`Phase 45 mobile evidence

Usage:
  node scripts/phase45-mobile-evidence.mjs --base-url http://127.0.0.1:5173 [--output-dir output/playwright]

Options:
  --base-url    Reachable Nutrition Coach app URL. A Vite dev URL is recommended so the script can import /src/store.ts for deterministic surface setup.
  --output-dir  Directory for PNG output. Defaults to output/playwright.
  --help        Show this help text.

Output:
  Writes phase45-*.png screenshots under output/playwright/ by default.
  Also writes phase45-manifest.json and phase45-visual-audit.json next to the screenshots.
`);
}

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR, help: false, baseUrl: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--base-url") {
      args.baseUrl = argv[++index] ?? null;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[++index] ?? DEFAULT_OUTPUT_DIR;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function assertExecutable(path) {
  await access(path, constants.X_OK);
}

async function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await assertExecutable(candidate.path);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Microsoft Edge or Google Chrome is required for Phase 45 mobile screenshots.");
}

async function assertReachable(baseUrl) {
  let response;
  try {
    response = await fetch(baseUrl, { redirect: "follow" });
  } catch (error) {
    throw new Error(`Base URL is not reachable: ${baseUrl}. Start the app, then rerun with --base-url. ${error instanceof Error ? error.message : ""}`);
  }
  if (!response.ok) {
    throw new Error(`Base URL responded with HTTP ${response.status}: ${baseUrl}`);
  }
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
      const id = nextId;
      nextId += 1;
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

async function launchBrowser(browser) {
  const userDataDir = await mkdtemp(join(tmpdir(), "nc-phase45-mobile-"));
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

  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const cdp = cdpSession(version.webSocketDebuggerUrl);
  return {
    cdp,
    async close() {
      cdp.close();
      child.kill("SIGKILL");
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

function mockApiScript() {
  const today = new Date().toISOString().slice(0, 10);
  const meals = [
    {
      id: "phase45-meal-1",
      foodName: "雞胸飯與青花菜",
      calories: 620,
      protein: 48,
      carbs: 72,
      fat: 14,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: `${today}T04:20:00.000Z`,
    },
    {
      id: "phase45-meal-2",
      foodName: "希臘優格與香蕉",
      calories: 280,
      protein: 22,
      carbs: 34,
      fat: 6,
      imageAssetId: null,
      imageUrl: null,
      loggedAt: `${today}T08:10:00.000Z`,
    },
  ];
  const summary = {
    date: today,
    totalCalories: 900,
    totalProtein: 70,
    totalCarbs: 106,
    totalFat: 20,
    mealCount: 2,
  };
  const targets = { calories: 2150, protein: 145, carbs: 240, fat: 65 };
  const trends = Array.from({ length: 7 }, (_, index) => ({
    date: new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10),
    calories: 1650 + index * 80,
    protein: 95 + index * 4,
    carbs: 180 + index * 6,
    fat: 42 + index,
    mealCount: index % 2 === 0 ? 3 : 2,
  }));

  return `(() => {
    const meals = ${JSON.stringify(meals)};
    const summary = ${JSON.stringify(summary)};
    const targets = ${JSON.stringify(targets)};
    const trends = ${JSON.stringify(trends)};
    localStorage.setItem("deviceId", "phase45-mobile-evidence");
    localStorage.setItem("goal", "fat_loss");
    localStorage.setItem("dailyTargets", JSON.stringify(targets));
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const raw = typeof input === "string" ? input : input?.url ?? "";
      const url = new URL(raw, location.href);
      const json = (body) => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      if (url.pathname === "/api/meals") return json({ meals });
      if (url.pathname === "/api/history/trends") {
        return json({
          from: trends[0].date,
          to: trends[trends.length - 1].date,
          completeness: "complete",
          daily: trends,
          totals: trends.reduce((acc, day) => ({
            calories: acc.calories + day.calories,
            protein: acc.protein + day.protein,
            carbs: acc.carbs + day.carbs,
            fat: acc.fat + day.fat,
            mealCount: acc.mealCount + day.mealCount,
          }), { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 }),
          averages: {
            calories: 1840,
            protein: 108,
            carbs: 198,
            fat: 46,
            mealCount: 3,
          },
        });
      }
      if (url.pathname.startsWith("/api/history/days/")) {
        return json({ date: summary.date, summary, meals });
      }
      if (url.pathname === "/api/device/session") {
        return json({ deviceId: "phase45-mobile-evidence", goal: "fat_loss", dailyTargets: targets });
      }
      return nativeFetch(input, init);
    };
  })();`;
}

function surfaceScript(surface) {
  return `(async () => {
    const storeUrl = new URL("/src/store.ts", location.origin).href;
    let storeModule;
    try {
      storeModule = await import(storeUrl);
    } catch (error) {
      throw new Error("Phase 45 evidence setup requires a Vite dev base URL that can import /src/store.ts. Use: yarn dev:client, then --base-url http://127.0.0.1:5173");
    }
    const { useStore } = storeModule;
    const today = new Date().toISOString().slice(0, 10);
    const targets = { calories: 2150, protein: 145, carbs: 240, fat: 65 };
    const meals = [
      { id: "phase45-meal-1", foodName: "雞胸飯與青花菜", calories: 620, protein: 48, carbs: 72, fat: 14, imageAssetId: null, imageUrl: null, loggedAt: today + "T04:20:00.000Z" },
      { id: "phase45-meal-2", foodName: "希臘優格與香蕉", calories: 280, protein: 22, carbs: 34, fat: 6, imageAssetId: null, imageUrl: null, loggedAt: today + "T08:10:00.000Z" }
    ];
    const summary = { date: today, totalCalories: 900, totalProtein: 70, totalCarbs: 106, totalFat: 20, mealCount: 2 };
    const messages = [
      { id: "m1", role: "assistant", content: "今天先從簡單一句開始：拍照或輸入你剛吃的餐點。", createdAt: new Date().toISOString() },
      { id: "m2", role: "user", content: "雞胸飯加青花菜", createdAt: new Date().toISOString() },
      { id: "m3", role: "assistant", content: "已記錄這餐，蛋白質很穩。", createdAt: new Date().toISOString(), didLogMeal: true, loggedMeal: { ...meals[0], mealId: meals[0].id, dateKey: today } }
    ];
    const baseState = {
      deviceId: "phase45-mobile-evidence",
      goal: "fat_loss",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets: targets,
      dailySummary: summary,
      meals,
      messages,
      pendingHomeChatDraft: null,
      lastMealMutation: null,
      showSettings: false,
      secondaryScreen: null,
      sending: false,
      provisionalBubble: null,
    };
    if (${JSON.stringify(surface)} === "onboarding") {
      localStorage.removeItem("deviceId");
      useStore.setState({ ...baseState, deviceId: null, activeScreen: "onboarding", guestSessionStatus: "ready", dailyTargets: null, dailySummary: null, meals: [], messages: [] });
    } else if (${JSON.stringify(surface)} === "guest-recovery") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "home", guestSessionStatus: "recovery_required" });
    } else if (${JSON.stringify(surface)} === "history-list") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "history" });
    } else if (${JSON.stringify(surface)} === "day-detail") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "history", secondaryScreen: { screen: "dayDetail", origin: "history", payload: { dateKey: today, label: "today-live", targetMealId: "phase45-meal-1" } } });
    } else if (${JSON.stringify(surface)} === "meal-edit") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "history", secondaryScreen: { screen: "mealEdit", origin: "history", payload: { mealId: "phase45-meal-1", dateKey: today, foodName: "雞胸飯與青花菜", calories: 620, protein: 48, carbs: 72, fat: 14, imageAssetId: null, imageUrl: null, loggedAt: today + "T04:20:00.000Z" } } });
    } else if (${JSON.stringify(surface)} === "settings") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "home", secondaryScreen: { screen: "settings", origin: "home" } });
    } else if (${JSON.stringify(surface)} === "chat-focused") {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "chat" });
    } else {
      localStorage.setItem("deviceId", "phase45-mobile-evidence");
      useStore.setState({ ...baseState, activeScreen: "home" });
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (${JSON.stringify(surface)} === "chat-focused") {
      const textarea = document.querySelector(".sp-chat-textarea");
      textarea?.focus();
      if (textarea) textarea.value = "晚餐吃了烤鮭魚與地瓜";
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      title: document.title,
      bodyTextLength: document.body.innerText.trim().length,
      activeElement: document.activeElement?.className ?? document.activeElement?.tagName,
      rootExists: Boolean(document.querySelector("#root")),
      sportNodeCount: document.querySelectorAll('[class*="sp-"], .screen-shell, .app-viewport').length
    };
  })();`;
}

function inspectionScript() {
  return `(() => {
    const doc = document.documentElement;
    const bodyTextLength = document.body.innerText.trim().length;
    const horizontalOverflow = doc.scrollWidth > doc.clientWidth + 1;
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const bottomBar = rectOf(".screen-bottom-bar, .sp-meal-edit-footer");
    const focusedControl = rectOf(".sp-chat-textarea, .sp-meal-edit-save, .sp-onboarding-primary");
    return {
      bodyTextLength,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      horizontalOverflow: horizontalOverflow ? "FAIL" : "PASS",
      clipping: bodyTextLength > 20 ? "PASS" : "FAIL",
      fixedBarOverlap: overlaps(bottomBar, focusedControl) ? "FAIL" : "PASS",
      bottomOcclusion: getComputedStyle(doc).getPropertyValue("--app-bottom-occlusion") !== "" ? "PASS" : "FAIL",
      keyboardSafeLayout: document.activeElement?.classList?.contains("sp-chat-textarea") ? "PASS" : "NOT_APPLICABLE",
    };
  })();`;
}

async function assertScreenshotBytes(output, bytes) {
  const file = await stat(output);
  if (file.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Phase 45 screenshot failed: ${output} is smaller than ${MIN_SCREENSHOT_BYTES} bytes.`);
  }

  const sampleEnd = Math.min(bytes.length, 8192);
  const uniqueByteValues = new Set(bytes.subarray(128, sampleEnd)).size;
  if (uniqueByteValues < 16) {
    throw new Error(`Phase 45 screenshot failed: ${output} looks empty or blank by byte diversity check.`);
  }
}

async function captureTarget({ cdp, baseUrl, output, surface, viewport }) {
  await mkdir(dirname(output), { recursive: true });
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);

  try {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: mockApiScript() });
    await send("Page.navigate", { url: baseUrl });
    await delay(800);

    const setup = await send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: surfaceScript(surface),
    });
    if (setup.exceptionDetails) {
      throw new Error(setup.exceptionDetails.exception?.description ?? "Phase 45 surface setup failed.");
    }

    await delay(surface === "chat-focused" ? 500 : 300);
    const inspection = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: inspectionScript(),
    });
    const audit = inspection.result?.value;
    if (!audit || audit.bodyTextLength <= 20) {
      throw new Error(`Phase 45 capture failed for ${surface}: app body did not render enough visible text.`);
    }
    if (audit.horizontalOverflow === "FAIL") {
      throw new Error(`Phase 45 capture failed for ${surface} ${viewport.id}: horizontal overflow detected.`);
    }

    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const bytes = Buffer.from(data, "base64");
    await writeFile(output, bytes);
    await assertScreenshotBytes(output, bytes);
    return { ...audit, screenshotMinBytes: MIN_SCREENSHOT_BYTES, nonEmpty: true };
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.baseUrl) {
    printHelp();
    throw new Error("Missing required --base-url. Start the app and pass a reachable URL.");
  }

  const baseUrl = new URL(args.baseUrl).toString();
  await assertReachable(baseUrl);
  const browser = await findBrowser();
  const outputDir = resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });

  const launched = await launchBrowser(browser);
  const outputs = [];
  const audit = {};
  try {
    for (const target of TARGETS) {
      for (const viewportKey of target.viewports) {
        const viewport = VIEWPORTS[viewportKey];
        const fileName = `phase45-${target.id}-${viewport.id}.png`;
        const output = join(outputDir, fileName);
        const result = await captureTarget({
          cdp: launched.cdp,
          baseUrl,
          output,
          surface: target.surface,
          viewport,
        });
        const relativeOutput = `output/playwright/${fileName}`;
        outputs.push({
          surface: target.id,
          viewport: viewport.id,
          path: relativeOutput,
          browser: browser.name,
          assertions: result,
        });
        audit[relativeOutput] = {
          "horizontal overflow": result.horizontalOverflow,
          clipping: result.clipping,
          "fixed-bar overlap": result.fixedBarOverlap,
          "bottom occlusion": result.bottomOcclusion,
          "keyboard-safe layout": result.keyboardSafeLayout,
        };
      }
    }
  } finally {
    await launched.close();
  }

  const manifest = {
    scenario: "phase45-mobile-evidence",
    baseUrl,
    outputDir: args.outputDir,
    outputs,
    evidencePolicy: "operator-run real browser mobile emulation; screenshots reject unreachable apps, blank captures, undersized PNGs, and horizontal overflow",
    privacy: "synthetic in-browser API responses and synthetic local store data only; no .env, raw database files, private logs, or production user data",
  };
  await writeFile(join(outputDir, "phase45-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(outputDir, "phase45-visual-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
  console.log(`Wrote ${outputs.length} Phase 45 screenshots to ${args.outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
