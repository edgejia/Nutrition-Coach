export class GsdPilotSeedError extends Error {
  code: string;
}

export type GsdPilotSeedCheckpoint =
  | "before_seed_snapshot"
  | "before_seed_publish"
  | "after_seed_publish"
  | "before_seed_lock_release";

export interface GsdPilotSeedOptions {
  projectRoot: string;
  sourceRoot: string;
  pilotId: string;
  confirmSourceSha: string;
  expectedBranch: string;
  confirm: string;
  testCheckpoint?: (stage: GsdPilotSeedCheckpoint) => void | Promise<void>;
}

export interface GsdPilotSeedReceipt {
  schemaVersion: 1;
  kind: "gsd_pilot_seed_receipt";
  status: "pass";
  pilotId: string;
  sourceSha: string;
  syntheticPhase: "999";
  entryCount: number;
  planningTreeSha256: string;
  seedManifestSha256: string;
}

export function createGsdPilotSeed(options: GsdPilotSeedOptions): Promise<GsdPilotSeedReceipt>;
