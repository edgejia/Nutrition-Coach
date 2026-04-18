import type { ZodType } from "zod";
import type { ToolCall } from "../llm/types.js";
import { FatalToolError, isFatalToolError } from "./tools.js";

export type RunContractFailureReason = "validation" | "guard" | "execute";

export interface ToolContract<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  /**
   * LLM-facing JSON schema describing arguments. Kept handwritten (D-06).
   */
  parameters: Record<string, unknown>;
  /**
   * Runtime validation (D-07). Unknown/invalid-shape arguments must be rejected
   * before `execute` can run.
   */
  zodSchema: ZodType<Args>;
  /**
   * Fields whose numeric value must appear in the user's current-turn source
   * text or the immediately previous assistant clarification (D-09/D-11).
   */
  sourceFields?: readonly (keyof Args)[];
  execute: (
    args: Args,
    context: RunContractContext,
  ) => Promise<{ ok: true; result: Result; toolMessage: string }>;
  /**
   * Redacted log summary. Must not include raw user text or raw numeric
   * values (D-30). Field names and booleans only.
   */
  logSummary: (args: Args) => Record<string, unknown>;
}

export interface RunContractContext {
  currentUserMessage: string;
  previousAssistantMessage?: string;
  /**
   * Generic dependency bag available to contracts that need services or
   * publishers. Implementation-specific contracts narrow this at call sites.
   */
  deps?: Record<string, unknown>;
}

export interface ToolExecuteResult<Result = unknown> {
  success: boolean;
  executed: boolean;
  failureReason?: RunContractFailureReason;
  /**
   * Stringified tool message returned to the LLM loop. On success it is the
   * contract's toolMessage; on failure it is a structured JSON payload.
   */
  result: string;
  contractResult?: Result;
  /**
   * Redacted structured summary for hooks + logging. On parse/validation
   * failures this is a stable string placeholder instead of user data.
   */
  logSummary: Record<string, unknown> | string;
}

function stringifyFailure(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function extractFieldPaths(
  issues: Array<{ path: Array<string | number | symbol> }>,
): string[] {
  const paths = new Set<string>();
  for (const issue of issues) {
    if (issue.path.length === 0) {
      paths.add("<root>");
    } else {
      paths.add(issue.path.map((segment) => String(segment)).join("."));
    }
  }
  return [...paths];
}

/**
 * Summarize raw tool-call JSON arguments for pre-execution logging (D-08/D-30).
 *
 * This primitive MUST be used before `onToolReceived` is fired so that log
 * sinks never see raw numeric values from the model's tool arguments. On any
 * parse or validation failure it returns a stable string placeholder and does
 * not leak the raw JSON.
 */
export function summarizeContractArgsForLog<Args, Result>(
  contract: ToolContract<Args, Result>,
  rawArgs: string,
): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return `<${contract.name} args>`;
  }
  const validated = contract.zodSchema.safeParse(parsed);
  if (!validated.success) {
    return `<${contract.name} args>`;
  }
  return contract.logSummary(validated.data);
}

/**
 * Controlled tool contract runner (D-07). Validates args, runs the optional
 * source-text guard, invokes `contract.execute`, and maps `FatalToolError`
 * into a controlled non-executed result. Any other thrown error propagates so
 * the Phase 8 fallback path stays intact.
 */
export async function runContract<Args, Result>(
  contract: ToolContract<Args, Result>,
  call: ToolCall,
  context: RunContractContext,
): Promise<ToolExecuteResult<Result>> {
  // 1. JSON parse (controlled validation failure)
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(call.function.arguments);
  } catch {
    return {
      success: false,
      executed: false,
      failureReason: "validation",
      result: stringifyFailure({
        reason: "invalid_json",
        failureReason: "validation",
      }),
      logSummary: `<${contract.name} args>`,
    };
  }

  // 2. Zod safeParse (controlled validation failure)
  const validated = contract.zodSchema.safeParse(rawParsed);
  if (!validated.success) {
    const fields = extractFieldPaths(validated.error.issues);
    return {
      success: false,
      executed: false,
      failureReason: "validation",
      result: stringifyFailure({
        reason: "schema_validation",
        failureReason: "validation",
        fields,
      }),
      logSummary: `<${contract.name} args>`,
    };
  }

  const args = validated.data as Args;

  // 3. Source-text guard (controlled guard failure)
  if (contract.sourceFields && contract.sourceFields.length > 0) {
    // Lazy import to avoid circular dependency at module load time.
    const { checkSourceFields } = await import("./source-text-guard.js");
    const guardResult = checkSourceFields(
      args as Record<string, unknown>,
      contract.sourceFields as readonly string[],
      {
        currentUserMessage: context.currentUserMessage,
        previousAssistantMessage: context.previousAssistantMessage,
      },
    );
    if (!guardResult.ok) {
      return {
        success: false,
        executed: false,
        failureReason: "guard",
        result: stringifyFailure({
          reason: "source_text_guard",
          failureReason: "guard",
          guardedFields: guardResult.guardedFields,
        }),
        logSummary: contract.logSummary(args),
      };
    }
  }

  // 4. Execute (controlled execute failure only for FatalToolError)
  try {
    const executed = await contract.execute(args, context);
    return {
      success: true,
      executed: true,
      result: executed.toolMessage,
      contractResult: executed.result,
      logSummary: contract.logSummary(args),
    };
  } catch (err) {
    if (isFatalToolError(err)) {
      const message = err instanceof FatalToolError ? err.message : "execute_failed";
      return {
        success: false,
        executed: false,
        failureReason: "execute",
        result: stringifyFailure({
          reason: "execute_failed",
          failureReason: "execute",
          message,
        }),
        logSummary: contract.logSummary(args),
      };
    }
    throw err;
  }
}
