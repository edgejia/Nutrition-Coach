process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const PROTECTED_ROUTE_FILES = [
  "server/routes/chat.ts",
  "server/routes/meals.ts",
  "server/routes/history.ts",
  "server/routes/assets.ts",
  "server/routes/day-snapshot.ts",
  "server/routes/proposal-actions.ts",
  "server/routes/observability.ts",
  "server/routes/sse.ts",
  "server/routes/device.ts",
] as const;

const CLIENT_TRANSPORT_FILES = [
  "client/src/api.ts",
  "client/src/sse.ts",
] as const;

const GENERATED_ARTIFACT_FILES = [
  "tests/harness/artifacts/guest-session-hardening/latest/scenario-result.json",
  "tests/harness/artifacts/guest-session-hardening/latest/snapshots.json",
  "tests/harness/artifacts/guest-session-hardening/latest/steps.json",
  "tests/harness/artifacts/guest-session-hardening/latest/summary.json",
] as const;

const EXPECTED_PROTECTED_ROUTE_META_KEYS = [
  "chatMessage",
  "chatStop",
  "chatHistory",
  "mealsList",
  "mealUpdate",
  "mealDelete",
  "historyMeals",
  "historySearch",
  "historyTrends",
  "historyDay",
  "assetRead",
  "daySnapshot",
  "proposalAction",
  "observabilityClientEvent",
  "sse",
  "deviceGoalsPatch",
  "deviceGoalsPut",
] as const;

const EXPECTED_PROTECTED_REGISTRATIONS = [
  { file: "server/routes/chat.ts", method: "POST", url: "/api/chat/stop", metaKey: "chatStop" },
  { file: "server/routes/chat.ts", method: "POST", url: "/api/chat", metaKey: "chatMessage" },
  { file: "server/routes/chat.ts", method: "GET", url: "/api/chat/history", metaKey: "chatHistory" },
  { file: "server/routes/meals.ts", method: "GET", url: "/api/meals", metaKey: "mealsList" },
  { file: "server/routes/meals.ts", method: "PATCH", url: "/api/meals/:id", metaKey: "mealUpdate" },
  { file: "server/routes/meals.ts", method: "DELETE", url: "/api/meals/:id", metaKey: "mealDelete" },
  { file: "server/routes/history.ts", method: "GET", url: "/api/history/meals", metaKey: "historyMeals" },
  { file: "server/routes/history.ts", method: "GET", url: "/api/history/search", metaKey: "historySearch" },
  { file: "server/routes/history.ts", method: "GET", url: "/api/history/trends", metaKey: "historyTrends" },
  { file: "server/routes/history.ts", method: "GET", url: "/api/history/days/:date", metaKey: "historyDay" },
  { file: "server/routes/assets.ts", method: "GET", url: "/api/assets/:id", metaKey: "assetRead" },
  { file: "server/routes/day-snapshot.ts", method: "GET", url: "/api/day-snapshot", metaKey: "daySnapshot" },
  { file: "server/routes/proposal-actions.ts", method: "POST", url: "/api/proposals/actions", metaKey: "proposalAction" },
  {
    file: "server/routes/observability.ts",
    method: "POST",
    url: "/api/observability/client-event",
    metaKey: "observabilityClientEvent",
  },
  { file: "server/routes/sse.ts", method: "GET", url: "/api/sse", metaKey: "sse" },
  { file: "server/routes/device.ts", method: "PATCH", url: "/api/device/goals", metaKey: "deviceGoalsPatch" },
  { file: "server/routes/device.ts", method: "PUT", url: "/api/device/goals", metaKey: "deviceGoalsPut" },
] as const;

const PUBLIC_DEVICE_ROUTES = [
  { method: "POST", url: "/api/device" },
  { method: "POST", url: "/api/device/session" },
  { method: "DELETE", url: "/api/device/session" },
] as const;

const PROTECTED_CLIENT_ENDPOINT_PATTERNS = [
  "/api/chat",
  "/api/proposals/actions",
  "/api/observability/client-event",
  "/api/device/goals",
  "/api/meals",
  "/api/day-snapshot",
  "/api/history/",
  "/api/assets/",
  "/api/sse",
] as const;

async function readProjectFile(relativePath: string) {
  return readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
}

async function parseProjectFile(relativePath: string) {
  const source = await readProjectFile(relativePath);
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function stringLiteralText(node: ts.Node | undefined) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function objectPropertyNameText(name: ts.PropertyName | undefined) {
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function getObjectLiteralProperty(objectLiteral: ts.ObjectLiteralExpression, key: string) {
  return objectLiteral.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && objectPropertyNameText(property.name) === key
  );
}

function expressionTextIfString(expression: ts.Expression | undefined) {
  if (!expression) {
    return undefined;
  }
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return undefined;
}

function propertyAccessName(expression: ts.Expression | undefined) {
  return expression && ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined;
}

function routeKey(registration: { method: string; url: string; metaKey?: string }) {
  return `${registration.method.toUpperCase()} ${registration.url}${registration.metaKey ? ` -> ${registration.metaKey}` : ""}`;
}

function assertNoUnexpectedValues(values: readonly string[], forbidden: readonly string[], context: string) {
  for (const value of values) {
    for (const needle of forbidden) {
      assert.ok(!value.includes(needle), `${context} must not contain ${needle}: ${value}`);
    }
  }
}

export async function assertNoManualResolveGuestSession() {
  const failures: string[] = [];

  for (const relativePath of PROTECTED_ROUTE_FILES) {
    const source = await parseProjectFile(relativePath);
    const resolverNames = new Set<string>();
    const resolverNamespaces = new Set<string>();

    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) {
        continue;
      }
      const moduleName = stringLiteralText(statement.moduleSpecifier);
      if (!moduleName?.endsWith("guest-session-resolver.js")) {
        continue;
      }

      const importClause = statement.importClause;
      if (importClause?.name) {
        resolverNames.add(importClause.name.text);
      }
      const namedBindings = importClause?.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        resolverNamespaces.add(namedBindings.name.text);
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if ((element.propertyName?.text ?? element.name.text) === "resolveGuestSession") {
            resolverNames.add(element.name.text);
          }
        }
      }

      failures.push(`${relativePath} imports resolveGuestSession from ${moduleName}`);
    }

    walk(source, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const expression = node.expression;
      if (ts.isIdentifier(expression) && resolverNames.has(expression.text)) {
        failures.push(`${relativePath} calls ${expression.text}()`);
      }
      if (
        ts.isPropertyAccessExpression(expression)
        && ts.isIdentifier(expression.expression)
        && resolverNamespaces.has(expression.expression.text)
        && expression.name.text === "resolveGuestSession"
      ) {
        failures.push(`${relativePath} calls ${expression.getText(source)}`);
      }
    });
  }

  assert.deepEqual(failures, [], "Protected route modules must use the shared protected-route boundary instead of route-local resolveGuestSession()");
}

function collectProtectedRouteHelperAliases(source: ts.SourceFile) {
  const aliases = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const moduleName = stringLiteralText(statement.moduleSpecifier);
    if (moduleName !== "./protected-route.js") {
      continue;
    }
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }
    for (const element of namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "registerProtectedRoute") {
        aliases.add(element.name.text);
      }
    }
  }
  return aliases;
}

function collectProtectedRegistrations(source: ts.SourceFile, helperAliases: ReadonlySet<string>) {
  const registrations: Array<{ method: string; url: string; metaKey?: string }> = [];

  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !helperAliases.has(node.expression.text)) {
      return;
    }
    const options = node.arguments[2];
    assert.ok(
      options && ts.isObjectLiteralExpression(options),
      `${source.fileName}: ${node.expression.text} must receive inline route options; wrapper modules must update this source contract`,
    );

    const method = expressionTextIfString(getObjectLiteralProperty(options, "method")?.initializer);
    const url = expressionTextIfString(getObjectLiteralProperty(options, "url")?.initializer);
    const metaKey = propertyAccessName(getObjectLiteralProperty(options, "protectedMeta")?.initializer);
    if (method && url) {
      registrations.push({ method, url, metaKey });
    }
  });

  return registrations;
}

function collectDirectAppRoutes(source: ts.SourceFile) {
  const routes: Array<{ method: string; url: string }> = [];

  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "app") {
      return;
    }
    const method = node.expression.name.text.toUpperCase();
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      return;
    }
    const url = expressionTextIfString(node.arguments[0]);
    if (url) {
      routes.push({ method, url });
    }
  });

  return routes;
}

function collectProtectedRouteMetaKeys(source: ts.SourceFile) {
  const keys: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "PROTECTED_ROUTE_META")
    ) {
      const declaration = statement.declarationList.declarations.find((item) =>
        ts.isIdentifier(item.name) && item.name.text === "PROTECTED_ROUTE_META"
      );
      let initializer = declaration?.initializer;
      if (initializer && ts.isAsExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (initializer && ts.isSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (initializer && ts.isAsExpression(initializer)) {
        initializer = initializer.expression;
      }
      assert.ok(initializer && ts.isObjectLiteralExpression(initializer), "PROTECTED_ROUTE_META must stay as an object literal for source-contract coverage");
      for (const property of initializer.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key = objectPropertyNameText(property.name);
          if (key) {
            keys.push(key);
          }
        }
      }
    }
  }
  return keys;
}

export async function assertProtectedRouteMetadata() {
  const protectedRouteSource = await parseProjectFile("server/routes/protected-route.ts");
  const metaKeys = collectProtectedRouteMetaKeys(protectedRouteSource).sort();
  assert.deepEqual(metaKeys, [...EXPECTED_PROTECTED_ROUTE_META_KEYS].sort(), "PROTECTED_ROUTE_META keys must match the protected route inventory");

  const registrations: Array<{ file: string; method: string; url: string; metaKey?: string }> = [];
  for (const relativePath of PROTECTED_ROUTE_FILES) {
    const source = await parseProjectFile(relativePath);
    const helperAliases = collectProtectedRouteHelperAliases(source);
    const fileRegistrations = collectProtectedRegistrations(source, helperAliases);
    registrations.push(...fileRegistrations.map((registration) => ({ file: relativePath, ...registration })));
  }

  const actual = registrations.map(routeKey).sort();
  const expected = EXPECTED_PROTECTED_REGISTRATIONS.map(routeKey).sort();
  assert.deepEqual(actual, expected, "Protected route registrations must stay explicit and metadata-backed");

  const actualByFile = new Set(registrations.map((registration) =>
    `${registration.file} ${registration.method.toUpperCase()} ${registration.url} ${registration.metaKey ?? "missing-meta"}`
  ));
  for (const registration of EXPECTED_PROTECTED_REGISTRATIONS) {
    assert.ok(
      actualByFile.has(`${registration.file} ${registration.method} ${registration.url} ${registration.metaKey}`),
      `Missing protected registration ${registration.file} ${registration.method} ${registration.url} -> ${registration.metaKey}`,
    );
  }

  const deviceSource = await parseProjectFile("server/routes/device.ts");
  const publicRoutes = collectDirectAppRoutes(deviceSource);
  const publicRouteSet = new Set(publicRoutes.map((route) => `${route.method} ${route.url}`));
  for (const route of PUBLIC_DEVICE_ROUTES) {
    assert.ok(publicRouteSet.has(`${route.method} ${route.url}`), `Expected public device route ${route.method} ${route.url}`);
    assert.ok(
      !registrations.some((registration) => registration.method.toUpperCase() === route.method && registration.url === route.url),
      `Public device route ${route.method} ${route.url} must not be registered through registerProtectedRoute`,
    );
  }
}

function fetchEndpointText(source: ts.SourceFile, expression: ts.Expression) {
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return expression.getText(source);
}

function isProtectedClientEndpoint(fetchUrlText: string) {
  return PROTECTED_CLIENT_ENDPOINT_PATTERNS.some((pattern) => fetchUrlText.includes(pattern));
}

function collectFetchCalls(source: ts.SourceFile) {
  const calls: Array<{ urlText: string; initText: string; protectedEndpoint: boolean }> = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "fetch") {
      return;
    }
    const [url, init] = node.arguments;
    if (!url) {
      return;
    }
    const urlText = fetchEndpointText(source, url);
    calls.push({
      urlText,
      initText: init?.getText(source) ?? "",
      protectedEndpoint: isProtectedClientEndpoint(urlText),
    });
  });
  return calls;
}

export async function assertClientDoesNotSendRawProtectedSelectors() {
  for (const relativePath of CLIENT_TRANSPORT_FILES) {
    const source = await parseProjectFile(relativePath);
    const stringLiterals: string[] = [];
    walk(source, (node) => {
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        stringLiterals.push(node.text);
      }
    });

    assertNoUnexpectedValues(stringLiterals, ["x-device-id"], relativePath);

    for (const call of collectFetchCalls(source)) {
      if (!call.protectedEndpoint) {
        continue;
      }
      assert.ok(!/[?&]deviceId(?:=|[&`'"]|$)/.test(call.urlText), `Protected fetch must not append deviceId selector: ${call.urlText}`);
      assert.ok(!/\bdeviceId\b/.test(call.initText), `Protected fetch body/init must not include raw deviceId selector: ${call.urlText}`);
    }
  }

  const apiSource = await parseProjectFile("client/src/api.ts");
  const apiText = apiSource.getFullText();
  const assetHelperMatch = apiText.match(/export function withAuthorizedAssetUrl[\s\S]*?^}/m);
  assert.ok(assetHelperMatch, "withAuthorizedAssetUrl() must remain present");
  assert.match(
    assetHelperMatch[0],
    /params\.delete\(["']deviceId["']\)/,
    "withAuthorizedAssetUrl() must keep stripping legacy asset deviceId query params",
  );

  const sessionFetches = collectFetchCalls(apiSource).filter((call) => call.urlText.includes("/api/device/session"));
  assert.ok(
    sessionFetches.some((call) => /\blegacyDeviceId\b/.test(call.initText)),
    "POST /api/device/session remains the only client bootstrap path allowed to send legacyDeviceId",
  );
}

const COOKIE_HEADER_PATTERN = /\b(?:set-cookie|cookie)\s*:/i;
const COOKIE_ASSIGNMENT_PATTERN = /\b(?:guest[_-]?session|active[_-]?(?:token|session)|resume[_-]?(?:token|session)|__Host-[^=\s;]+|__Secure-[^=\s;]+)[^=\s;]*=[A-Za-z0-9._~+/=-]{12,}/i;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const DATA_URI_PATTERN = /\bdata:image\/[a-z0-9.+-]+;base64,/i;
const SESSION_MATERIAL_KEY_PATTERN = /(?:^|[_-])(?:activeToken|resumeToken|cookieHeader|setCookieHeaders|requestHeaders|requestBody|responseBody|prompt|imageData)(?:$|[_-])/i;
const ALLOWED_METADATA_KEYS = new Set([
  "cookie",
  "browserCookieCount",
  "issuedCookieCount",
  "cookieOwnerAuthoritative",
  "establishedBy",
]);

function inspectArtifactValue(value: unknown, pathSegments: readonly string[], failures: string[]) {
  const pathText = pathSegments.join(".");
  if (typeof value === "string") {
    if (
      COOKIE_HEADER_PATTERN.test(value)
      || COOKIE_ASSIGNMENT_PATTERN.test(value)
      || UUID_PATTERN.test(value)
      || JWT_PATTERN.test(value)
      || DATA_URI_PATTERN.test(value)
    ) {
      failures.push(`${pathText} contains raw session/device/image material`);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectArtifactValue(item, [...pathSegments, String(index)], failures));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SESSION_MATERIAL_KEY_PATTERN.test(key) && !ALLOWED_METADATA_KEYS.has(key)) {
      failures.push(`${[...pathSegments, key].join(".")} uses a session-material key`);
    }
    inspectArtifactValue(nested, [...pathSegments, key], failures);
  }
}

export async function assertGeneratedArtifactsAreMetadataOnly() {
  const failures: string[] = [];
  for (const relativePath of GENERATED_ARTIFACT_FILES) {
    const parsed = JSON.parse(await readProjectFile(relativePath)) as unknown;
    inspectArtifactValue(parsed, [relativePath], failures);
  }
  assert.deepEqual(failures, [], "Generated guest-session-hardening artifacts must remain metadata-only");
}

test("protected route modules no longer resolve guest sessions manually", async () => {
  await assertNoManualResolveGuestSession();
});

test("protected route inventory and public exceptions are explicit", async () => {
  await assertProtectedRouteMetadata();
});

test("client protected transports do not send raw ownership selectors", async () => {
  await assertClientDoesNotSendRawProtectedSelectors();
});
