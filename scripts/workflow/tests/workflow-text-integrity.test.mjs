import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const WORKFLOW_TEXT_FILES = [
  ".codebuddy/skills/cmd-publish/SKILL.md",
  ".codebuddy/skills/prototype-deploy/SKILL.md",
  ".codebuddy/skills/prototype-handoff/SKILL.md",
  ".codebuddy/skills/prototype-workflow/SKILL.md",
  ".codebuddy/skills/_shared/issue-creation.md",
  ".codebuddy/skills/dev-workflow/SKILL.md",
  ".codebuddy/skills/workspace-doc/SKILL.md",
  ".codebuddy/skills/theme-guard/SKILL.md",
  ".codebuddy/agents/test-agent.md",
  ".codebuddy/rules/user-role.mdc",
  "AGENTS.md",
  "QUICKSTART-DEV.md",
  "QUICKSTART-DESIGNER.md",
  "tools/prototype-kit/HOST-ADAPTER.md",
  "docs/GUIDE-FOR-PM.md",
  "docs/prototype-workflow.md",
  "docs/release-workflow.md",
];

const PROTOTYPE_FLOW_TRUTH_SOURCE_FILES = [
  "AGENTS.md",
  "docs/release-workflow.md",
  "docs/prototype-workflow.md",
  "docs/GUIDE-FOR-PM.md",
  "QUICKSTART-DESIGNER.md",
];

const PROTOTYPE_PUBLICATION_TEXT_FILES = [
  ".codebuddy/skills/prototype-deploy/SKILL.md",
  "tools/prototype-kit/HOST-ADAPTER.md",
  "AGENTS.md",
  "docs/release-workflow.md",
  "docs/prototype-workflow.md",
  "docs/GUIDE-FOR-PM.md",
  "QUICKSTART-DEV.md",
  "QUICKSTART-DESIGNER.md",
];

const RETIRED_ANONYMOUS_START_PATTERNS = [
  {
    category: "anonymous Issue before reservation or worktree",
    pattern:
      /(?:匿名(?:开始|start)|(?:没有|无|未提供|不提供|没给)[^。；|\n]{0,20}Issue|开始一个[^。；|\n]{0,40}原型)(?:(?!reservation|容量检查)[^。；|\n]){0,180}(?:创建|新建)[^。；|\n]{0,24}Issue[^。；|\n]{0,100}(?:再|之后|随后)[^。；|\n]{0,80}(?:reservation|容量检查|worktree)/u,
  },
  {
    category: "merged existing and anonymous Issue-first paths",
    pattern:
      /(?:复用|校验)[\s\S]{0,40}Issue[\s\S]{0,20}(?:或|否则)(?:(?!reservation|容量检查)[\s\S]){0,60}(?:创建|新建)[^。；|\n]{0,24}Issue[\s\S]{0,100}worktree/u,
  },
  {
    category: "AI Issue before reservation or worktree",
    pattern:
      /AI\s*(?:会|将)?\s*先[^。；|\n]{0,30}(?:创建|新建)[^。；|\n]{0,20}Issue[^。；|\n]{0,60}(?:再|之后|随后)[^。；|\n]{0,40}(?:reservation|容量检查|worktree|切(?:分支)?)/u,
  },
];

function normalizedWorkflowText(source) {
  return source
    .normalize("NFKC")
    .replace(/[`*_]/gu, "")
    .replace(/[ \t]+/gu, " ");
}

test("prototype workflow truth sources are fatal-valid UTF-8 without replacement characters", async () => {
  for (const relativePath of WORKFLOW_TEXT_FILES) {
    const bytes = await readFile(path.join(REPO_ROOT, relativePath));
    const source = UTF8_DECODER.decode(bytes);
    assert.equal(source.includes("\uFFFD"), false, relativePath);
  }
});

test("prototype anonymous-start truth sources contain no retired Issue-first wording", async () => {
  for (const relativePath of PROTOTYPE_FLOW_TRUTH_SOURCE_FILES) {
    const source = normalizedWorkflowText(
      await readFile(path.join(REPO_ROOT, relativePath), "utf8"),
    );
    for (const { category, pattern } of RETIRED_ANONYMOUS_START_PATTERNS) {
      const match = pattern.exec(source);
      assert.equal(
        match,
        null,
        `${relativePath}: retired anonymous-start wording (${category}): ${match?.[0]}`,
      );
    }
  }
});

test("prototype workflow truth sources contain no retired share-commit or bare-home contract", async () => {
  const retiredPhrases = [
    "它先提交并 push prototype",
    "prototype-deploy` 完成 commit/build/package/push checkpoint",
    "核验 `#/space/home`、相对资产",
    "自动生成已提交、打包、推送的 checkpoint",
    "| 任意        | 分享 / 提交 prototype",
    "AI 会串起：提交 → 打 ZIP",
    "workbuddy.link/p/<pageId>/#/space/home",
  ];

  for (const relativePath of WORKFLOW_TEXT_FILES) {
    const source = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
    for (const phrase of retiredPhrases) {
      assert.equal(
        source.includes(phrase),
        false,
        `${relativePath}: ${phrase}`,
      );
    }
  }
});

test("prototype publication truth sources contain no retired host-CAS contract", async () => {
  const retiredPatterns = [
    /publicationAttemptId/u,
    /generation\/fence CAS/u,
    /pending revision/u,
    /latestReceipt \+ pendingAttempt\?/u,
    /\bpublish_html\.py\b/u,
  ];

  for (const relativePath of PROTOTYPE_PUBLICATION_TEXT_FILES) {
    const source = await readFile(path.join(REPO_ROOT, relativePath), "utf8");
    for (const pattern of retiredPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relativePath}: retired publication contract ${pattern}`,
      );
    }
  }
});
