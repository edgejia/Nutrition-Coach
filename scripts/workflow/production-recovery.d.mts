export class RecoveryError extends Error {
  code: string;
}

export type RecoveryScope = "non-production" | "production";

interface SignedRecoveryReceiptBase extends Record<string, unknown> {
  schemaVersion: 2;
  scope: RecoveryScope;
  backupId: string;
  observedAt: string;
  intendedSourceSha: string;
  attestationPublicKeySha256: string;
  receiptSignature: string;
}

export interface RecoveryBackupReceipt extends SignedRecoveryReceiptBase {
  kind: "production_storage_backup";
  preRefreshRuntimeSha: string;
  quiesced: true;
  sourceStable: true;
  databaseIntegrityOk: true;
  foreignKeysOk: true;
  durableCountsMatch: true;
  migrationJournalMatch: true;
  assetsMatch: true;
  uploadsCaptured: true;
  restoreReady: true;
  publishedDurably: true;
  checkoutSourceVerified: true;
  runtimeProvenanceVerified: true;
  privateManifestSha256: string;
  privateManifestSignature: string;
  backupBundleSha256: string;
}

export interface RecoveryVerificationReceipt extends SignedRecoveryReceiptBase {
  kind: "production_storage_backup_verification";
  requestId: string;
  issuedAt: string;
  notAfter: string;
  preRefreshRuntimeSha: string;
  databaseIntegrityOk: true;
  foreignKeysOk: true;
  privateManifestMatch: true;
  assetsMatch: true;
  uploadsMatch: true;
  restoreReady: true;
  bundleReadbackVerified: true;
  checkoutSourceVerified: true;
  privateManifestSha256: string;
  privateManifestSignature: string;
  backupBundleSha256: string;
}

export interface RecoveryAssessmentReceipt extends SignedRecoveryReceiptBase {
  kind: "production_storage_state_assessment";
  requestId: string;
  issuedAt: string;
  notAfter: string;
  preRefreshRuntimeSha: string;
  privateManifestSha256: string;
  privateManifestSignature: string;
  backupBundleSha256: string;
  runtimeStopped: true;
  backupReverified: true;
  backupStable: true;
  liveStateStable: true;
  databaseIntegrityOk: true;
  foreignKeysOk: true;
  durableCountsMatch: boolean;
  durableContentMatch: boolean;
  migrationJournalMatch: boolean;
  databaseMetadataMatch: boolean;
  databaseSchemaMatch: boolean;
  allTableCountsMatch: boolean;
  allTableContentMatch: boolean;
  fullLogicalStateMatch: boolean;
  assetsMatch: boolean;
  uploadsMatch: boolean;
  exactPreBackupState: boolean;
}

export interface RecoveryRestoreReceipt extends SignedRecoveryReceiptBase {
  kind: "production_storage_restore";
  targetSourceSha: string;
  restoreSelection: "database" | "database+assets" | "database+assets+uploads";
  runtimeStopped: true;
  backupReverified: true;
  databaseRestored: true;
  assetsRestored: boolean;
  uploadsRestored: boolean;
  quarantinePreserved: true;
  quarantineDurable: true;
  replacementDurable: true;
  journalCommitted: true;
  journalSequence: number;
  journalRecordSha256: string;
  restoreLockSha256: string;
  privatePrestateRecordSha256: string;
  privateManifestSha256: string;
  backupBundleSha256: string;
  databaseIntegrityOk: true;
  foreignKeysOk: true;
}

export type RecoveryReceipt =
  | RecoveryBackupReceipt
  | RecoveryVerificationReceipt
  | RecoveryAssessmentReceipt
  | RecoveryRestoreReceipt;

interface RecoveryAuthority extends Record<string, unknown> {
  checkoutRoot?: string;
  backupId?: string;
  intendedSourceSha?: string;
  preRefreshRuntimeSha?: string;
  scope?: string;
  attestationPublicKeyPath?: string;
  expectedAttestationPublicKeySha256?: string;
  now?: Date;
  testCheckpoint?: (stage: string) => void | Promise<void>;
}

interface RecoveryEvidence {
  expectedPrivateManifestSha256?: string;
  expectedBackupBundleSha256?: string;
}

export interface CreateRecoveryBackupOptions extends RecoveryAuthority {
  dbPath?: string;
  assetsDir?: string;
  uploadsDir?: string;
  backupRoot?: string;
  runtimeProvenanceOrigin?: string;
  quiesced?: unknown;
  attestationPrivateKeyPath?: string;
}

interface RecoveryBackupReference extends RecoveryAuthority {
  backupDir?: string;
  attestationPrivateKeyPath?: string;
}

export interface VerifyRecoveryBackupOptions extends RecoveryBackupReference {
  requestId: string;
}

export interface AssessRecoveryStateOptions extends RecoveryBackupReference, RecoveryEvidence {
  requestId: string;
  dbPath?: string;
  assetsDir?: string;
  uploadsDir?: string;
  runtimeStopped?: unknown;
}

export interface RestoreRecoveryBackupOptions extends RecoveryBackupReference, RecoveryEvidence {
  dbPath?: string;
  assetsDir?: string;
  uploadsDir?: string;
  quarantineRoot?: string;
  targetSourceSha?: string;
  runtimeStopped?: unknown;
  restoreAssets?: unknown;
  restoreUploads?: unknown;
  confirm?: string;
}

export function asiaTaipeiTimestamp(now?: Date): string;
export function createRecoveryBackup(
  options: CreateRecoveryBackupOptions,
): Promise<{ backupDir: string; receipt: RecoveryBackupReceipt }>;
export function verifyRecoveryBackup(options: VerifyRecoveryBackupOptions): Promise<RecoveryVerificationReceipt>;
export function assessRecoveryState(options: AssessRecoveryStateOptions): Promise<RecoveryAssessmentReceipt>;
export function restoreRecoveryBackup(options: RestoreRecoveryBackupOptions): Promise<RecoveryRestoreReceipt>;
