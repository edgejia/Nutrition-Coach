import type { ZodType } from "zod";
import type { ToolCall } from "../llm/types.js";

// NOTE: Minimal stub for TDD RED phase. Implementation is added in GREEN.

export type RunContractFailureReason = "validation" | "guard" | "execute";

export interface ToolContract<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  zodSchema: ZodType<Args>;
  sourceFields?: readonly (keyof Args)[];
  execute: (
    args: Args,
    context: RunContractContext,
  ) => Promise<{ ok: true; result: Result; toolMessage: string }>;
  logSummary: (args: Args) => Record<string, unknown>;
}

export interface RunContractContext {
  currentUserMessage: string;
  previousAssistantMessage?: string;
  deps?: Record<string, unknown>;
}

export interface ToolExecuteResult<Result = unknown> {
  success: boolean;
  executed: boolean;
  failureReason?: RunContractFailureReason;
  result: string;
  contractResult?: Result;
  logSummary: Record<string, unknown> | string;
}

export async function runContract<Args, Result>(
  _contract: ToolContract<Args, Result>,
  _call: ToolCall,
  _context: RunContractContext,
): Promise<ToolExecuteResult<Result>> {
  throw new Error("runContract not implemented yet");
}

export function summarizeContractArgsForLog<Args, Result>(
  _contract: ToolContract<Args, Result>,
  _rawArgs: string,
): Record<string, unknown> | string {
  throw new Error("summarizeContractArgsForLog not implemented yet");
}
