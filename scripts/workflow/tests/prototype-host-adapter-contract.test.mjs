import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const relativeSources = [
  "AGENTS.md",
  "QUICKSTART-DESIGNER.md",
  ".codebuddy/skills/prototype-workflow/SKILL.md",
  "tools/prototype-kit/HOST-ADAPTER.md",
  "docs/prototype-workflow.md",
  "docs/release-workflow.md",
  "docs/GUIDE-FOR-PM.md",
];

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function sources() {
  return Promise.all(
    relativeSources.map(async (relativePath) => [
      relativePath,
      await source(relativePath),
    ]),
  );
}

test("host adapter exposes the small lifecycle surface", async () => {
  const contract = await source("tools/prototype-kit/HOST-ADAPTER.md");
  const methods = /适配器必须提供：(?<methods>[^。]+)。/u.exec(contract)?.groups
    ?.methods;

  assert.ok(methods);
  for (const required of [
    "createWorktree",
    "preparePrototypeRuntime",
    "startPrototype",
    "probePrototype",
    "pausePrototype",
    "preparePrototypePackage",
    "checkpointPrototype",
    "removeWorktree",
  ]) {
    assert.match(methods, new RegExp(`\\b${required}\\b`, "u"));
  }
  assert.doesNotMatch(methods, /recoverPrototypeStart|sharePrototype/u);
  assert.match(contract, /Publisher.*host adapter.*(?:分离|不属于)/su);
});

test("runtime contract uses frozen install, local inspection, and explicit retry", async () => {
  const contract = await source("tools/prototype-kit/HOST-ADAPTER.md");

  assert.match(contract, /pnpm.*install.*--frozen-lockfile/su);
  for (const field of [
    "mode",
    "localId",
    "deploymentKey",
    "branch",
    "worktreePath",
    "installArgv",
  ]) {
    assert.match(contract, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(contract, /draftId\?.*issueId\?/u);
  assert.doesNotMatch(contract, /operationId/u);
  assert.match(
    contract,
    /pnpm-lock\.yaml.*node_modules.*\.modules\.yaml.*非空普通文件/su,
  );
  assert.match(contract, /同一 lockfile hash.*复用依赖/su);
  assert.match(contract, /下一次显式继续/su);
  assert.match(contract, /probePrototype.*ready.*stopped.*unknown/su);
  assert.match(contract, /unknown.*不 spawn.*不停止.*不改成 active/su);
  assert.doesNotMatch(contract, /--no-frozen-lockfile/u);
});

test("only starting and active consume the shared three-slot capacity", async () => {
  for (const [relativePath, contents] of await sources()) {
    assert.match(
      contents,
      /(?:只有|仅)[^。\n]{0,120}(?:(?:`?starting`?[^。\n]{0,80}`?active`?)|(?:正在启动[^。\n]{0,40}已经启动))[^。\n]{0,40}(?:占槽|占运行槽|占位置)/u,
      `${relativePath}: running-only capacity contract is missing`,
    );
  }
});

test("prototype operations stay flexible after pause", async () => {
  const [skill, workflow, host] = await Promise.all([
    source(".codebuddy/skills/prototype-workflow/SKILL.md"),
    source("docs/prototype-workflow.md"),
    source("tools/prototype-kit/HOST-ADAPTER.md"),
  ]);
  const combined = `${skill}\n${workflow}\n${host}`;

  assert.match(combined, /active 或 paused.*分享/su);
  assert.match(combined, /active 或 paused.*Issue-bound.*冻结/su);
  assert.match(combined, /暂停和继续.*不读取 Issue/su);
  assert.match(combined, /draft.*分享.*不访问 Issue/su);
});

test("freeze is serialized with local operations before delivery side effects", async () => {
  const contract = await source("tools/prototype-kit/HOST-ADAPTER.md");

  assert.match(contract, /per-prototype 操作锁[^。]*freeze/u);
  assert.match(contract, /freeze[^。]*全局状态锁[^。]*交接/u);
});

test("draft discard is local, stopped-first, and retryable", async () => {
  const [skill, host] = await Promise.all([
    source(".codebuddy/skills/prototype-workflow/SKILL.md"),
    source("tools/prototype-kit/HOST-ADAPTER.md"),
  ]);
  const combined = `${skill}\n${host}`;

  assert.match(combined, /discard --draft|丢弃草稿/su);
  assert.match(combined, /不访问或关闭 Issue/su);
  assert.match(combined, /probe unknown.*fail closed/su);
  assert.match(combined, /ready.*pause.*复验 stopped/su);
  assert.match(combined, /删除成功后才.*state/su);
  assert.match(combined, /CLEANUP_REQUIRED.*保留 state/su);
});

test("package contract preserves source identity without a compaction pipeline", async () => {
  const contract = await source("tools/prototype-kit/HOST-ADAPTER.md");

  assert.match(contract, /临时 `GIT_INDEX_FILE`.*sourceTreeSha/su);
  assert.match(contract, /source manifest.*文件清单.*hash/su);
  assert.match(contract, /拒绝 symlink.*不安全相对路径/su);
  assert.match(contract, /ZIP.*index\.html.*1–200.*完整性/su);
  assert.match(contract, /不要求脚本合并、HTML 压缩或单 bundle/su);
  assert.match(
    contract,
    /latestReceipt.*pageId.*nodeBlockId.*pageUrl.*sourceTreeSha.*artifactSha256.*archiveSha256.*packageManifestSha256.*fileCount/su,
  );
});

test("current workflow sources do not retain the removed recovery machinery", async () => {
  const forbidden = [
    "recoverPrototypeStart",
    "startAttemptId",
    "startAttemptStatus",
    "heartbeat",
    "stale TTL",
    "cleanup_required",
    "cleanupRequired",
    "package-import-method=clone",
    "registryDependencies",
    "SAFE_DELETE_BLOCKED",
    "BROKER_DENY",
    "PARTIAL_INSTALL",
  ];

  for (const [relativePath, contents] of await sources()) {
    for (const term of forbidden) {
      assert.equal(
        contents.includes(term),
        false,
        `${relativePath}: removed term remains: ${term}`,
      );
    }
  }
});
