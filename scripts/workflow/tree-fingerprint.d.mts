export class TreeFingerprintError extends Error {
  code: string;
}

export interface TreeFingerprintEntry extends Record<string, unknown> {
  path: string;
  type: "directory" | "file" | "symlink";
  mode: string;
  size: number;
}

export interface TreeFingerprint extends Record<string, any> {
  schemaVersion: 1;
  kind: "workflow_tree_fingerprint";
  status: "pass";
  entryCount: number;
  totalFileBytes: number;
  treeSha256: string;
  entries: TreeFingerprintEntry[];
}

export function fingerprintTree(options: { root: string }): Promise<TreeFingerprint>;
