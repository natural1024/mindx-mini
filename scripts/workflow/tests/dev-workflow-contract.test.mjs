import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const AGENT_FILES = [
  ".codebuddy/agents/plan-agent.md",
  ".codebuddy/agents/code-agent.md",
  ".codebuddy/agents/code-review-agent.md",
  ".codebuddy/agents/test-agent.md",
];

const CONTRACT_FILES = [
  ".codebuddy/skills/dev-workflow/SKILL.md",
  ".codebuddy/rules/dev-workflow.mdc",
  "docs/agent-team-spec.md",
  ...AGENT_FILES,
];

const ENVELOPE_FIELDS = [
  "workflow_mode",
  "tier",
  "task",
  "contract",
  "scope",
  "evidence",
];

const PLAN_HEADINGS = [
  "## Contract",
  "## Design",
  "## Tasks",
  "## Verification",
  "## Execution log",
];

async function read(relativePath) {
  return readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

function planPath({ workflowMode, identity }) {
  const planKey =
    workflowMode === "issue"
      ? `${identity}`
      : workflowMode === "draft"
        ? `draft-${identity}`
        : `infra-${identity}`;
  return `.vibe/plans/plan-${planKey}.md`;
}

test("dev workflow agents are selected by capability rather than a model lock", async () => {
  for (const relativePath of CONTRACT_FILES) {
    const source = await read(relativePath);
    assert.doesNotMatch(source, /^model\s*:/mu, relativePath);
    assert.doesNotMatch(
      source,
      /(?:claude|opus|sonnet|haiku|gpt-|glm-)[a-z0-9.-]*/iu,
      relativePath,
    );
    assert.doesNotMatch(source, /model\s*=/iu, relativePath);
    assert.doesNotMatch(source, /(?:自报|fallback|dry-run)/iu, relativePath);
  }
});

test("all four agents accept the same six-field prompt envelope", async () => {
  for (const relativePath of AGENT_FILES) {
    const source = await read(relativePath);
    for (const field of ENVELOPE_FIELDS) {
      assert.match(
        source,
        new RegExp(`^${field}:`, "mu"),
        `${relativePath}: ${field}`,
      );
    }
    assert.match(source, /DRAFT-\*/u, `${relativePath}: local draft contract`);
  }
});

test("L3 plan operations use stable named headings", async () => {
  const skill = await read(".codebuddy/skills/dev-workflow/SKILL.md");
  const planAgent = await read(".codebuddy/agents/plan-agent.md");

  for (const heading of PLAN_HEADINGS) {
    assert.ok(skill.includes(heading), `skill: ${heading}`);
    assert.ok(planAgent.includes(heading), `plan-agent: ${heading}`);
  }

  for (const relativePath of CONTRACT_FILES) {
    const source = await read(relativePath);
    assert.doesNotMatch(source, /^##\s+\d+[.)]/mu, relativePath);
    assert.doesNotMatch(source, /第\s*\d+\s*节|§\s*\d+/u, relativePath);
  }
});

test("L3 plan keys preserve Issue paths and isolate draft and infrastructure plans", async () => {
  const skill = await read(".codebuddy/skills/dev-workflow/SKILL.md");
  const planAgent = await read(".codebuddy/agents/plan-agent.md");
  const rule = await read(".codebuddy/rules/dev-workflow.mdc");
  const spec = await read("docs/agent-team-spec.md");
  const contract = `${skill}\n${planAgent}\n${rule}\n${spec}`;

  assert.equal(
    planPath({ workflowMode: "issue", identity: 74 }),
    ".vibe/plans/plan-74.md",
  );
  const firstDraftPath = planPath({
    workflowMode: "draft",
    identity: "alpha",
  });
  const secondDraftPath = planPath({
    workflowMode: "draft",
    identity: "beta",
  });
  assert.notEqual(firstDraftPath, secondDraftPath);
  assert.equal(firstDraftPath, ".vibe/plans/plan-draft-alpha.md");
  assert.equal(
    planPath({ workflowMode: "infrastructure", identity: "runtime-lock" }),
    ".vibe/plans/plan-infra-runtime-lock.md",
  );
  assert.doesNotMatch(firstDraftPath, /NO-ISSUE/u);
  assert.doesNotMatch(contract, /plan-NO-ISSUE\.md/u);
  assert.match(contract, /Issue[^。\n]*(?:沿用|使用)[^。\n]*IID/u);
  assert.match(contract, /draft-<draftId>/u);
  assert.match(contract, /infra-<stable-task-id-or-slug>/u);
  assert.match(contract, /plan_key[^。\n]*(?:task|`task`)/u);
});

test("plan and execution agents return structured contract evidence", async () => {
  const plan = await read(".codebuddy/agents/plan-agent.md");
  const code = await read(".codebuddy/agents/code-agent.md");
  const review = await read(".codebuddy/agents/code-review-agent.md");
  const verify = await read(".codebuddy/agents/test-agent.md");

  assert.ok(plan.includes("✓ plan 已生成 → .vibe/plans/plan-<plan_key>.md"));
  assert.match(plan, /^result: PASS$/mu);
  assert.match(plan, /^ac_evidence:$/mu);

  assert.match(code, /^result: PASS$/mu);
  assert.match(code, /^result: FAIL$/mu);
  assert.match(code, /^ac_evidence:$/mu);

  assert.match(review, /^result: PASS$/mu);
  assert.match(review, /^result: NOT_PASS$/mu);
  assert.match(review, /^ac_evidence:$/mu);

  assert.match(verify, /^result: PASS$/mu);
  assert.match(verify, /^result: FAIL$/mu);
  assert.match(verify, /^ac_evidence:$/mu);
});
