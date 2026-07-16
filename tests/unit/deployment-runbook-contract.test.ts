import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";

function read(relativePath: string) {
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function assertOrdered(text: string, anchors: string[]) {
  let prior = -1;
  for (const anchor of anchors) {
    const current = text.indexOf(anchor);
    assert.notEqual(current, -1, `missing ordering anchor: ${anchor}`);
    assert.ok(current > prior, `out-of-order anchor: ${anchor}`);
    prior = current;
  }
}

function assertRuntimeRefreshOrder(text: string, recoveryAnchor: string) {
  assertOrdered(text, [
    "yarn release:check",
    recoveryAnchor,
    "```bash\nyarn db:migrate",
    "\nyarn build\n",
    "\nyarn start\n",
  ]);
}

describe("tracked deployment ordering", () => {
  it("makes PR, human merge, post-merge archive, and runtime refresh distinct ordered gates", () => {
    const runbook = read("docs/deploy/cloudflare-tunnel.md");
    const integratedFlow = runbook.slice(0, runbook.indexOf("## Environment"));

    assertOrdered(integratedFlow, [
      "Work reaches PR-ready source state on a non-`main` branch",
      "A PR targets `main`",
      "maintainer separately decides whether to merge",
      "After merge, local post-merge planning archive/closeout runs from updated `main`",
      "maintainer separately selects the merged source SHA",
      "approved B01 recovery gate quiesces writes",
      "Separately approved R05 migration and R06 build/start gates",
      "Cloudflare Tunnel change and the public-domain smoke retain their own separate approvals",
    ]);
    assert.doesNotMatch(runbook, /GSD milestone branch is verified and closed out/);
    assert.match(runbook, /If that workflow is paused, stop instead of inventing or skipping the archive/);
    assert.match(runbook, /never run it in the checkout serving the active production runtime/);
    assert.match(runbook, /Only a later R06 approval may build `dist\/client` in that runtime checkout/);
    const smokeSection = runbook.slice(runbook.indexOf("## Manual Smoke Checklist"), runbook.indexOf("## Stop Conditions"));
    assert.match(smokeSection, /Record public-domain smoke as its own outcome/);
    assert.doesNotMatch(smokeSection, /before marking production runtime refreshed/);
  });

  it("places recovery proof before migration and keeps restore separately authorized", () => {
    const tunnel = read("docs/deploy/cloudflare-tunnel.md");
    const buildSection = tunnel.slice(tunnel.indexOf("## Build and Start"), tunnel.indexOf("## Cloudflare Tunnel"));
    assertOrdered(buildSection, ["clean, non-serving verification checkout", "yarn release:check"]);
    assert.match(buildSection, /cp \.env\.example \.env\nyarn release:check/);
    assertRuntimeRefreshOrder(buildSection, "Production Storage Recovery");
    assert.match(buildSection, /obtain B01 approval/);

    const recovery = read("docs/deploy/production-recovery.md");
    assertOrdered(recovery.slice(0, recovery.indexOf("## Protected storage")), [
      "source PR is merged into `main`",
      "Post-merge local planning archive",
      "fresh runtime-refresh decision",
      "**B01**",
      "**R05**",
      "**R06**",
      "Tunnel changes and public smoke",
    ]);
    assert.match(recovery, /B02 restore is destructive and always requires its own fresh exact approval/);
    assert.match(recovery, /confirmation is an exact-input guard, not cryptographic proof of current-thread approval/);
    assert.match(recovery, /never reads `.env`/);
    assert.match(recovery, /every table's string-safe row count/);
    assert.match(recovery, /disable replacement objects and optional locks/);
    assert.match(recovery, /backup_reconciliation_required/);
    assert.match(recovery, /exclusively creates the final backup directory/);
    assert.match(recovery, /substituted path is preserved/);
    assert.match(recovery, /If the only available mechanism is a full process stop, B01 is blocked/);
    assert.match(recovery, /backup and quarantine roots must be pre-existing/);
    assert.match(recovery, /canonical Git top-level/);
    assert.match(recovery, /byte-match their blobs at the intended source commit/);
    assert.match(recovery, /changing a decision boolean invalidates the receipt/);
    assert.match(recovery, /reject every assume-unchanged or skip-worktree entry/);
    assert.match(recovery, /override repository fsmonitor\/untracked-cache configuration/);
    assert.match(recovery, /commit tree, stage-zero index, and stable worktree bytes\/modes directly/);
    assert.match(recovery, /entire backup\/quarantine roots—not merely outside one backup bundle/);
    assert.match(recovery, /hard-link file aliases/);
    assert.match(recovery, /five-minute `notAfter`/);
    assert.match(recovery, /mark each request UUID consumed and never reuse it/);
    assert.equal((recovery.match(/--request-id="\$FRESH_(?:VERIFY|ASSESS)_REQUEST_UUID"/g) ?? []).length, 2);
    assert.equal(
      (recovery.match(/--attestation-private-key="\$ABS_OFF_CHECKOUT_RECOVERY_PRIVATE_KEY"/g) ?? []).length,
      4,
    );
    assert.match(recovery, /--expected-private-manifest-sha256="\$APPROVED_PRIVATE_MANIFEST_SHA256"/);
    assert.match(recovery, /--expected-backup-bundle-sha256="\$APPROVED_BACKUP_BUNDLE_SHA256"/);
    assert.match(
      recovery,
      /RESTORE:\$BACKUP_ID:\$TARGET_SOURCE_SHA:\$RESTORE_SELECTION:\$APPROVED_PRIVATE_MANIFEST_SHA256:\$APPROVED_BACKUP_BUNDLE_SHA256/,
    );
    assert.match(recovery, /signed private prestate/);
    assert.match(recovery, /database\+assets\+uploads/);
    assert.match(recovery, /exclusive identity-pinned `replacement-staging` namespace/);
    assert.match(recovery, /restored asset\/upload directories are normalized to `0700`/);
    assert.match(recovery, /DB\/WAL\/SHM sidecars and selected directory mountpoints/);
    assert.match(recovery, /Actual effects are tracked only after a move is observed/);
    assert.match(recovery, /each actual-effect destination passes exact identity-and-content CAS/);
    assert.match(recovery, /owner\/key-CAS `unlink` is the terminal operation/);
    assert.match(recovery, /fallible lock-release preflight fault preserves the signed journal and lock/);
  });

  it("keeps both READMEs and the demo authority aligned with the recovery gate", () => {
    const readmeZh = read("README.md");
    const zhDeployment = readmeZh.slice(readmeZh.indexOf("## 部署"), readmeZh.indexOf("## 後續方向"));
    assertOrdered(zhDeployment, [
      "non-`main`",
      "Release Check",
      "maintainer 決定 merge",
      "post-merge local archive",
      "另行核准 runtime refresh",
    ]);
    assertOrdered(zhDeployment, ["乾淨且未承載服務的 verification checkout", "yarn release:check"]);
    assert.match(zhDeployment, /cp \.env\.example \.env\nyarn release:check/);
    assertRuntimeRefreshOrder(zhDeployment, "Production storage recovery");
    assert.match(zhDeployment, /不得在 active runtime checkout 執行/);
    assert.match(zhDeployment, /R06 才能改寫 runtime checkout 的 `dist\/client`/);

    const readmeEn = read("README-en.md");
    const enDeployment = readmeEn.slice(readmeEn.indexOf("## Deployment"), readmeEn.indexOf("## Next Steps"));
    assertOrdered(enDeployment, [
      "non-`main`",
      "Release Check",
      "maintainer merge decision",
      "post-merge local archive",
      "separately approved runtime refresh",
    ]);
    assertOrdered(enDeployment, ["clean, non-serving verification checkout", "yarn release:check"]);
    assert.match(enDeployment, /cp \.env\.example \.env\nyarn release:check/);
    assertRuntimeRefreshOrder(enDeployment, "Production storage recovery");
    assert.match(enDeployment, /must never run in the active runtime checkout/);
    assert.match(enDeployment, /only R06 may rewrite the runtime checkout's `dist\/client`/);

    const demo = read("docs/demo.md");
    assert.match(demo, /operator\.backup_approval/);
    assert.match(demo, /B01 quiescence／backup／restore-readiness/);
    assertOrdered(demo.slice(demo.indexOf("### R04"), demo.indexOf("### R07")), [
      "### R04 · recovery readiness",
      "Production storage recovery",
      "獨立 B01 approval",
      "restore-readiness proof",
      "### R05 · migration",
      "exact R05 approval",
      "yarn db:migrate",
      "### R06 · production-mode build and start",
      "yarn build",
      "yarn start",
    ]);
  });

  it("blocks runtime refresh until archive completion and isolates release preflight", () => {
    const release = read("docs/deploy/cloudflare-tunnel.md");
    const runtime = release.slice(release.indexOf("Source release and runtime refresh are separate gates"), release.indexOf("## Environment"));
    assertOrdered(runtime, [
      "A PR targets `main`",
      "maintainer separately decides whether to merge",
      "post-merge planning archive/closeout runs from updated `main`",
      "explicitly approves production runtime refresh",
    ]);
    assert.match(runtime, /If that workflow is paused, stop instead of inventing or skipping the archive/);

    const build = release.slice(release.indexOf("## Build and Start"), release.indexOf("## Cloudflare Tunnel"));
    assertOrdered(build, [
      "clean, non-serving verification checkout",
      "yarn release:check",
      "completed post-merge archive",
      "select the active runtime checkout separately",
      "Before `yarn db:migrate`",
    ]);
    assert.match(build, /never run it in the checkout serving the active production runtime/);
    assert.match(build, /Only a later R06 approval may build `dist\/client` in that runtime checkout/);
  });
});
