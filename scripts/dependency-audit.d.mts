export interface DependencyAuditGroups {
  dependencies?: Set<string>;
  devDependencies?: Set<string>;
}

export interface DependencyAuditAdvisory {
  packageName: string;
  severity: string;
  advisoryId: string;
  title: string;
  url: string;
  dependencyPath: string;
  dependencyType: string;
  scope: string;
  currentVersion: string;
  vulnerableRange: string;
  patchedRange: string;
}

export interface ParsedDependencyAudit {
  records: unknown[];
  advisories: DependencyAuditAdvisory[];
  auditSummary: Record<string, unknown> | null;
  errors: string[];
}

export interface DependencyAuditSummary {
  status: string;
  scope: string;
  command: string;
  args: string[];
  exitStatus: number;
  advisories: DependencyAuditAdvisory[];
  vulnerabilities: Record<string, number>;
  totalVulnerabilities: number;
  messages: string[];
}

export function buildYarnAuditArgs(argv?: string[]): string[];

export function parseYarnAuditJsonLines(
  stdout: string,
  options?: { dependencyGroups?: DependencyAuditGroups | null },
): ParsedDependencyAudit;

export function summarizeAudit(
  parsed: ParsedDependencyAudit,
  options?: { args?: string[]; exitStatus?: number; executionError?: unknown },
): DependencyAuditSummary;

export function renderAuditReport(summary: DependencyAuditSummary): string;
