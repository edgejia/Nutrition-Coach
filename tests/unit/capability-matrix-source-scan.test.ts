import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { capabilityMatrix } from "../../client/src/contracts/capability-matrix.js";
import type { CapabilityMatrixRow } from "../../client/src/contracts/capability-matrix.js";

const AUDITED_COMPONENT_FILES = [
  "client/src/components/HomeScreen.tsx",
  "client/src/components/ChatPanel.tsx",
  "client/src/components/ChatInput.tsx",
  "client/src/components/HistoryScreen.tsx",
  "client/src/components/HistoryDayDetailScreen.tsx",
  "client/src/components/MealEditScreen.tsx",
  "client/src/components/GoalSettings.tsx",
  "client/src/components/Onboarding.tsx",
  "client/src/components/GuestSessionRecoveryGate.tsx",
] as const;

const HANDLER_SCAN_FILES = [
  ...AUDITED_COMPONENT_FILES,
  "client/src/components/MessageBubble.tsx",
  "client/src/components/onboarding/OnboardingStepper.tsx",
] as const;

const FORBIDDEN_ACTIVE_SYMBOLS = [
  "exportData",
  "clearAllRecords",
  "updateReminder",
  "updateTimezone",
  "updateLanguage",
  "backup",
  "restore",
  "account",
  "login",
  "跨裝置",
  "weekly insight",
  "stop generation",
] as const;

type HandlerKind = "onClick" | "onSubmit" | "onChange" | "onKeyDown" | "onPointerDown";

interface HandlerOccurrence {
  readonly file: string;
  readonly line: number;
  readonly kind: HandlerKind;
  readonly snippet: string;
}

interface ScannerExclusion {
  readonly file: string;
  readonly lineContains: string;
  readonly kind: HandlerKind;
  readonly reason: string;
}

const SCANNER_EXCLUSIONS: readonly ScannerExclusion[] = [
  {
    file: "client/src/components/ChatInput.tsx",
    lineContains: "setText(e.target.value)",
    kind: "onChange",
    reason: "ordinary text composer input onChange covered by Chat send row",
  },
  {
    file: "client/src/components/GoalSettings.tsx",
    lineContains: "normalizeTargetInputValue",
    kind: "onChange",
    reason: "ordinary numeric form input onChange covered by Settings daily-target row",
  },
  {
    file: "client/src/components/MealEditScreen.tsx",
    lineContains: "setDraft({ ...draft, foodName",
    kind: "onChange",
    reason: "ordinary meal-name form input onChange covered by Meal Edit update row",
  },
  {
    file: "client/src/components/MealEditScreen.tsx",
    lineContains: "setDraft({ ...draft, [field.key]",
    kind: "onChange",
    reason: "ordinary nutrition form input onChange covered by Meal Edit update row",
  },
  {
    file: "client/src/components/onboarding/OnboardingStepper.tsx",
    lineContains: "onChange={(e) => onChange?.(e.target.value)}",
    kind: "onChange",
    reason: "ordinary onboarding free-text input onChange covered by Onboarding intake row",
  },
  {
    file: "client/src/components/onboarding/OnboardingStepper.tsx",
    lineContains: "onChange={(e) => set(\"allergies\", e.target.value)}",
    kind: "onChange",
    reason: "ordinary onboarding allergies input onChange covered by Onboarding intake row",
  },
  {
    file: "client/src/components/onboarding/OnboardingStepper.tsx",
    lineContains: "onChange={(e) => set(\"advancedNotes\", e.target.value)}",
    kind: "onChange",
    reason: "ordinary onboarding advanced-notes input onChange covered by Onboarding intake row",
  },
  {
    file: "client/src/components/ChatPanel.tsx",
    lineContains: "onClick={handleBackToHome}",
    kind: "onClick",
    reason: "back navigation handler excluded because it only returns to Home and does not expose a capability affordance",
  },
  {
    file: "client/src/components/ChatPanel.tsx",
    lineContains: "onClick={() => {",
    kind: "onClick",
    reason: "local jump-to-latest viewport control excluded because it only scrolls within Chat and does not expose a backend capability",
  },
  {
    file: "client/src/components/MealEditScreen.tsx",
    lineContains: "onClick={onBack}",
    kind: "onClick",
    reason: "back or cancel navigation handler excluded because it does not expose a new capability affordance",
  },
  {
    file: "client/src/components/GoalSettings.tsx",
    lineContains: "onClick={onBack}",
    kind: "onClick",
    reason: "back navigation handler excluded because it only closes Settings and does not expose a capability affordance",
  },
];

async function readSource(path: string) {
  return readFile(path, "utf8");
}

function sourceMatcherRegExp(matcher: string) {
  if (matcher.startsWith("/") && matcher.endsWith("/") && matcher.length > 2) {
    return new RegExp(matcher.slice(1, -1));
  }

  return matcher;
}

function sourceIncludesMatcher(source: string, matcher: string) {
  const pattern = sourceMatcherRegExp(matcher);
  return typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);
}

function lineNumberForIndex(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function lineAt(source: string, line: number) {
  return source.split("\n")[line - 1]?.trim() ?? "";
}

function findHandlers(file: string, source: string): HandlerOccurrence[] {
  const handlers: HandlerOccurrence[] = [];
  const pattern = /\bon(Click|Submit|Change|KeyDown|PointerDown)=\{/g;
  for (const match of source.matchAll(pattern)) {
    const kind = `on${match[1]}` as HandlerKind;
    const index = match.index ?? 0;
    const line = lineNumberForIndex(source, index);
    handlers.push({ file, line, kind, snippet: lineAt(source, line) });
  }
  return handlers;
}

function contextAroundLine(source: string, line: number, radius = 12) {
  const lines = source.split("\n");
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start, end).join("\n");
}

function matrixRowsForFile(file: string) {
  return capabilityMatrix.filter((row) => row.sourceFile === file);
}

function findMatrixRow(surface: string, affordance: string): CapabilityMatrixRow {
  const row = capabilityMatrix.find((candidate) => candidate.surface === surface && candidate.affordance === affordance);
  assert.ok(row, `missing ${surface} ${affordance} row`);
  return row;
}

function isReasonedExclusion(handler: HandlerOccurrence) {
  return SCANNER_EXCLUSIONS.some((exclusion) => {
    assert.ok(exclusion.reason.trim().length > 12, `${exclusion.file} exclusion must include a reason string`);
    assert.doesNotMatch(
      exclusion.lineContains,
      /\*|all handlers|all buttons|every handler|every button/i,
      `${exclusion.file} exclusion must not be broad`,
    );
    return (
      exclusion.file === handler.file &&
      exclusion.kind === handler.kind &&
      handler.snippet.includes(exclusion.lineContains)
    );
  });
}

function hasMatrixRowNearHandler(handler: HandlerOccurrence, source: string) {
  const context = contextAroundLine(source, handler.line);
  return matrixRowsForFile(handler.file).some((row) =>
    row.activeHandler === "present" && (row.handlerMatchers ?? []).some((matcher) => sourceIncludesMatcher(context, matcher)),
  );
}

function labelForFailure(handler: HandlerOccurrence) {
  const element = handler.snippet.includes("<button")
    ? "button"
    : handler.snippet.includes("<form")
      ? "form"
      : handler.snippet.includes("<input")
        ? "input"
        : handler.snippet.includes("<textarea")
          ? "textarea"
          : "handler";
  return `${handler.file}:${handler.line} ${element} has no matrix entry`;
}

describe("capability matrix source scanner", () => {
  it("covers every required production component file and every matrix source matcher", async () => {
    for (const file of AUDITED_COMPONENT_FILES) {
      await assert.doesNotReject(readSource(file), `${file} must exist in strict scan set`);
    }

    for (const row of capabilityMatrix) {
      const source = await readSource(row.sourceFile);
      for (const matcher of row.sourceMatchers) {
        assert.ok(
          sourceIncludesMatcher(source, matcher),
          `${row.sourceFile} missing sourceMatcher ${matcher} for ${row.surface} ${row.affordance}`,
        );
      }
    }
  });

  it("keeps declared Home visible copy source-backed when present", async () => {
    for (const row of capabilityMatrix) {
      if (row.surface !== "Home" || row.visibleCopy === null) {
        continue;
      }

      const source = await readSource(row.sourceFile);
      assert.ok(
        source.includes(row.visibleCopy),
        `${row.sourceFile} missing visibleCopy ${row.visibleCopy} for ${row.surface} ${row.affordance}`,
      );
    }
  });

  it("maps every actionable handler to a matrix row or a reasoned scanner exclusion", async () => {
    for (const file of HANDLER_SCAN_FILES) {
      const source = await readSource(file);
      const handlers = findHandlers(file, source).filter((handler) => !isReasonedExclusion(handler));

      for (const handler of handlers) {
        assert.ok(hasMatrixRowNearHandler(handler, source), labelForFailure(handler));
      }
    }
  });

  it("requires Home and Day Detail matchers to describe their actual component handlers", async () => {
    const homeRow = findMatrixRow("Home", "Today meal rows and authorized thumbnails");
    const homeSource = await readSource(homeRow.sourceFile);
    const homeOpenMealEditIndex = homeSource.indexOf("openMealEdit(editPayload, \"home\")");
    assert.notEqual(homeOpenMealEditIndex, -1, "Home source must contain the concrete Home-origin edit handoff");
    const homeContext = contextAroundLine(homeSource, lineNumberForIndex(homeSource, homeOpenMealEditIndex));

    assert.ok(
      homeRow.handlerMatchers?.some((matcher) => sourceIncludesMatcher(homeContext, matcher)),
      "Home handlerMatchers must match near the concrete Home edit handler",
    );
    assert.ok(
      homeRow.sourceMatchers.every((matcher) => sourceIncludesMatcher(homeSource, matcher)),
      "Home sourceMatchers must all exist in HomeScreen.tsx",
    );

    const dayDetailRow = findMatrixRow("Day Detail", "Read-only day snapshot");
    const dayDetailSource = await readSource(dayDetailRow.sourceFile);
    const onBackIndex = dayDetailSource.indexOf("onClick={onBack}");
    assert.notEqual(onBackIndex, -1, "Day Detail source must contain the real back handler");
    const dayDetailContext = contextAroundLine(dayDetailSource, lineNumberForIndex(dayDetailSource, onBackIndex));

    assert.deepEqual(dayDetailRow.handlerMatchers, ["onBack"]);
    assert.ok(sourceIncludesMatcher(dayDetailContext, "onBack"), "Day Detail handler matcher must match near onBack");
    assert.doesNotMatch(dayDetailRow.sourceMatchers.join(" "), /\bopenMealEdit\b/);
    assert.doesNotMatch(dayDetailRow.handlerMatchers.join(" "), /\bopenMealEdit\b/);
  });

  it("documents meaningful action-level onChange handling policy", () => {
    const policy =
      "meaningful action-level onChange handlers change product state, selected mode, current date/week, chosen goal, selected onboarding option, or capability-visible settings; ordinary text/number input editing requires an explicit reasoned exclusion.";

    assert.match(policy, /meaningful action-level/);
    assert.match(policy, /ordinary text\/number input editing/);
    assert.ok(SCANNER_EXCLUSIONS.every((exclusion) => exclusion.reason.trim().length > 12));
  });

  it("keeps scanner exclusions narrow and unable to hide an audited surface", async () => {
    for (const exclusion of SCANNER_EXCLUSIONS) {
      assert.doesNotMatch(
        `${exclusion.file} ${exclusion.lineContains} ${exclusion.reason}`,
        /ignore all|all handlers|all buttons|file-wide|handler-wide/i,
        `${exclusion.file} uses an over-broad scanner exclusion`,
      );
    }

    for (const file of HANDLER_SCAN_FILES) {
      const source = await readSource(file);
      const handlers = findHandlers(file, source);
      const excludedHandlers = handlers.filter((handler) => isReasonedExclusion(handler));

      assert.ok(
        handlers.length === 0 || excludedHandlers.length < handlers.length,
        `${file} must not exclude all audited handlers`,
      );
    }
  });

  it("blocks forbidden future-control symbols from active handlers", async () => {
    for (const file of HANDLER_SCAN_FILES) {
      const source = await readSource(file);
      const handlers = findHandlers(file, source);

      for (const symbol of FORBIDDEN_ACTIVE_SYMBOLS) {
        for (const handler of handlers) {
          const context = contextAroundLine(source, handler.line, 8);
          assert.doesNotMatch(
            context,
            new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
            `${file}:${handler.line} active handler references forbidden future control ${symbol}`,
          );
        }
      }
    }
  });
});
