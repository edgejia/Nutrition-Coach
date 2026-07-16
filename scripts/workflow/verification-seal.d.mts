export class VerificationSealError extends Error {
  code: string;
}

export interface VerificationSeal extends Record<string, any> {
  schemaVersion: 1 | 2;
  kind: "workflow_verification_seal";
  phaseId: string;
  evidenceManifestSha256: string;
  sealSha256?: string;
  sealSignature?: string;
}

export interface VerificationSealCheck extends Record<string, any> {
  schemaVersion: 1;
  kind: "workflow_verification_seal_check";
  status: "pass" | "fail";
  code: string;
  staleInputs: string[];
}

export function createVerificationSeal(options: Record<string, any>): Promise<VerificationSeal>;
export function checkVerificationSeal(options: Record<string, any>): Promise<VerificationSealCheck>;
export function writeVerificationSeal(options: Record<string, any>): Promise<Record<string, any>>;
