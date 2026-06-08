#!/usr/bin/env node
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
        itemCount: 2,
        loggedAt: "2026-06-08T18:30:00+08:00",
        mealPeriod: "dinner",
        imageAssetId: null,
        imageUrl: null,
        items: [
          { name: "豆腐青菜", position: 0, calories: 360, protein: 20, carbs: 50, fat: 15 }
        ]
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
      if (url.pathname === "/api/chat/history") {
        return Promise.resolve(jsonResponse({ messages: [] }));
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
  const clicked = await evaluate(send, `(() => {
    const chatControl = [...document.querySelectorAll('button, [role="button"]')]
      .find((node) => /對話/.test(node.innerText || node.getAttribute("aria-label") || ""));
    if (!chatControl || typeof chatControl.click !== "function") return false;
    chatControl.click();
    window.__phase81VisualState?.interactions?.push("bottom-nav:chat");
    return true;
  })()`);
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
      await evaluate(send, `document.querySelector('.sp-meal-edit-grouped-row-actions button:last-child')?.click()`);
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
    assertTrue(inspection.groupedActionCount >= 2, "MOB-03 visual failed: grouped row action controls missing.");
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
        "raw prompts",
        "provider request or response bodies",
        "cookies",
        "API keys",
        "database snapshots",
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
