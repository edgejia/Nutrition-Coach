import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.TZ = "Asia/Taipei";

const repositoryRoot = path.resolve(".");
const issueTemplateDirectory = path.join(repositoryRoot, ".github", "ISSUE_TEMPLATE");
const pullRequestTemplateDirectory = path.join(repositoryRoot, ".github", "PULL_REQUEST_TEMPLATE");
const bugFormPath = path.join(issueTemplateDirectory, "bug_report.yml");
const changeRequestPath = path.join(issueTemplateDirectory, "change_request.yml");
const pullRequestTemplatePath = path.join(repositoryRoot, ".github", "PULL_REQUEST_TEMPLATE.md");
const contributingPath = path.join(repositoryRoot, "CONTRIBUTING.md");

const bugForm = fs.readFileSync(bugFormPath, "utf8");
const changeRequest = fs.readFileSync(changeRequestPath, "utf8");
const pullRequestTemplate = fs.readFileSync(pullRequestTemplatePath, "utf8");
const contributing = fs.readFileSync(contributingPath, "utf8");

function sectionForId(source: string, id: string): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`\\n  - type:[\\s\\S]*?\\n    id: ${escapedId}[\\s\\S]*?(?=\\n  - type:|$)`));
  assert.ok(match, `missing form section for id: ${id}`);
  return match[0];
}

function requiredFieldIds(source: string): string[] {
  return [...source.matchAll(/^    id: ([a-z0-9-]+)$/gm)].map((match) => match[1]);
}

describe("phase 129 issue and PR template contract", () => {
  test("keeps exactly one bug form, one change request form, and config", () => {
    assert.deepEqual(
      fs.readdirSync(issueTemplateDirectory).filter((entry) => entry.endsWith(".yml")).sort(),
      ["bug_report.yml", "change_request.yml", "config.yml"],
    );
    assert.equal(fs.existsSync(path.join(issueTemplateDirectory, "feature_request.yml")), false);
    assert.equal(fs.existsSync(path.join(issueTemplateDirectory, "enhancement.yml")), false);
    assert.equal(fs.existsSync(path.join(issueTemplateDirectory, "chore.yml")), false);
    assert.match(bugForm, /^name: Bug report$/m);
    assert.match(bugForm, /^labels: \["bug", "needs-triage"\]$/m);
    assert.match(bugForm, /id: pii/);

    const pullRequestFiles = fs.existsSync(pullRequestTemplateDirectory)
      ? fs.readdirSync(pullRequestTemplateDirectory).filter((entry) => !entry.startsWith("."))
      : [];
    assert.deepEqual(pullRequestFiles, []);
    assert.equal(fs.existsSync(pullRequestTemplatePath), true);
    assert.equal(fs.existsSync(path.join(pullRequestTemplateDirectory, "feature.md")), false);
    assert.equal(fs.existsSync(path.join(pullRequestTemplateDirectory, "enhancement.md")), false);
    assert.equal(fs.existsSync(path.join(pullRequestTemplateDirectory, "fix.md")), false);
  });

  test("requires the unified change request fields and exact fixed labels", () => {
    const labels = changeRequest.match(/^labels:\s*\[(.*)\]$/m)?.[1]
      .split(",")
      .map((label) => label.trim().replace(/^['"]|['"]$/g, ""));
    assert.deepEqual(labels, ["change-request", "needs-review"]);

    const requestTypeSection = sectionForId(changeRequest, "request-type");
    const requestTypeOptions = [...requestTypeSection.matchAll(/^        - (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(requestTypeOptions, ["Feature", "Enhancement", "Maintenance"]);
    assert.match(requestTypeSection, /validations:\n      required: true/);

    const requiredIds = [
      "problem-current-state",
      "proposed-change",
      "scope",
      "user-operator-impact",
      "acceptance-criteria",
      "runtimes",
      "breaking-change-assessment",
      "risk",
      "maintenance-burden",
      "alternatives",
      "privacy-sanitization",
    ];
    const actualIds = requiredFieldIds(changeRequest);
    for (const id of requiredIds) {
      assert.ok(actualIds.includes(id), `missing required change-request field: ${id}`);
      assert.match(sectionForId(changeRequest, id), /validations:\n      required: true/);
    }
    assert.match(changeRequest, /metadata-only and sanitized/);
    assert.match(changeRequest, /personal data, images, tokens, cookies, secrets/);
  });

  test("keeps one generic PR template with provenance and independent authority wording", () => {
    assert.match(pullRequestTemplate, /Closes #/);
    assert.match(pullRequestTemplate, /ready-for-pr/);
    assert.match(pullRequestTemplate, /PR-only `no-changelog`/);
    assert.match(pullRequestTemplate, /## Verification/);
    assert.match(pullRequestTemplate, /do not authorize merge/i);
    assert.match(pullRequestTemplate, /Source release to `main`/);
    assert.match(pullRequestTemplate, /runtime refresh/);
    assert.match(pullRequestTemplate, /Cloudflare Tunnel/);
    assert.match(pullRequestTemplate, /public-domain smoke/);

    const markers = pullRequestTemplate.match(/\[(Feature|Enhancement|Bug|Chore)\]/g) || [];
    assert.deepEqual(markers, ["[Feature]"]);
    assert.match(pullRequestTemplate, /Feature uses feature-request \+ approved-feature/);
    assert.match(pullRequestTemplate, /Enhancement uses enhancement \+ approved-enhancement/);
    assert.match(pullRequestTemplate, /Bug uses bug \+ confirmed-bug/);
    assert.match(pullRequestTemplate, /Maintenance uses type: chore/);
    assert.doesNotMatch(pullRequestTemplate, /PR readiness[^\n]*(?:authorizes|authorise)/i);
  });

  test("documents only the retained issue and PR paths without dropping bug reporting", () => {
    assert.match(contributing, /\.github\/ISSUE_TEMPLATE\/change_request\.yml/);
    assert.match(contributing, /\.github\/ISSUE_TEMPLATE\/bug_report\.yml/);
    assert.match(contributing, /\.github\/PULL_REQUEST_TEMPLATE\.md/);
    assert.match(contributing, /Bug fixes continue to use/);
    assert.match(contributing, /confirmed-bug/);

    for (const stalePath of [
      "feature_request.yml",
      "enhancement.yml",
      "chore.yml",
      "PULL_REQUEST_TEMPLATE/feature.md",
      "PULL_REQUEST_TEMPLATE/enhancement.md",
      "PULL_REQUEST_TEMPLATE/fix.md",
      "?template=feature.md",
      "?template=enhancement.md",
      "?template=fix.md",
    ]) {
      assert.doesNotMatch(contributing, new RegExp(stalePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(contributing, /ready-for-pr is a manual issue-side gate/);
    assert.match(contributing, /No workflow creates a new remote label/);
    assert.match(contributing, /no-changelog.*pull request only/i);
  });

  test("keeps the stable request-type mapping and same-issue approval contract explicit", () => {
    const mapping = [
      ["Feature", "feature-request", "approved-feature"],
      ["Enhancement", "enhancement", "approved-enhancement"],
      ["Bug", "bug", "confirmed-bug"],
      ["Maintenance", "type: chore", "\\[Chore\\]"],
    ] as const;

    for (const [requestType, issueType, approvalOrMarker] of mapping) {
      assert.match(contributing, new RegExp(requestType));
      assert.match(`${contributing}\n${pullRequestTemplate}`, new RegExp(issueType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(`${contributing}\n${pullRequestTemplate}`, new RegExp(approvalOrMarker));
    }

    assert.match(contributing, /same issue/);
    assert.doesNotMatch(`${changeRequest}\n${pullRequestTemplate}`, /create(?:s|d)? a new remote label/i);
    assert.doesNotMatch(contributing, /approved-(?:feature|enhancement).*ready-for-pr.*substitut/i);
  });
});
