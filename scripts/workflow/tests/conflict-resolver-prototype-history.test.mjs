import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ruleUrl = new URL(
  "../../../.codebuddy/rules/conflict-resolver-route.mdc",
  import.meta.url,
);
const skillUrl = new URL(
  "../../../.codebuddy/skills/conflict-resolver/SKILL.md",
  import.meta.url,
);
const prototypeWorkflowUrl = new URL(
  "../../../.codebuddy/skills/prototype-workflow/SKILL.md",
  import.meta.url,
);

const rule = readFileSync(ruleUrl, "utf8");
const skill = readFileSync(skillUrl, "utf8");
const prototypeWorkflow = readFileSync(prototypeWorkflowUrl, "utf8");

function assertOrdered(source, earlier, later, message) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);

  assert.ok(earlierIndex >= 0, `missing required policy anchor: ${earlier}`);
  assert.ok(laterIndex >= 0, `missing required policy anchor: ${later}`);
  assert.ok(earlierIndex < laterIndex, message);
}

test("route rejects prototype history operations before authorization", () => {
  assertOrdered(
    rule,
    "约束 0：prototype 历史隔离",
    "约束 1：心理锚点",
    "prototype hard stop must run before authorization",
  );
  assert.match(rule, /当前分支.*`prototype\/\*\*`/);
  assert.match(rule, /BASE.*source ref.*`prototype\/\*\*`/i);
  assert.match(
    rule,
    /merge.*rebase.*cherry-pick.*source ref.*`prototype\/\*\*`/is,
  );
  assert.match(rule, /prototype 分支只允许.*commit.*push/is);
  assert.doesNotMatch(
    rule,
    /不含 `--ff-only`/,
    "fast-forward merge must not be exempt from the route",
  );
});

test("skill rejects prototype history operations before auth and fetch", () => {
  assertOrdered(
    skill,
    "Phase -1: prototype 历史隔离",
    "Phase 0: 确认用户授权",
    "prototype hard stop must run before authorization",
  );
  assertOrdered(
    skill,
    "Phase -1: prototype 历史隔离",
    'git fetch origin "$BASE"',
    "prototype hard stop must run before fetch",
  );
  assert.match(skill, /当前分支.*`prototype\/\*\*`/);
  assert.match(skill, /BASE.*source ref.*`prototype\/\*\*`/i);
  assert.match(
    skill,
    /merge.*rebase.*cherry-pick.*source ref.*`prototype\/\*\*`/is,
  );
  assert.match(skill, /合法的非 prototype target/);
});

test("fast-forward path remains behind the prototype history gate", () => {
  const phase2Start = skill.indexOf("Phase 2: 快捷路径判定");
  const phase3Start = skill.indexOf("Phase 3: 工作区准备");

  assert.ok(phase2Start >= 0 && phase3Start > phase2Start);
  const phase2 = skill.slice(phase2Start, phase3Start);
  assert.match(phase2, /Phase -1/);
  assert.match(phase2, /fast-forward/);
  assert.match(phase2, /不得.*prototype/is);
  assert.doesNotMatch(
    prototypeWorkflow,
    /pull[^\n]*--ff-only/i,
    "prototype resume must not move history through pull --ff-only",
  );
});

test("conflict resolver docs do not restore master as a default", () => {
  assert.doesNotMatch(`${rule}\n${skill}`, /(?:origin\/|兜底 `)master\b/);
});
