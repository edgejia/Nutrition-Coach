#!/usr/bin/env node
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
