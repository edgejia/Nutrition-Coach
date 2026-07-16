export type GsdWiringRole = "gsd-planner" | "gsd-plan-checker";
export type GsdWiringCheckpoint =
  | "before_final_evidence_check"
  | "before_apply_compare_and_rename"
  | "before_final_readback";

export interface GsdWiringFinding extends Record<string, unknown> {
  code: string;
  role?: GsdWiringRole;
  evidence?: string;
  skill?: string;
}

export interface GsdWiringCheck {
  schemaVersion: 1;
  kind: "gsd_hardening_wiring_check";
  status: "pass" | "fail";
  configSha256: string;
  requiredRoles: GsdWiringRole[];
  requiredSkill: string;
  sourceSha: string;
  skillBlobOid: string | null;
  skillSha256: string | null;
  guidanceFile: string;
  guidanceBlobOid: string | null;
  guidanceSha256: string | null;
  workstreamSurfaceSha256: string | null;
  worktreeIdentitySha256: string;
  gitCommonIdentitySha256: string;
  findings: GsdWiringFinding[];
}

export interface GsdWiringApply {
  schemaVersion: 1;
  kind: "gsd_hardening_wiring_apply";
  status: "pass";
  changed: boolean;
  beforeConfigSha256: string;
  afterConfigSha256: string;
  boundRoles: GsdWiringRole[];
  skill: string;
  skillBlobOid: string;
  skillSha256: string;
  guidanceFile: string;
  guidanceBlobOid: string;
  guidanceSha256: string;
  sourceSha: string;
  writerFenceId: string;
  writerFenceReleased: true;
  cleanupRequired: false;
}

export type GsdWiringApplyResult =
  | GsdWiringApply
  | (Omit<GsdWiringApply, "status" | "writerFenceReleased" | "cleanupRequired"> & {
      status: "needs_reconciliation";
      writerFenceReleased: false;
      cleanupRequired: true;
      writerCleanupCode: string;
    });

export interface CheckGsdWiringOptions {
  projectRoot: string;
  configPath: string;
  testCheckpoint?: (stage: "before_final_evidence_check") => void | Promise<void>;
}

export interface ApplyGsdWiringOptions {
  projectRoot: string;
  configPath: string;
  confirmDigest: string;
  sourceSha: string;
  tokenFile: string;
  expectedRuntime: "codex" | "claude";
  maxDurationSeconds?: number;
  now?: Date;
  fenceId?: string;
  testCheckpoint?: (stage: GsdWiringCheckpoint) => void | Promise<void>;
}

export function checkGsdHardeningWiring(options: CheckGsdWiringOptions): Promise<GsdWiringCheck>;
export function applyGsdHardeningWiring(options: ApplyGsdWiringOptions): Promise<GsdWiringApplyResult>;
