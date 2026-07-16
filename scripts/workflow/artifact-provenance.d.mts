export class ArtifactProvenanceError extends Error {
  code: string;
}

export interface ArtifactProvenanceStamp extends Record<string, any> {
  kind: "workflow_artifact_provenance_stamp";
  status: "pass" | "needs_reconciliation";
  changed: boolean;
  receiptCommitted: boolean;
  artifactProvenanceSha256: string;
  reconciliationCode: string | null;
  recoveryAction:
    | "already_committed"
    | "finalized_prepared_receipt"
    | "rolled_back_prepared_receipt"
    | "removed_orphan_artifact_temp"
    | null;
  transactionState: null | {
    phase: string;
    receiptPublished: boolean;
    artifactReplaced: boolean;
    artifactDurable: boolean;
    receiptReplaced: boolean;
    receiptDurable: boolean;
  };
  receipt: null | Record<string, unknown>;
}

export interface ArtifactProvenanceFinding extends Record<string, unknown> {
  artifact: string;
  code: string;
}

export interface ArtifactProvenanceCheck extends Record<string, any> {
  status: "pass" | "fail";
  records: Array<Record<string, any>>;
  findings: ArtifactProvenanceFinding[];
}

export function stampArtifactProvenance(options: Record<string, any>): Promise<ArtifactProvenanceStamp>;
export function checkArtifactProvenance(options: Record<string, any>): Promise<ArtifactProvenanceCheck>;
