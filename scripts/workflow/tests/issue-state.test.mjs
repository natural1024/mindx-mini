import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalizeIssueAcceptanceCriteria } from "../issue-contract.mjs";

const ISSUE_BODY = `# Memory card

## 验收标准

- [ ] AC-1: Memory card renders from Record data
`;
const AC_DIGEST = canonicalizeIssueAcceptanceCriteria(ISSUE_BODY).digest;

function productionDescription(issueIid = 418, targetLabel = "待发布") {
  return `Refs #${issueIid}\nAC-contract: ${AC_DIGEST}\nTarget-label: ${targetLabel}`;
}

const INFRASTRUCTURE_DESCRIPTION = "AC-contract: none\nTarget-label: none";

function issueWith(labels, state = "open") {
  return { state, labels, description: ISSUE_BODY };
}

const issueStateModuleUrl = new URL("../issue-state.mjs", import.meta.url);
const checkMrModuleUrl = new URL(
  "../check-mr-sync-status.mjs",
  import.meta.url,
);
const mergeModuleUrl = new URL(
  "../sync-issues-on-branch-merge.mjs",
  import.meta.url,
);
const trustedIssueCheckModuleUrl = new URL(
  "../check-pr-issue-contract.mjs",
  import.meta.url,
);

async function loadRequiredModule(url, message) {
  try {
    return await import(url.href);
  } catch (error) {
    assert.fail(`${message}: ${error.message}`);
  }
}

function silentLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

test("issue state labels have one canonical five-state order", async () => {
  const { ISSUE_STATE_LABELS } = await loadRequiredModule(
    issueStateModuleUrl,
    "issue-state.mjs must exist",
  );

  assert.deepEqual(ISSUE_STATE_LABELS, [
    "原型中",
    "待研发",
    "开发中",
    "待发布",
    "已发布",
  ]);
  assert.equal(Object.isFrozen(ISSUE_STATE_LABELS), true);
  assert.equal(new Set(ISSUE_STATE_LABELS).size, ISSUE_STATE_LABELS.length);
});

test("only adjacent forward issue-state transitions are allowed", async () => {
  const { ISSUE_STATE_LABELS, canTransitionIssueState } =
    await loadRequiredModule(issueStateModuleUrl, "issue-state.mjs must exist");

  for (let index = 0; index < ISSUE_STATE_LABELS.length - 1; index += 1) {
    assert.equal(
      canTransitionIssueState(
        ISSUE_STATE_LABELS[index],
        ISSUE_STATE_LABELS[index + 1],
      ),
      true,
    );
  }

  assert.equal(canTransitionIssueState("原型中", "开发中"), false);
  assert.equal(canTransitionIssueState("待研发", "原型中"), false);
  assert.equal(canTransitionIssueState("开发中", "开发中"), false);
  assert.equal(canTransitionIssueState("待二次加工", "待发布"), false);
});

test("untrusted PR update validates env syntax without API access", async () => {
  const source = readFileSync(checkMrModuleUrl, "utf8");
  assert.match(source, /export async function runCheckMrSyncStatus/);
  assert.doesNotMatch(source, /platform-client|getPR\(|getIssue\(/);

  const { runCheckMrSyncStatus } = await import(checkMrModuleUrl.href);

  const result = await runCheckMrSyncStatus({
    env: {
      CNB_PULL_REQUEST_IID: "17",
      CNB_PULL_REQUEST_DESCRIPTION: productionDescription(),
      CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
    },
    logger: silentLogger(),
  });

  assert.equal(result.targetLabel, "待发布");
  assert.equal(result.issueIid, 418);
});

test("Target-label 待发布 requires exactly one Refs issue contract (soft)", async () => {
  // 2026-07-17 起，PR body 层的 Refs 数量偏差改为软失败，只 warning、不阻塞。
  // 硬失败在 check-pr-issue-contract.mjs（trusted target）阶段兜底。
  const { runCheckMrSyncStatus } = await import(checkMrModuleUrl.href);

  for (const description of [
    `AC-contract: ${AC_DIGEST}\nTarget-label: 待发布`,
    `Refs #1\nRefs #2\nAC-contract: ${AC_DIGEST}\nTarget-label: 待发布`,
  ]) {
    const result = await runCheckMrSyncStatus({
      env: {
        CNB_PULL_REQUEST_IID: "19",
        CNB_PULL_REQUEST_DESCRIPTION: description,
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
      },
      logger: silentLogger(),
    });
    assert.equal(result.status, "validated-with-warnings");
    assert.ok(result.softErrors.some((msg) => /Refs/u.test(msg)));
  }

  const noneResult = await runCheckMrSyncStatus({
    env: {
      CNB_PULL_REQUEST_IID: "20",
      CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
      CNB_PULL_REQUEST_BRANCH: "docs/update-workflow",
    },
    logger: silentLogger(),
  });
  assert.equal(noneResult.targetLabel, "none");
});

test("infrastructure PR validation does not depend on commit subjects", async () => {
  const { runCheckMrSyncStatus } = await import(checkMrModuleUrl.href);

  const result = await runCheckMrSyncStatus({
    env: {
      CNB_PULL_REQUEST_IID: "21",
      CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
      CNB_PULL_REQUEST_BRANCH: "build/prototype-workflow",
      BASE_REF: "a".repeat(40),
      HEAD_REF: "b".repeat(40),
    },
    logger: silentLogger(),
  });

  assert.equal(result.route, "infrastructure");
  assert.equal(result.targetLabel, "none");
});

test("PR descriptions only accept the two route-level Target-label values", async () => {
  // 2026-07-17 起：
  // - `已发布` 仍然是 hard error（只能由 changelog 写入）
  // - 其它非法 Target-label 值降级为软失败（warning + exit 0）
  const source = readFileSync(checkMrModuleUrl, "utf8");
  assert.match(source, /export async function runCheckMrSyncStatus/);

  const { runCheckMrSyncStatus } = await import(checkMrModuleUrl.href);

  await assert.rejects(
    runCheckMrSyncStatus({
      env: {
        CNB_PULL_REQUEST_IID: "18",
        CNB_PULL_REQUEST_DESCRIPTION: `AC-contract: ${AC_DIGEST}\nTarget-label: 已发布`,
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
      },
      logger: silentLogger(),
    }),
    /hard errors/u,
  );

  for (const softInvalid of ["原型中", "待研发", "开发中", "待二次加工"]) {
    const result = await runCheckMrSyncStatus({
      env: {
        CNB_PULL_REQUEST_IID: "18",
        CNB_PULL_REQUEST_DESCRIPTION: `AC-contract: ${AC_DIGEST}\nTarget-label: ${softInvalid}`,
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
      },
      logger: silentLogger(),
    });
    assert.equal(result.status, "validated-with-warnings");
    assert.ok(
      result.softErrors.some((msg) => /Target-label/u.test(msg)),
      `expected Target-label warning for ${softInvalid}`,
    );
  }
});

test("source branch and Target-label mapping (soft warnings only)", async () => {
  // 2026-07-17 起：分支 vs Target-label 不匹配统一降级为软失败。
  // 硬失败仅在 pull_request.mergeable 的 check-pr-issue-contract.mjs 由 Issue 契约兜底。
  const { runCheckMrSyncStatus } = await import(checkMrModuleUrl.href);

  const scenarios = [
    {
      description: INFRASTRUCTURE_DESCRIPTION,
      branch: "feature/418-memory-card",
      pattern: /待发布|feature|production/u,
    },
    {
      description: productionDescription(),
      branch: "docs/update-workflow",
      pattern: /none|工程|infrastructure/u,
    },
    {
      description: INFRASTRUCTURE_DESCRIPTION,
      branch: "hotfix/20260711-mindx",
      pattern: /source branch|分支|feature/u,
    },
  ];
  for (const s of scenarios) {
    const result = await runCheckMrSyncStatus({
      env: {
        CNB_PULL_REQUEST_IID: "25",
        CNB_PULL_REQUEST_DESCRIPTION: s.description,
        CNB_PULL_REQUEST_BRANCH: s.branch,
      },
      logger: silentLogger(),
    });
    assert.equal(result.status, "validated-with-warnings");
    assert.ok(
      result.softErrors.some((msg) => s.pattern.test(msg)),
      `expected soft warning for ${s.branch} + ${s.description}`,
    );
  }
});

test("trusted PR check requires an open Issue with AC digest match and never mutates it", async () => {
  // 2026-07-17 起：Issue 状态放宽为「待研发/开发中/待发布」都通过；仅关闭 / 已发布 /
  // 原型中或多个状态 label 才 hard fail。AC digest 不匹配、Issue 关闭仍是硬拒。
  const { runPrIssueContractCheck } = await loadRequiredModule(
    trustedIssueCheckModuleUrl,
    "check-pr-issue-contract.mjs must exist",
  );
  const calls = [];
  const client = {
    repo: "x-team/mindx",
    async getIssue(issueIid) {
      calls.push(["getIssue", issueIid]);
      return issueWith(["P1", "开发中"]);
    },
    async putIssueLabels() {
      calls.push(["putIssueLabels"]);
      throw new Error("trusted validation must stay read-only");
    },
  };

  const result = await runPrIssueContractCheck({
    client,
    env: {
      CNB_PULL_REQUEST_IID: "21",
      CNB_PULL_REQUEST_DESCRIPTION: productionDescription(),
      CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
    },
    logger: silentLogger(),
  });

  assert.equal(result.status, "validated-issue");
  assert.equal(result.acContractDigest, AC_DIGEST);
  assert.deepEqual(calls, [["getIssue", 418]]);

  // AC digest 变化仍是 hard fail
  await assert.rejects(
    runPrIssueContractCheck({
      client: {
        repo: "x-team/mindx",
        async getIssue() {
          return issueWith(["开发中"], "open");
        },
      },
      env: {
        CNB_PULL_REQUEST_IID: "21",
        CNB_PULL_REQUEST_DESCRIPTION: productionDescription().replace(
          AC_DIGEST,
          `sha256:${"0".repeat(64)}`,
        ),
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
      },
      logger: silentLogger(),
    }),
    /digest/u,
  );

  // 关闭 / 多状态 label 仍是 hard fail
  for (const issue of [
    issueWith(["开发中"], "closed"),
    issueWith(["开发中", "待发布"]),
  ]) {
    await assert.rejects(
      runPrIssueContractCheck({
        client: {
          repo: "x-team/mindx",
          async getIssue() {
            return issue;
          },
        },
        env: {
          CNB_PULL_REQUEST_IID: "22",
          CNB_PULL_REQUEST_DESCRIPTION: productionDescription(),
          CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
        },
        logger: silentLogger(),
      }),
      /Issue|issue|状态|closed/u,
    );
  }

  // 「待研发」现在是允许通过的（AC-7）
  const relaxedResult = await runPrIssueContractCheck({
    client: {
      repo: "x-team/mindx",
      async getIssue() {
        return issueWith(["待研发"]);
      },
    },
    env: {
      CNB_PULL_REQUEST_IID: "23",
      CNB_PULL_REQUEST_DESCRIPTION: productionDescription(),
      CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
    },
    logger: silentLogger(),
  });
  assert.equal(relaxedResult.status, "validated-issue");
});

test("trusted PR check treats branch/Refs mismatch as a soft warning", async () => {
  // 2026-07-17 起，PR body 层的分支 vs Refs 不匹配统一软失败；本 stage 只有
  // Issue 不存在 / 关闭 / AC digest 不匹配 / source 是 prototype 才 hard fail。
  const { runPrIssueContractCheck } = await import(
    trustedIssueCheckModuleUrl.href
  );

  // feature/419 vs Refs #418：现在会通过（走到 Issue #418 拿真实契约）
  const result = await runPrIssueContractCheck({
    client: {
      repo: "x-team/mindx",
      async getIssue(issueIid) {
        assert.equal(issueIid, 418);
        return issueWith(["开发中"]);
      },
    },
    env: {
      CNB_PULL_REQUEST_IID: "24",
      CNB_PULL_REQUEST_DESCRIPTION: productionDescription(),
      CNB_PULL_REQUEST_BRANCH: "feature/419-memory-card",
    },
    logger: silentLogger(),
  });
  // 分支 issueId(419) ≠ Refs(418) → soft warning
  assert.ok(
    result.softErrors.some((msg) => /Issue|分支|branch/u.test(msg)),
    "branch/Refs mismatch must surface as a soft error",
  );
});

test("trusted PR check enforces infrastructure diff whitelist; branch/Target-label mismatch is soft", async () => {
  const { runPrIssueContractCheck } = await import(
    trustedIssueCheckModuleUrl.href
  );
  const client = {
    repo: "x-team/mindx",
    async getIssue() {
      throw new Error("infrastructure contract must not call the Issue API");
    },
  };

  const infrastructure = await runPrIssueContractCheck({
    client,
    changedPaths: ["scripts/workflow/check-pr-issue-contract.mjs"],
    env: {
      CNB_PULL_REQUEST_IID: "28",
      CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
      CNB_PULL_REQUEST_BRANCH: "ci/harden-workflow",
    },
    logger: silentLogger(),
  });
  assert.equal(infrastructure.status, "validated-none");

  const packageInfrastructure = await runPrIssueContractCheck({
    client,
    changedPaths: [
      "packages/ui-components/README.md",
      "packages/ui-elements/README.md",
      "packages/ui-components/.business-frozen.json",
      "apps/mindx/src/pages/drive-page/hooks/use-audio-parse.test.ts",
    ],
    env: {
      CNB_PULL_REQUEST_IID: "280",
      CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
      CNB_PULL_REQUEST_BRANCH: "ci/document-package-governance",
    },
    logger: silentLogger(),
  });
  assert.equal(packageInfrastructure.status, "validated-none");

  // diff 触及 apps/mindx 但走 infrastructure route → 依旧硬拒（AC-5 保留）
  await assert.rejects(
    runPrIssueContractCheck({
      client,
      changedPaths: ["apps/mindx/src/pages/hidden-feature.tsx"],
      env: {
        CNB_PULL_REQUEST_IID: "281",
        CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
        CNB_PULL_REQUEST_BRANCH: "ci/harden-workflow",
      },
      logger: silentLogger(),
    }),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*apps\/mindx/u,
  );

  await assert.rejects(
    runPrIssueContractCheck({
      client,
      changedPaths: [
        "packages/ui-components/README.md",
        "packages/ui-components/src/button.tsx",
      ],
      env: {
        CNB_PULL_REQUEST_IID: "282",
        CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
        CNB_PULL_REQUEST_BRANCH: "ci/document-package-governance",
      },
      logger: silentLogger(),
    }),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*packages\/ui-components\/src\/button\.tsx/u,
  );

  // bugfix 分支 + Target-label none：body 契约软失败，但 stage 不 throw
  const result = await runPrIssueContractCheck({
    client: {
      repo: "x-team/mindx",
      async getIssue() {
        // route 归到 production，仍会尝试拉 Issue —— 但 Refs 是 #418
        return issueWith(["开发中"]);
      },
    },
    env: {
      CNB_PULL_REQUEST_IID: "29",
      CNB_PULL_REQUEST_DESCRIPTION: INFRASTRUCTURE_DESCRIPTION,
      CNB_PULL_REQUEST_BRANCH: "bugfix/418-memory-card",
    },
    logger: silentLogger(),
  });
  assert.ok(
    result.softErrors.some((msg) =>
      /待发布|production|Target-label/u.test(msg),
    ),
    "expected soft warning about branch/Target-label mismatch",
  );
});

test("a production feature merge advances 开发中 to 待发布", async () => {
  const source = readFileSync(mergeModuleUrl, "utf8");
  assert.match(source, /export async function runMergedIssueSync/);
  assert.doesNotMatch(
    source,
    /client\.putIssueLabels\(/,
    "post-merge state changes must never use an unconditional label write",
  );
  assert.match(
    source,
    /sync-issues-on-branch-merge crashed[\s\S]*process\.exitCode = 1/,
    "an unexpected post-merge crash must fail the pipeline visibly",
  );

  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const operations = [];
  let issueReadCount = 0;
  const client = {
    repo: "x-team/mindx",
    async getPR() {
      return {
        title: "🟢 feat: memory card #418",
        description: productionDescription(),
      };
    },
    async getIssueVersioned(issueIid) {
      assert.equal(issueIid, 418);
      issueReadCount += 1;
      const snapshot =
        issueReadCount === 1
          ? { issue: issueWith(["开发中", "P1"]), version: '"issue-v1"' }
          : { issue: issueWith(["待发布", "P1"]), version: '"issue-v2"' };
      operations.push(["read", snapshot.version]);
      return snapshot;
    },
    async putIssueLabelsIfMatch(issueIid, labels, version) {
      operations.push(["write", issueIid, labels, version]);
    },
    async getIssueNotes() {
      operations.push(["read-notes"]);
      return [];
    },
    async createIssueNote() {
      operations.push(["create-note"]);
    },
  };

  const result = await runMergedIssueSync({
    client,
    env: {
      CNB_PULL_REQUEST_IID: "17",
      CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
      CNB_BRANCH: "main",
    },
    logger: silentLogger(),
  });

  assert.equal(result.status, "advanced");
  assert.deepEqual(operations, [
    ["read", '"issue-v1"'],
    ["write", 418, ["P1", "待发布"], '"issue-v1"'],
    ["read", '"issue-v2"'],
    ["read-notes"],
    ["create-note"],
  ]);
});

test("merged sync fails closed on label CAS conflicts before writing merge evidence", async () => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const operations = [];
  const client = {
    repo: "x-team/mindx",
    async getPR() {
      return { description: productionDescription() };
    },
    async getIssueVersioned() {
      operations.push("read-issue");
      return {
        issue: issueWith(["开发中", "P1"]),
        version: '"issue-v1"',
      };
    },
    async putIssueLabelsIfMatch() {
      operations.push("cas-write");
      throw new Error("label CAS precondition failed with status 412");
    },
    async getIssueNotes() {
      operations.push("read-notes");
      return [];
    },
    async createIssueNote() {
      operations.push("create-note");
    },
  };

  await assert.rejects(
    runMergedIssueSync({
      client,
      env: {
        CNB_PULL_REQUEST_IID: "171",
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
        CNB_BRANCH: "main",
      },
      logger: silentLogger(),
    }),
    /CAS|precondition|412/u,
  );
  assert.deepEqual(operations, ["read-issue", "cas-write"]);
});

test("merged sync re-verifies AC, target state, and non-state labels before merge evidence", async (t) => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const changedBody = `${ISSUE_BODY}\n- [ ] AC-2: Changed after the merge\n`;
  const cases = [
    {
      name: "AC drift",
      finalIssue: { ...issueWith(["待发布", "P1"]), description: changedBody },
      expected: /AC digest changed|digest/u,
    },
    {
      name: "state drift",
      finalIssue: issueWith(["开发中", "P1"]),
      expected: /待发布|state|状态/u,
    },
    {
      name: "non-state label drift",
      finalIssue: issueWith(["待发布", "P2"]),
      expected: /non-state|非状态|label/u,
    },
    {
      name: "lifecycle drift",
      finalIssue: issueWith(["待发布", "P1"], "closed"),
      expected: /open|closed|lifecycle/u,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const operations = [];
      let issueReadCount = 0;
      const client = {
        repo: "x-team/mindx",
        async getPR() {
          return { description: productionDescription() };
        },
        async getIssueVersioned() {
          issueReadCount += 1;
          operations.push(`read-issue-${issueReadCount}`);
          return {
            issue:
              issueReadCount === 1
                ? issueWith(["开发中", "P1"])
                : scenario.finalIssue,
            version: `"issue-v${issueReadCount}"`,
          };
        },
        async putIssueLabelsIfMatch() {
          operations.push("cas-write");
        },
        async getIssueNotes() {
          operations.push("read-notes");
          return [];
        },
        async createIssueNote() {
          operations.push("create-note");
        },
      };

      await assert.rejects(
        runMergedIssueSync({
          client,
          env: {
            CNB_PULL_REQUEST_IID: "172",
            CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
            CNB_BRANCH: "main",
          },
          logger: silentLogger(),
        }),
        scenario.expected,
      );
      assert.deepEqual(operations, [
        "read-issue-1",
        "cas-write",
        "read-issue-2",
      ]);
    });
  }
});

test("merged sync fails closed on malformed contracts and duplicate Refs", async () => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);

  for (const description of [
    `Refs #418\nAC-contract: ${AC_DIGEST}\nTarget-label: 待二次加工`,
    `Refs #418\nRefs #419\nAC-contract: ${AC_DIGEST}\nTarget-label: 待发布`,
    "Refs #418",
    `Refs #418\nAC-contract: ${AC_DIGEST}\nTarget-label: 待发布\nTarget-label: none`,
  ]) {
    const writes = [];
    await assert.rejects(
      runMergedIssueSync({
        client: {
          repo: "x-team/mindx",
          async getPR() {
            return { description };
          },
          async getIssue() {
            throw new Error("invalid contract must not reach Issue API");
          },
          async putIssueLabels(...args) {
            writes.push(args);
          },
        },
        env: {
          CNB_PULL_REQUEST_IID: "23",
          CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
          CNB_BRANCH: "main",
        },
        logger: silentLogger(),
      }),
      /Target-label|Refs|contract|契约/u,
    );

    assert.deepEqual(writes, []);
  }
});

test("merged sync rejects non-production or mismatched Issue branches", async () => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);

  for (const sourceBranch of [
    "feature/419-memory-card",
    "hotfix/418-memory-card",
    "chore/418-memory-card",
  ]) {
    await assert.rejects(
      runMergedIssueSync({
        client: {
          repo: "x-team/mindx",
          async getPR() {
            return {
              source_branch: sourceBranch,
              target_branch: "main",
              description: productionDescription(),
            };
          },
          async getIssue() {
            throw new Error("invalid source branch must fail before Issue API");
          },
        },
        env: {
          CNB_PULL_REQUEST_IID: "25",
          CNB_BRANCH: "main",
        },
        logger: silentLogger(),
      }),
      /source branch|branch|分支|Issue/u,
    );
  }
});

test("prototype merges never enter the issue merge state machine", async () => {
  const source = readFileSync(mergeModuleUrl, "utf8");
  assert.match(source, /export async function runMergedIssueSync/);

  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const calls = [];
  const client = {
    repo: "x-team/mindx",
    async getPR() {
      calls.push("getPR");
      throw new Error("prototype merge must be rejected before PR lookup");
    },
    async getIssue() {
      calls.push("getIssue");
    },
    async putIssueLabels() {
      calls.push("putIssueLabels");
    },
  };

  await assert.rejects(
    runMergedIssueSync({
      client,
      env: {
        CNB_PULL_REQUEST_IID: "19",
        CNB_PULL_REQUEST_BRANCH: "prototype/418-memory-card",
        CNB_BRANCH: "main",
      },
      logger: silentLogger(),
    }),
    /prototype/u,
  );
  assert.deepEqual(calls, []);
});

test("non-main merges do not advance issue state", async () => {
  const source = readFileSync(mergeModuleUrl, "utf8");
  assert.match(source, /export async function runMergedIssueSync/);

  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const calls = [];
  const client = {
    repo: "x-team/mindx",
    async getPR() {
      calls.push("getPR");
      throw new Error("non-main merge must be skipped before PR lookup");
    },
  };

  await assert.rejects(
    runMergedIssueSync({
      client,
      env: {
        CNB_PULL_REQUEST_IID: "20",
        CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
        CNB_BRANCH: "release/2026-07-11",
      },
      logger: silentLogger(),
    }),
    /main|target/u,
  );
  assert.deepEqual(calls, []);
});

test("merged sync only skips a valid infrastructure Target-label none contract", async () => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);
  const calls = [];
  const result = await runMergedIssueSync({
    changedPaths: ["docs/release-workflow.md"],
    client: {
      repo: "x-team/mindx",
      async getPR() {
        calls.push("getPR");
        return {
          source_branch: "docs/update-workflow",
          target_branch: "main",
          description: INFRASTRUCTURE_DESCRIPTION,
        };
      },
      async getIssue() {
        calls.push("getIssue");
        throw new Error("infrastructure merge must not read an Issue");
      },
    },
    env: {
      CNB_PULL_REQUEST_IID: "30",
      CNB_BRANCH: "main",
    },
    logger: silentLogger(),
  });

  assert.equal(result.status, "skipped-infrastructure");
  assert.deepEqual(calls, ["getPR"]);

  calls.length = 0;
  const packageInfrastructureResult = await runMergedIssueSync({
    changedPaths: [
      "packages/ui-components/README.md",
      "packages/ui-elements/README.md",
      "packages/ui-components/.business-frozen.json",
      "packages/ui-components/src/button.spec.tsx",
    ],
    client: {
      repo: "x-team/mindx",
      async getPR() {
        calls.push("getPR");
        return {
          source_branch: "ci/document-package-governance",
          target_branch: "main",
          description: INFRASTRUCTURE_DESCRIPTION,
        };
      },
      async getIssue() {
        calls.push("getIssue");
        throw new Error("infrastructure merge must not read an Issue");
      },
    },
    env: {
      CNB_PULL_REQUEST_IID: "300",
      CNB_BRANCH: "main",
    },
    logger: silentLogger(),
  });
  assert.equal(packageInfrastructureResult.status, "skipped-infrastructure");
  assert.deepEqual(calls, ["getPR"]);

  await assert.rejects(
    runMergedIssueSync({
      changedPaths: ["apps/mindx/src/pages/hidden-feature.tsx"],
      client: {
        repo: "x-team/mindx",
        async getPR() {
          return {
            source_branch: "ci/ship-business-feature",
            target_branch: "main",
            description: INFRASTRUCTURE_DESCRIPTION,
          };
        },
      },
      env: {
        CNB_PULL_REQUEST_IID: "301",
        CNB_BRANCH: "main",
      },
      logger: silentLogger(),
    }),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*apps\/mindx/u,
  );

  await assert.rejects(
    runMergedIssueSync({
      changedPaths: [
        "packages/ui-components/README.md",
        "packages/ui-components/src/button.tsx",
      ],
      client: {
        repo: "x-team/mindx",
        async getPR() {
          return {
            source_branch: "ci/ship-business-feature",
            target_branch: "main",
            description: INFRASTRUCTURE_DESCRIPTION,
          };
        },
      },
      env: {
        CNB_PULL_REQUEST_IID: "302",
        CNB_BRANCH: "main",
      },
      logger: silentLogger(),
    }),
    /INFRASTRUCTURE_DIFF_FORBIDDEN[\s\S]*packages\/ui-components\/src\/button\.tsx/u,
  );
});

test("merged sync surfaces missing metadata, Issue reads, and invalid Issue state", async () => {
  const { runMergedIssueSync } = await import(mergeModuleUrl.href);

  await assert.rejects(
    runMergedIssueSync({ env: { CNB_BRANCH: "main" }, logger: silentLogger() }),
    /CNB_PULL_REQUEST_IID/u,
  );

  const baseEnv = {
    CNB_PULL_REQUEST_IID: "31",
    CNB_PULL_REQUEST_BRANCH: "feature/418-memory-card",
    CNB_BRANCH: "main",
  };
  const baseClient = {
    repo: "x-team/mindx",
    async getPR() {
      return { description: productionDescription() };
    },
  };

  await assert.rejects(
    runMergedIssueSync({
      client: {
        ...baseClient,
        async getIssueVersioned() {
          throw new Error("CNB unavailable");
        },
      },
      env: baseEnv,
      logger: silentLogger(),
    }),
    /CNB unavailable|Issue/u,
  );

  for (const issue of [
    issueWith(["开发中"], "closed"),
    issueWith(["待研发"]),
    issueWith(["开发中", "待发布"]),
  ]) {
    await assert.rejects(
      runMergedIssueSync({
        client: {
          ...baseClient,
          async getIssueVersioned() {
            return { issue, version: '"issue-v1"' };
          },
        },
        env: baseEnv,
        logger: silentLogger(),
      }),
      /Issue|状态|开发中|closed/u,
    );
  }
});
