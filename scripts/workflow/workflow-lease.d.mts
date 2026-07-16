export class WorkflowLeaseError extends Error {
  code: string;
}

export interface WorkflowProjectScope {
  projectRoot: string;
  commonDir: string;
  worktreeIdentitySha256: string;
  gitCommonIdentitySha256: string;
}

export interface WorkflowWriterContext extends Record<string, any> {
  fenceId: string;
  fenceDigest: string;
  fenceExpiresAt: string;
  signPayload(value: unknown): string;
  nestedEnvironment(): {
    NUTRITION_WORKFLOW_FENCE_ID: string;
    NUTRITION_WORKFLOW_FENCE_CAPABILITY: string;
  };
  assertCurrent(): Promise<void>;
  beginChildRegistration(): Promise<void>;
  registerChildProcessGroup(processGroupId: number): Promise<void>;
  clearChildRegistration(): Promise<void>;
}

export interface ReleaseWorkflowLeaseOptions extends Record<string, any> {
  projectRoot: string;
  commonDir?: string;
  tokenFile: string;
  expectedTransitionId?: string;
  now?: Date;
}

export function acquireWorkflowLease(options: Record<string, any>): Promise<Record<string, any>>;
export function workflowTakeoverAuthorizationPayload(options: Record<string, any>): Record<string, any>;
export function resolveWorkflowProjectScope(options: { projectRoot: string; commonDir?: string }): WorkflowProjectScope;
export function getWorkflowLeaseStatus(options: Record<string, any>): Promise<Record<string, any>>;
export function assertWorkflowLeaseHolder(options: Record<string, any>): Promise<Record<string, any>>;
export function withWorkflowWriterFence<T>(
  options: Record<string, any>,
  callback: (context: WorkflowWriterContext) => Promise<T> | T,
): Promise<T | (T extends object ? T & Record<string, any> : never)>;
export function verifyWorkflowLeaseSignature(options: Record<string, any>): Promise<Record<string, any>>;
export function renewWorkflowLease(options: Record<string, any>): Promise<Record<string, any>>;
export function releaseWorkflowLease(options: ReleaseWorkflowLeaseOptions): Promise<Record<string, any>>;
export function takeoverWorkflowLease(options: Record<string, any>): Promise<Record<string, any>>;
export function recoverWorkflowLeaseMutex(options: Record<string, any>): Promise<Record<string, any>>;
export function recoverCorruptWorkflowLeaseMutex(options: Record<string, any>): Promise<Record<string, any>>;
export function recoverWorkflowWriterFence(options: Record<string, any>): Promise<Record<string, any>>;
