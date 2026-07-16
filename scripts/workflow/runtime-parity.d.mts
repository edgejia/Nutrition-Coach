export class RuntimeParityError extends Error {
  code: string;
}

export type RuntimeParityStatus = "equivalent" | "intentional_difference" | "blocking" | "deferred";
export type RuntimeParityRuntime = "codex" | "claude";
export type RuntimeParityCheckStatus = "pass" | "fail";

export interface RuntimeParityFinding extends Record<string, unknown> {
  code: string;
}

export interface RuntimeParityWiringFinding extends Record<string, unknown> {
  code: string;
}

export interface RuntimeParityExpectedWiringFinding {
  code: "wiring_role_binding_missing";
  role: "gsd-plan-checker" | "gsd-planner";
  skill: ".codex/skills/nutrition-planning-proof";
}

export interface RuntimeParityFileIdentity {
  dev: string;
  ino: string;
  nlink: string;
  mode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

export interface RuntimeParityFileEvidence {
  sha256: string;
  identity: RuntimeParityFileIdentity;
}

export interface RuntimeParityRow {
  id: string;
  status: RuntimeParityStatus;
  proof: string;
  codex: string;
  claude: string;
  acceptedRationale?: string;
  residualRisk: string;
}

export interface RuntimeParityHostProfile {
  embeddingMode: string;
  maxDepth: number;
  backgroundDispatch: boolean;
  sandboxTier: string;
  configFormat: string;
  writesSharedSettings: boolean;
}

export interface RuntimeParityMatrix {
  schemaVersion: 1;
  kind: "nutrition_runtime_parity_matrix";
  observedAt: string;
  gsdVersion: string;
  coreFiles: Record<string, string>;
  projectVerifierFiles: Record<string, string>;
  expectedWiringFindings: RuntimeParityExpectedWiringFinding[];
  skillSurface: {
    expectedGsdSkillCount: number;
    codexRoot: "~/.agents/skills";
    claudeRoot: "~/.claude/skills";
    manifests: Record<RuntimeParityRuntime, Record<string, string>>;
  };
  projectInstructionFiles: Record<RuntimeParityRuntime, { path: string; sha256: string }>;
  sharedConfig: {
    sha256: string;
    runtime: "codex";
    hostIdentityAuthoritative: false;
  };
  hostProfiles: Record<RuntimeParityRuntime, RuntimeParityHostProfile>;
  rows: RuntimeParityRow[];
}

export interface RuntimeParityRowCounts {
  equivalent: number;
  intentional_difference: number;
  blocking: number;
  deferred: number;
}

export interface DeterministicParitySmoke {
  equivalent: boolean;
  goodStatus: string;
  badStatus: string;
  badRuleIds: string[];
}

export interface ProjectVerifierResult {
  status: RuntimeParityCheckStatus;
  observed: Record<string, string>;
  bundleSha256: string;
  findings: RuntimeParityFinding[];
}

export interface RuntimeCoreInspection {
  status: RuntimeParityCheckStatus;
  version: string | null;
  observed: Record<string, string>;
  registryRuntimes: Record<string, { runtime: Record<string, unknown> }> | null;
  findings: RuntimeParityFinding[];
}

export interface RuntimeParityWiringComparison {
  exact: boolean;
  findings: RuntimeParityFinding[];
}

export interface RuntimeParityCheckOptions {
  projectRoot: string;
  testCheckpoint?: (stage: "before_final_freshness_check") => void | Promise<void>;
  [key: string]: unknown;
}

export interface RuntimeParityCheck {
  schemaVersion: 1;
  kind: "nutrition_runtime_parity_check";
  status: RuntimeParityCheckStatus;
  readiness: "ready" | "not_ready";
  sourceSha: string;
  matrixSha256: string;
  projectVerifierBundleSha256: string;
  planningConfigSha256: string | null;
  observedWiringFindings: RuntimeParityWiringFinding[] | null;
  evidenceSnapshotSha256: string;
  worktreeIdentitySha256: string;
  gitCommonIdentitySha256: string;
  gsdVersion: string;
  rowCounts: RuntimeParityRowCounts;
  observedCore: Record<string, Partial<Record<RuntimeParityRuntime, string>>>;
  deterministicSmoke: DeterministicParitySmoke;
  findings: RuntimeParityFinding[];
}

export function captureRuntimeParityFileEvidence(filePath: string, code?: string): Promise<RuntimeParityFileEvidence>;
export function parseGeneratedRegistryRuntimes(
  raw: Buffer | string,
): Record<string, { runtime: Record<string, unknown> }>;
export function inspectRuntimeCoreRoot(
  root: string,
  expectedCoreFiles: Record<string, string>,
  expectedVersion: string,
): Promise<RuntimeCoreInspection>;
export function validateRuntimeParityMatrix(matrix: unknown): RuntimeParityMatrix;
export function compareRuntimeWiringFindings(
  observed: unknown,
  expected: unknown,
): RuntimeParityWiringComparison;
export function deriveRuntimeParityReadiness(
  status: RuntimeParityCheckStatus,
  rowCounts: Pick<RuntimeParityRowCounts, "blocking" | "deferred">,
): "ready" | "not_ready";
export function runDeterministicParitySmoke(projectRoot: string): Promise<DeterministicParitySmoke>;
export function verifyProjectVerifierFiles(
  projectRoot: string,
  expected: Record<string, string>,
): Promise<ProjectVerifierResult>;
export function checkLiveRuntimeParity(options: RuntimeParityCheckOptions): Promise<RuntimeParityCheck>;
