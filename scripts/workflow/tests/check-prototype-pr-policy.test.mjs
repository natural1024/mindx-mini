import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const policyModuleUrl = new URL(
  "../check-prototype-pr-policy.mjs",
  import.meta.url,
);
const cnbConfigUrl = new URL("../../../.cnb.yml", import.meta.url);
const mindxPrReviewSkillUrl = new URL(
  "../../../.codebuddy/skills/mindx-pr-review/SKILL.md",
  import.meta.url,
);
const mindxPrReviewCollectorUrl = new URL(
  "../../../.codebuddy/skills/mindx-pr-review/scripts/collect-pr-context.py",
  import.meta.url,
);

async function loadPolicyModule() {
  try {
    return await import(policyModuleUrl.href);
  } catch (error) {
    assert.fail(
      `check-prototype-pr-policy.mjs must expose an injectable policy API: ${error.message}`,
    );
  }
}

function runGit(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function installFakeCnb(root) {
  const binDir = join(root, "fake-bin");
  const fixturePath = join(root, "cnb-fixture.json");
  const logPath = join(root, "cnb-commands.jsonl");
  mkdirSync(binDir, { recursive: true });
  const executable = join(binDir, "cnb");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CNB_LOG, JSON.stringify(args) + "\\n");
const fixture = JSON.parse(readFileSync(process.env.FAKE_CNB_FIXTURE, "utf8"));
const key = args[0] + " " + args[1];
if (!Object.prototype.hasOwnProperty.call(fixture.responses, key)) {
  process.stderr.write("unexpected fake cnb command: " + key + "\\n");
  process.exit(2);
}
process.stdout.write(JSON.stringify({ data: fixture.responses[key] }));
`,
  );
  chmodSync(executable, 0o755);
  writeFileSync(logPath, "");
  return { binDir, fixturePath, logPath };
}

function writeFakeCnbFixture(fixturePath, responses) {
  writeFileSync(fixturePath, JSON.stringify({ responses }, null, 2));
}

function readFakeCnbCommands(logPath) {
  const content = readFileSync(logPath, "utf8").trim();
  return content ? content.split("\n").map((line) => JSON.parse(line)) : [];
}

function runReviewHelper(command, args, { cwd, env }) {
  return spawnSync(
    "python3",
    [fileURLToPath(mindxPrReviewCollectorUrl), command, ...args],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );
}

test("prototype/<issue>-<slug> PRs are rejected for every target branch", async () => {
  const { evaluatePrototypePrPolicy } = await loadPolicyModule();

  for (const targetBranch of ["main", "release/2026-07-11"]) {
    const decision = evaluatePrototypePrPolicy({
      sourceBranch: "prototype/418-memory-card",
      targetBranch,
    });

    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /prototype/i);
  }
});

test("normal feature PRs to main are allowed", async () => {
  const { evaluatePrototypePrPolicy } = await loadPolicyModule();

  assert.deepEqual(
    evaluatePrototypePrPolicy({
      sourceBranch: "feature/418-memory-card",
      targetBranch: "main",
    }),
    {
      allowed: true,
      sourceBranch: "feature/418-memory-card",
      targetBranch: "main",
      reason: "production PR allowed",
    },
  );
});

test("repository PR policy only permits main as a target", async () => {
  const { evaluatePrototypePrPolicy } = await loadPolicyModule();

  for (const targetBranch of [
    "feature/page-edit",
    "bugfix/418-memory-card",
    "release/2026-07-11",
  ]) {
    const decision = evaluatePrototypePrPolicy({
      sourceBranch: "feature/418-memory-card",
      targetBranch,
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /main|target/i);
  }
});

test("renaming a prototype branch cannot erase prototype lineage", async () => {
  const { evaluatePrototypePrPolicy, detectPrototypeLineage } =
    await loadPolicyModule();
  const decision = evaluatePrototypePrPolicy({
    sourceBranch: "feature/418-memory-card",
    targetBranch: "main",
    prototypeLineageDetected: true,
  });

  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /lineage|prototype/i);

  const source = readFileSync(policyModuleUrl, "utf8");
  assert.match(source, /detectPrototypeLineage/);
  assert.match(source, /prototype\.config\.json/);
  assert.match(source, /apps\/mindx\/src\/prototype\//);

  const calls = [];
  const lineageDetected = detectPrototypeLineage({
    headRef: "b".repeat(40),
    targetRef: "a".repeat(40),
    git(args) {
      calls.push(args);
      if (args[0] === "merge-base") return "c".repeat(40);
      if (args[0] === "log") return "prototype.config.json\n";
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    },
  });
  assert.equal(lineageDetected, true);
  // 优化后：只扫 diff 区间，不再对 head 全量 ls-tree 扫描
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["merge-base", "log"],
  );
});

test("prototype lineage only trips when diff introduces prototype markers", async () => {
  const { detectPrototypeLineage } = await loadPolicyModule();

  // diff 区间没有 prototype 标志文件 → 不认为是 prototype lineage
  const lineageDetected = detectPrototypeLineage({
    headRef: "b".repeat(40),
    targetRef: "a".repeat(40),
    git(args) {
      if (args[0] === "merge-base") return "c".repeat(40);
      if (args[0] === "log") return "apps/mindx/src/pages/home.tsx\n";
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    },
  });
  assert.equal(lineageDetected, false);
});

test("prototype runtime scaffold in diff preserves prototype lineage", async () => {
  const { detectPrototypeLineage } = await loadPolicyModule();

  for (const marker of [
    "prototype.config.json",
    "apps/mindx/rspack.prototype.config.mjs",
    "apps/mindx/src/prototype/entry.tsx",
  ]) {
    const lineageDetected = detectPrototypeLineage({
      headRef: "b".repeat(40),
      targetRef: "a".repeat(40),
      git(args) {
        if (args[0] === "merge-base") return "c".repeat(40);
        if (args[0] === "log") return `${marker}\n`;
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      },
    });
    assert.equal(lineageDetected, true, `marker ${marker} must trip lineage`);
  }
});

test("main pull_request.target runs prototype guard exactly once", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const mainStart = config.indexOf("\nmain:\n");
  assert.ok(mainStart >= 0, "cnb config must contain a `main:` top-level key");
  const nextTopLevel = config.slice(mainStart + 1).search(/\n[^\s#]/);
  const mainBlock = config.slice(
    mainStart,
    nextTopLevel >= 0 ? mainStart + 1 + nextTopLevel : config.length,
  );

  const targetStart = mainBlock.indexOf("pull_request.target:");
  const updateStart = mainBlock.indexOf("pull_request.update:");
  const targetBlock = mainBlock.slice(targetStart, updateStart);

  const guardHits = targetBlock.match(
    /script: node scripts\/workflow\/check-prototype-pr-policy\.mjs/g,
  );
  assert.equal(
    (guardHits || []).length,
    1,
    "main pull_request.target must run the prototype guard exactly once",
  );

  // 守卫必须是第一个 job（放在通知/reviewer/契约之前）
  const firstJobIndex = targetBlock.indexOf("- name:");
  const guardJobIndex = targetBlock.indexOf("- name: MindX PR prototype guard");
  assert.equal(
    guardJobIndex,
    firstJobIndex,
    "prototype guard must be the first job under main pull_request.target",
  );
});

test("MindX NPC review asynchronously publishes both inline Review and ordinary summary comment", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const skill = readFileSync(mindxPrReviewSkillUrl, "utf8");
  const collectorScript = readFileSync(mindxPrReviewCollectorUrl, "utf8");
  const mainStart = config.indexOf("\nmain:\n");
  assert.ok(mainStart >= 0, "cnb config must contain main");

  const pullRequestStart = config.indexOf("\n  pull_request:\n", mainStart);
  const targetStart = config.indexOf("\n  pull_request.target:\n", mainStart);
  const updateStart = config.indexOf("\n  pull_request.update:\n", mainStart);
  const mergedStart = config.indexOf("\n  pull_request.merged:\n", mainStart);
  const childStart = config.indexOf(
    "\n  api_trigger_mindx_pr_review:\n",
    mergedStart,
  );
  const changelogStart = config.indexOf(
    "\n  api_trigger_changelog:\n",
    childStart,
  );

  assert.ok(
    pullRequestStart >= 0 &&
      targetStart > pullRequestStart &&
      updateStart > targetStart &&
      childStart > mergedStart &&
      changelogStart > childStart,
    "MindX review events must be placed in the expected main sections",
  );

  const genericPullRequestBlock = config.slice(pullRequestStart, targetStart);
  assert.doesNotMatch(
    genericPullRequestBlock,
    /npc:go|MindX NPC PR review/,
    "ordinary pull_request status checks must not wait for the model",
  );

  const targetBlock = config.slice(targetStart, updateStart);
  assert.match(targetBlock, /MindX PR review dispatch/);
  assert.match(targetBlock, /cnb build start-build/);
  assert.match(targetBlock, /event: "api_trigger_mindx_pr_review"/);
  assert.match(targetBlock, /npc: \{name: "CodeBuddy", workMode: false\}/);
  assert.match(targetBlock, /sync: false/);
  assert.doesNotMatch(
    targetBlock,
    /\/mindx-pr-review:data/,
    "the parent dispatch pipeline must not own the child review data volume",
  );
  for (const variable of [
    "MINDX_REVIEW_PR_IID",
    "MINDX_REVIEW_PR_HEAD_SHA",
    "MINDX_REVIEW_PR_TARGET_SHA",
    "MINDX_REVIEW_SOURCE_BRANCH",
    "MINDX_REVIEW_SOURCE_SLUG",
    "MINDX_REVIEW_REPO_SLUG",
  ]) {
    assert.match(targetBlock, new RegExp(`${variable}:`));
  }

  const childBlock = config.slice(childStart, changelogStart);
  assert.match(childBlock, /image: cnbcool\/default-npc:latest/);
  assert.match(childBlock, /volumes:\n\s+- \/mindx-pr-review:data/);
  assert.match(childBlock, /sandbox: false/);
  assert.match(childBlock, /key: mindx-pr-review-\$\{MINDX_REVIEW_PR_IID\}/);
  assert.match(childBlock, /wait: true/);
  assert.match(childBlock, /cancel-in-progress: true/);
  assert.match(childBlock, /cancel-in-wait: true/);
  assert.match(childBlock, /type: npc:go/);
  assert.match(childBlock, /model: gpt-5\.5/);
  assert.match(childBlock, /contextWindow: 256k/);
  assert.match(childBlock, /maxTurns: 40/);
  assert.match(childBlock, /20 轮内耗尽/);

  const collectorStart = childBlock.indexOf(
    "- name: Collect deterministic MindX PR review context",
  );
  const npcStart = childBlock.indexOf("- name: Review and publish current PR");
  const verifierStart = childBlock.indexOf(
    "- name: Verify MindX PR review publication",
  );
  assert.ok(
    collectorStart >= 0 &&
      npcStart > collectorStart &&
      verifierStart > npcStart,
    "deterministic context collection must finish before the NPC starts",
  );
  const collectorBlock = childBlock.slice(collectorStart, npcStart);
  const npcBlock = childBlock.slice(npcStart, verifierStart);

  for (const fixedPath of [
    "/mindx-pr-review/context.json",
    "/mindx-pr-review/changed-paths.txt",
    "/mindx-pr-review/review.diff",
  ]) {
    assert.match(collectorBlock, new RegExp(fixedPath.replaceAll("/", "\\/")));
    assert.match(npcBlock, new RegExp(fixedPath.replaceAll("/", "\\/")));
    assert.match(skill, new RegExp(fixedPath.replaceAll("/", "\\/")));
    assert.match(collectorScript, new RegExp(fixedPath.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(
    childBlock,
    /\/tmp\/mindx-pr-review-(?:context|changed-paths)|\/tmp\/mindx-pr-review\.diff/,
    "cross-task review inputs must use the pipeline data volume, not /tmp",
  );
  assert.match(collectorBlock, /scripts\/collect-pr-context\.py collect/);
  assert.doesNotMatch(
    collectorBlock,
    /from __future__|def run_cnb_json|list-pull-files/,
    "the collector implementation must not be embedded in .cnb.yml",
  );
  assert.match(collectorScript, /issue_follow_up_commits/);
  assert.doesNotMatch(
    collectorScript,
    /git[^\n]*log[^\n]*--all|"--all"/,
    "follow-up evidence must stay bounded to target/head history",
  );

  assert.match(npcBlock, /context\.expected_head_sha 是 40 位 SHA/);
  assert.match(npcBlock, /git show "<已核对的40位head>:<path>"/);
  assert.match(npcBlock, /git grep -n '<symbol>' "<已核对的40位head>"/);
  assert.match(npcBlock, /禁止调用 cnb pulls --help/);
  assert.match(npcBlock, /cnb pulls list-pull-files/);
  assert.match(npcBlock, /get-pr-files/);
  assert.match(npcBlock, /评审阶段也禁止查询 Issue API/);
  assert.match(npcBlock, /只有发布协议允许 get-pull/);
  assert.match(npcBlock, /list-pull-reviews/);
  assert.match(npcBlock, /list-pull-comments/);
  assert.match(npcBlock, /post-pull-review --event comment/);
  assert.match(npcBlock, /post-pull-comment/);
  assert.match(npcBlock, /已有其一只补另一个，已有两者才跳过/);
  assert.match(npcBlock, /两次写之间必须再次 get-pull/);
  assert.match(npcBlock, /同一\s+head_sha meta/);
  assert.match(
    npcBlock,
    /先 post-pull-comment，再校验 head，最后 post-pull-review/,
  );
  assert.match(npcBlock, /已有对象 body 为权威正文，原样补到缺失对象/);
  assert.match(npcBlock, /--comments-body/);
  assert.match(npcBlock, /--comments-path/);
  assert.match(npcBlock, /--comments-start-line/);
  assert.match(npcBlock, /--comments-start-side/);
  assert.doesNotMatch(childBlock, /--event (?:approve|request_changes)/);
  assert.doesNotMatch(
    childBlock,
    /exports:/,
    "NPC result must be published to the PR, not left only in an export",
  );
  assert.match(childBlock, /name: Verify MindX PR review publication/);
  assert.match(childBlock, /cnb pulls get-pull/);
  assert.match(childBlock, /\.data\.state == "open"/);
  assert.match(
    childBlock,
    /\.data\.base\.ref == "main" or \.data\.base\.ref == "refs\/heads\/main"/,
  );
  assert.match(childBlock, /\.data\.head\.sha == \$head/);
  assert.match(
    childBlock,
    /verify_current_pull "before reading publication records"/,
  );
  assert.match(
    childBlock,
    /verify_current_pull "after reading publication records"/,
  );
  assert.match(childBlock, /cnb pulls list-pull-reviews/);
  assert.match(
    childBlock,
    /mindx-pr-review-meta: head_sha=\$MINDX_REVIEW_PR_HEAD_SHA/,
  );
  assert.match(childBlock, /select\(\.state == "commented"\)/);
  assert.match(childBlock, /select\(\.author\.is_npc == true\)/);
  assert.match(childBlock, /ascii_downcase \| sub\("\^@"; ""\)/);
  assert.match(childBlock, /== "codebuddy"/);
  assert.match(childBlock, /MATCH_COUNT.*-ne 1/);
  assert.match(childBlock, /cnb pulls list-pull-review-comments/);
  assert.match(childBlock, /blockers=\(\?<count>\[0-9\]\+\)/);
  assert.match(childBlock, /inline_comments=\(\?<count>\[0-9\]\+\)/);
  assert.match(childBlock, /INLINE_DECLARED.*-gt.*BLOCKERS/);
  assert.match(childBlock, /INLINE_COUNT.*-ne.*INLINE_DECLARED/);
  assert.match(childBlock, /cnb pulls list-pull-comments/);
  assert.match(childBlock, /COMMENT_MATCH_COUNT.*-ne 1/);
  assert.match(childBlock, /exactly one CodeBuddy ordinary summary comment/);
  assert.match(childBlock, /REVIEW_BODY_JSON.*COMMENT_BODY_JSON/s);
  assert.match(childBlock, /Review and ordinary comment bodies differ/);
  assert.match(
    childBlock,
    /ordinary comment does not contain the full summary/,
  );

  const failureStart = childBlock.indexOf("failStages:");
  assert.ok(
    failureStart > verifierStart,
    "child review must define failStages",
  );
  const failureEnd = childBlock.indexOf("\n  # 外部 API", failureStart);
  assert.ok(
    failureEnd > failureStart,
    "failure stage must have a bounded block",
  );
  const failureBlock = childBlock.slice(failureStart, failureEnd);
  assert.match(failureBlock, /name: Report MindX NPC PR review failure/);
  assert.match(failureBlock, /scripts\/collect-pr-context\.py notify-failure/);
  assert.match(failureBlock, /--body-file \/tmp\/mindx-pr-review-failure\.md/);
  assert.doesNotMatch(failureBlock, /post-pull-review/);
  assert.doesNotMatch(failureBlock, /--event (?:approve|request_changes)/);
  assert.doesNotMatch(failureBlock, /git:auto-merge|cnb pulls merge/);

  assert.match(
    skill,
    /不要读取 `.codebuddy\/agents\/code-review-agent\.md`/,
    "review skill must avoid the expensive full code-review-agent preload",
  );
  assert.doesNotMatch(skill, /完整读取[^\n]*code-review-agent\.md/);
  assert.match(skill, /changed paths/);
  assert.match(skill, /files` 已删除 API 返回的 `patch`\/`diff` 字段/);
  assert.match(skill, /git cat-file -e/);
  assert.match(skill, /git merge-base/);
  assert.match(skill, /git diff --no-ext-diff --find-renames/);
  assert.match(skill, /git show "<context\.expected_head_sha>:<path>"/);
  assert.match(skill, /git grep -n '<symbol>' "<context\.expected_head_sha>"/);
  assert.match(skill, /issue_follow_up_commits/);
  assert.match(skill, /禁止自行执行 `git log --all`/);
  assert.match(skill, /评审阶段明确禁止 `cnb pulls --help`/);
  assert.match(skill, /`cnb pulls list-pull-files`/);
  assert.match(skill, /`get-pr-files`/);
  assert.match(skill, /任何 Issue API/);
  assert.match(skill, /才允许发布前 `get-pull`/);
  assert.match(skill, /各一次 `list-pull-reviews`、`list-pull-comments`/);
  assert.match(skill, /已有其一时只补另一个，已有两者时不写/);
  assert.match(skill, /两次写之间再执行一次 `get-pull`/);
  assert.match(skill, /已有对象的 `.body` 原样写入该文件/);
  assert.match(skill, /完全相同的正文，而不只是携带相同 head meta/);
  assert.match(skill, /`cnb pulls post-pull-review --event comment`/);
  assert.match(skill, /`cnb pulls post-pull-comment`/);
  assert.match(skill, /--comments-subject-type line/);
  assert.match(skill, /--comments-path/);
  assert.match(skill, /--comments-start-line/);
  assert.match(skill, /--comments-start-side right/);
  assert.match(skill, /0 <= inline_comments <= blockers/);
  assert.doesNotMatch(skill, /--event (?:approve|request_changes)/);
  assert.equal(
    skill.split("cnb pulls post-pull-review \\\n").length - 1,
    1,
    "the skill must expose exactly one executable Review write boundary",
  );
  assert.equal(
    skill.split("cnb pulls post-pull-comment \\\n").length - 1,
    1,
    "the skill must expose exactly one executable ordinary-comment write boundary",
  );
  assert.ok(
    skill.indexOf("cnb pulls post-pull-comment \\\n") <
      skill.indexOf("cnb pulls post-pull-review \\\n"),
    "when both objects are missing, the visible ordinary summary must publish before the inline Review",
  );
});

test("MindX review metadata keeps body-only blockers independent from inline comments", () => {
  const metadata =
    "<!-- mindx-pr-review-meta: head_sha=" +
    "a".repeat(40) +
    ", risk=high, blockers=2, inline_comments=1, model=gpt-5.5, tags=sdk-compat -->";
  const counts = /blockers=(\d+), inline_comments=(\d+)/.exec(metadata);

  assert.ok(counts, "review metadata must declare both counters");
  const blockers = Number(counts[1]);
  const inlineComments = Number(counts[2]);
  assert.equal(blockers, 2);
  assert.equal(inlineComments, 1);
  assert.ok(inlineComments <= blockers);
});

test("MindX review collector resolves complete CNB paths and fails closed on ambiguity or drift", () => {
  const root = mkdtempSync(join(tmpdir(), "mindx-pr-review-collector-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    runGit(repo, "init", "-b", "main");
    runGit(repo, "config", "user.email", "mindx-review@example.com");
    runGit(repo, "config", "user.name", "MindX Review Test");

    const initialFiles = {
      "root.txt": "root before\n",
      "dir-a/shared.ts": "a before\n",
      "dir-b/shared.ts": "b before\n",
      "rename/old.ts": "rename-only-content\n",
      "delete/gone.ts": "delete me\n",
    };
    for (const [path, content] of Object.entries(initialFiles)) {
      mkdirSync(join(repo, path, ".."), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    runGit(repo, "add", "-A");
    runGit(repo, "commit", "-m", "base contract #1234");
    const targetSha = runGit(repo, "rev-parse", "HEAD");

    runGit(repo, "switch", "-c", "feature/full-path-review");
    writeFileSync(join(repo, "root.txt"), "root after\n");
    writeFileSync(join(repo, "dir-a/shared.ts"), "a after\n");
    writeFileSync(join(repo, "dir-b/shared.ts"), "b after\n");
    mkdirSync(join(repo, "encoded dir"), { recursive: true });
    writeFileSync(join(repo, "encoded dir/space #file.ts"), "encoded\n");
    runGit(repo, "mv", "rename/old.ts", "rename/new.ts");
    rmSync(join(repo, "delete/gone.ts"));
    runGit(repo, "add", "-A");
    runGit(repo, "commit", "-m", "follow-up implementation #1234");
    const headSha = runGit(repo, "rev-parse", "HEAD");

    const expectedPaths = [
      "delete/gone.ts",
      "dir-a/shared.ts",
      "dir-b/shared.ts",
      "encoded dir/space #file.ts",
      "rename/new.ts",
      "root.txt",
    ];
    const encodeRepoPath = (path) =>
      path.split("/").map(encodeURIComponent).join("/");
    const fileRecord = (path, status) => {
      const encodedPath = encodeRepoPath(path);
      return {
        filename: basename(path),
        status,
        contents_url: `https://cnb.woa.com/x-team/mindx/-/git/contents/${encodedPath}?ref=${headSha}`,
        blob_url: `https://cnb.woa.com/x-team/mindx/-/blob/${headSha}/${encodedPath}`,
        patch: "duplicate API patch must be removed",
        diff: "duplicate API diff must be removed",
      };
    };
    const goodFiles = [
      fileRecord("root.txt", "modified"),
      fileRecord("dir-a/shared.ts", "modified"),
      fileRecord("dir-b/shared.ts", "modified"),
      fileRecord("encoded dir/space #file.ts", "added"),
      fileRecord("rename/new.ts", "renamed"),
      fileRecord("delete/gone.ts", "deleted"),
    ];
    const pull = {
      state: "open",
      title: "full path review #1234",
      body: "Refs #1234",
      head: { sha: headSha, ref: "feature/full-path-review" },
      base: { sha: targetSha, ref: "main" },
    };
    const responsesFor = (files) => ({
      "pulls get-pull": pull,
      "pulls list-pull-files": files,
      "pulls list-pull-commits": [{ sha: headSha }],
      "pulls list-pull-comments": [],
      "pulls list-pull-reviews": [],
      "issues get-issue": { number: 1234, body: "AC-1" },
      "issues list-issue-comments": [{ body: "accepted" }],
    });
    const fake = installFakeCnb(root);
    writeFakeCnbFixture(fake.fixturePath, responsesFor(goodFiles));

    const artifactDir = join(root, "artifacts");
    const contextPath = join(artifactDir, "context.json");
    const changedPathsPath = join(artifactDir, "changed-paths.txt");
    const diffPath = join(artifactDir, "review.diff");
    const env = {
      ...process.env,
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      FAKE_CNB_FIXTURE: fake.fixturePath,
      FAKE_CNB_LOG: fake.logPath,
      CNB_REPO_SLUG: "x-team/mindx",
      MINDX_REVIEW_REPO_SLUG: "x-team/mindx",
      MINDX_REVIEW_PR_IID: "1306",
      MINDX_REVIEW_PR_HEAD_SHA: headSha,
      MINDX_REVIEW_PR_TARGET_SHA: targetSha,
      MINDX_REVIEW_SOURCE_BRANCH: "feature/full-path-review",
      MINDX_REVIEW_SOURCE_SLUG: "x-team/mindx",
    };
    const collectArgs = [
      "--context-file",
      contextPath,
      "--changed-paths-file",
      changedPathsPath,
      "--diff-file",
      diffPath,
    ];
    const success = runReviewHelper("collect", collectArgs, { cwd: repo, env });
    assert.equal(success.status, 0, success.stderr);

    const context = JSON.parse(readFileSync(contextPath, "utf8"));
    assert.deepEqual(
      [...context.changed_paths].sort(),
      [...expectedPaths].sort(),
    );
    assert.deepEqual(
      context.files.map((file) => file.full_path).sort(),
      [...expectedPaths].sort(),
    );
    assert.equal(
      context.files.filter((file) => file.filename === "shared.ts").length,
      2,
      "same basenames in different directories must remain distinct",
    );
    assert.ok(
      context.files.every((file) => !("patch" in file) && !("diff" in file)),
      "API patch/diff fields must not enter model context",
    );
    assert.ok(
      context.git_changes.some(
        (change) =>
          change.status.startsWith("R") &&
          change.old_path === "rename/old.ts" &&
          change.path === "rename/new.ts",
      ),
      "rename detection must use the same --find-renames baseline",
    );
    assert.ok(
      context.git_changes.some(
        (change) => change.status === "D" && change.path === "delete/gone.ts",
      ),
    );
    assert.deepEqual(context.issue_numbers, ["1234"]);
    const followUpEvidence = context.issue_follow_up_commits[0];
    assert.equal(followUpEvidence.issue_number, "1234");
    assert.ok(
      followUpEvidence.commits.some(
        (commit) =>
          commit.sha === targetSha &&
          commit.reachable_from.includes("target") &&
          commit.reachable_from.includes("head"),
      ),
    );
    assert.ok(
      followUpEvidence.commits.some(
        (commit) =>
          commit.sha === headSha &&
          commit.reachable_from.includes("head") &&
          !commit.reachable_from.includes("target"),
      ),
    );
    assert.match(readFileSync(diffPath, "utf8"), /rename from rename\/old\.ts/);
    assert.deepEqual(
      readFileSync(changedPathsPath, "utf8").trim().split("\n").sort(),
      [...expectedPaths].sort(),
    );
    const commands = readFakeCnbCommands(fake.logPath);
    assert.doesNotMatch(JSON.stringify(commands), /--help|get-pr-files/);

    const ambiguousFiles = structuredClone(goodFiles);
    ambiguousFiles[0].blob_url = `https://cnb.woa.com/x-team/mindx/-/blob/${headSha}/other/root.txt`;
    writeFakeCnbFixture(fake.fixturePath, responsesFor(ambiguousFiles));
    const ambiguous = runReviewHelper("collect", collectArgs, {
      cwd: repo,
      env,
    });
    assert.notEqual(ambiguous.status, 0);
    assert.match(ambiguous.stderr, /ambiguous pull file paths/);

    const illegalFiles = structuredClone(goodFiles);
    illegalFiles[0].contents_url =
      "https://cnb.woa.com/x-team/mindx/-/git/contents/%ZZ?ref=bad";
    writeFakeCnbFixture(fake.fixturePath, responsesFor(illegalFiles));
    const illegal = runReviewHelper("collect", collectArgs, { cwd: repo, env });
    assert.notEqual(illegal.status, 0);
    assert.match(illegal.stderr, /malformed URL escape/);

    writeFakeCnbFixture(
      fake.fixturePath,
      responsesFor([...goodFiles, structuredClone(goodFiles[0])]),
    );
    const duplicate = runReviewHelper("collect", collectArgs, {
      cwd: repo,
      env,
    });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /ambiguous duplicate pull file paths/);

    writeFakeCnbFixture(fake.fixturePath, responsesFor(goodFiles.slice(1)));
    const drifted = runReviewHelper("collect", collectArgs, { cwd: repo, env });
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /Git\/API changed path mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MindX review failure notifier is stale-safe, idempotent, and comment-only", () => {
  const root = mkdtempSync(join(tmpdir(), "mindx-pr-review-failure-"));
  try {
    const fake = installFakeCnb(root);
    const headSha = "a".repeat(40);
    const staleHeadSha = "b".repeat(40);
    const buildId = "build-42";
    const buildUrl = "https://cnb.woa.com/x-team/mindx/-/build/42";
    const bodyPath = join(root, "failure.md");
    const env = {
      ...process.env,
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      FAKE_CNB_FIXTURE: fake.fixturePath,
      FAKE_CNB_LOG: fake.logPath,
      MINDX_REVIEW_REPO_SLUG: "x-team/mindx",
      MINDX_REVIEW_PR_IID: "1306",
      MINDX_REVIEW_PR_HEAD_SHA: headSha,
      CNB_BUILD_ID: buildId,
      CNB_BUILD_WEB_URL: buildUrl,
    };
    const currentPull = {
      state: "open",
      base: { ref: "main" },
      head: { sha: headSha },
    };
    const marker = `<!-- mindx-pr-review-failure: head_sha=${headSha}, build_id=${buildId} -->`;
    const runNotifier = () =>
      runReviewHelper("notify-failure", ["--body-file", bodyPath], {
        cwd: root,
        env,
      });

    writeFakeCnbFixture(fake.fixturePath, {
      "pulls get-pull": {
        ...currentPull,
        head: { sha: staleHeadSha },
      },
      "pulls list-pull-comments": [],
      "pulls post-pull-comment": {},
    });
    let result = runNotifier();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFakeCnbCommands(fake.logPath).map((args) => args.slice(0, 2)),
      [["pulls", "get-pull"]],
      "stale head must not list comments or write",
    );

    writeFileSync(fake.logPath, "");
    writeFakeCnbFixture(fake.fixturePath, {
      "pulls get-pull": currentPull,
      "pulls list-pull-comments": [{ body: `already reported\n${marker}` }],
      "pulls post-pull-comment": {},
    });
    result = runNotifier();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFakeCnbCommands(fake.logPath).map((args) => args.slice(0, 2)),
      [
        ["pulls", "get-pull"],
        ["pulls", "list-pull-comments"],
      ],
      "same head/build marker must be idempotent",
    );

    writeFileSync(fake.logPath, "");
    writeFakeCnbFixture(fake.fixturePath, {
      "pulls get-pull": currentPull,
      "pulls list-pull-comments": [],
      "pulls post-pull-comment": { id: 1 },
    });
    result = runNotifier();
    assert.equal(result.status, 0, result.stderr);
    const currentCommands = readFakeCnbCommands(fake.logPath);
    assert.deepEqual(
      currentCommands.map((args) => args.slice(0, 2)),
      [
        ["pulls", "get-pull"],
        ["pulls", "list-pull-comments"],
        ["pulls", "post-pull-comment"],
      ],
    );
    const commandText = JSON.stringify(currentCommands);
    assert.doesNotMatch(
      commandText,
      /post-pull-review|approve|request_changes|\bmerge\b/,
    );
    const body = readFileSync(bodyPath, "utf8");
    assert.match(body, /不能视为已完成代码评审/);
    assert.match(body, new RegExp(buildUrl.replaceAll("/", "\\/")));
    assert.match(
      body,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update pipeline still runs a lightweight prototype guard before other checks", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const updateStart = config.indexOf("  pull_request.update:");
  const mergedStart = config.indexOf("  pull_request.mergeable:");
  const updateBlock = config.slice(updateStart, mergedStart);
  const guardIndex = updateBlock.indexOf(
    "script: node scripts/workflow/check-prototype-pr-policy.mjs",
  );
  const diffIndex = updateBlock.indexOf("- name: Compute DIFF_BASE_SHA");
  assert.ok(guardIndex >= 0, "missing update pipeline prototype guard");
  assert.ok(
    guardIndex < diffIndex,
    "prototype guard must run before PR checks",
  );

  const guardHits = updateBlock.match(
    /script: node scripts\/workflow\/check-prototype-pr-policy\.mjs/g,
  );
  assert.equal(
    (guardHits || []).length,
    1,
    "update pipeline must run prototype guard exactly once",
  );
});

test("untrusted PR update pipeline has no imported secret or API-backed validator", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const updateStart = config.indexOf("  pull_request.update:");
  const mergedStart = config.indexOf("  pull_request.mergeable:");
  const updateBlock = config.slice(updateStart, mergedStart);

  assert.doesNotMatch(updateBlock, /imports:|MINDX_CI_TOKEN/);
  assert.match(updateBlock, /check-mr-sync-status\.mjs/);
});

test("workflow policy unit tests only run when scripts/workflow diff exists", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const updateStart = config.indexOf("  pull_request.update:");
  const mergedStart = config.indexOf("  pull_request.mergeable:");
  const updateBlock = config.slice(updateStart, mergedStart);

  const stageIndex = updateBlock.indexOf("- name: workflow policy unit tests");
  assert.ok(stageIndex >= 0, "workflow policy unit tests stage must exist");
  const nextStageIndex = updateBlock.indexOf("- name:", stageIndex + 1);
  const stageBlock = updateBlock.slice(stageIndex, nextStageIndex);
  assert.match(
    stageBlock,
    /if:\s*\|\s*\n\s*\[\s*"?\$WORKFLOW_SCRIPTS_CHANGED"?\s*=\s*"1"\s*\]/,
    "workflow policy unit tests stage must be gated on WORKFLOW_SCRIPTS_CHANGED=1",
  );

  assert.match(
    updateBlock,
    /WORKFLOW_SCRIPTS_CHANGED:\s*WORKFLOW_SCRIPTS_CHANGED/,
    "Compute DIFF_BASE_SHA stage must export WORKFLOW_SCRIPTS_CHANGED",
  );
});

test("main uses trusted target and mergeable events for read-only Issue validation", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const mainStart = config.indexOf("\nmain:\n");
  const hotfixStart = config.indexOf('"hotfix/**":');
  const mainBlock = config.slice(mainStart, hotfixStart);

  assert.match(
    mainBlock,
    /pull_request\.target:[\s\S]*check-pr-issue-contract\.mjs/,
  );
  assert.match(
    mainBlock,
    /pull_request\.mergeable:[\s\S]*check-pr-issue-contract\.mjs/,
  );
});

test("fallback ($) selector still guards prototype PRs on unknown targets", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  const dollarStart = config.startsWith("$:\n")
    ? 0
    : config.indexOf("\n$:\n") + 1;
  assert.ok(dollarStart >= 0, "cnb config must contain a $ fallback selector");
  const mainStart = config.indexOf("\nmain:\n");
  const dollarBlock = config.slice(dollarStart, mainStart);
  assert.match(
    dollarBlock,
    /pull_request\.target:[\s\S]*check-prototype-pr-policy\.mjs/,
    "fallback selector must reject prototype PRs targeting any non-registered branch",
  );
});

test("hotfix/feature/bugfix selectors no longer duplicate prototype guard", () => {
  const config = readFileSync(cnbConfigUrl, "utf8");
  for (const selector of ['"hotfix/**":', '"feature/**":', '"bugfix/**":']) {
    const start = config.indexOf(selector);
    assert.ok(start >= 0, `${selector} block must exist`);
    const nextTop = config.slice(start + selector.length).search(/\n[^\s#]/);
    const block = config.slice(
      start,
      nextTop >= 0 ? start + selector.length + nextTop : config.length,
    );
    assert.doesNotMatch(
      block,
      /check-prototype-pr-policy\.mjs/,
      `${selector} must not duplicate prototype guard; $.pull_request.target already covers it`,
    );
    assert.doesNotMatch(
      block,
      /pull_request\.target:/,
      `${selector} must not carry a pull_request.target event (only push/sync)`,
    );
  }
});
