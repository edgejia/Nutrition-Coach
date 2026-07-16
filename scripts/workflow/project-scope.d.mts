import type { WorkflowProjectScope } from "./workflow-lease.mjs";

export class WorkflowProjectScopeError extends Error {
  code: string;
}

export interface PlanningScope extends WorkflowProjectScope {
  planningRoot: string;
  planningRootRelative: ".planning";
}

export function resolveCanonicalPlanningRoot(options: Record<string, any>): PlanningScope;
export function resolveCanonicalPlanningConfig(options: Record<string, any>): PlanningScope & { configPath: string };
export function resolveCanonicalPhaseRoot(options: Record<string, any>): PlanningScope & { phaseRoot: string; phaseId: string };
export function resolveCanonicalPlanningArtifact(options: Record<string, any>): Record<string, any>;
