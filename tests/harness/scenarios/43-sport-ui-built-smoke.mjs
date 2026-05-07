#!/usr/bin/env node
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
