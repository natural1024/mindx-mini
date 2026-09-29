import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Issue templates keep a single type label and acceptance-criteria field", async () => {
  for (const [file, label] of [
    [".cnb/ISSUE_TEMPLATE/0-feature-request.yml", "type:feature"],
    [".cnb/ISSUE_TEMPLATE/1-bug-report.yml", "type:bug"],
    [".cnb/ISSUE_TEMPLATE/2-experience-improvement.yml", "type:experience"],
  ]) {
    const template = await read(file);
    assert.match(template, new RegExp(`labels: \\["${label}"\\]`, "u"));
    assert.match(template, /label: 验收标准/u);
  }
});

test("product prototype flow supports local drafts and three-stage Library sharing", async () => {
  const workflow = await read(".codebuddy/skills/prototype-workflow/SKILL.md");
  const deploy = await read(".codebuddy/skills/prototype-deploy/SKILL.md");
  const hostContract = await read("tools/prototype-kit/HOST-ADAPTER.md");

  assert.match(
    workflow,
    /开始、分享、暂停、继续、升级、冻结、丢弃草稿、放弃 Issue 原型/u,
  );
  assert.match(workflow, /draft.*Issue-bound.*共享.*ACTIVE_LIMIT=3/su);
  assert.match(workflow, /starting.*active.*占运行槽/su);
  assert.match(workflow, /没有 Issue.*本地.*draft.*不创建、读取或校验 Issue/su);
  assert.match(deploy, /不提交、不 push/u);
  assert.match(deploy, /pnpm prototype:package/u);
  assert.match(
    deploy,
    /share-prepare.*page\/import_html\.py.*share-complete.*share-reject/su,
  );
  assert.match(
    hostContract,
    /latestReceipt.*pageId.*nodeBlockId.*pageUrl.*sourceTreeSha.*artifactSha256.*archiveSha256.*packageManifestSha256.*fileCount/su,
  );
});

test("production implementation starts fresh from main and never merges prototype code", async () => {
  const implementation = await read(
    ".codebuddy/skills/implement-issue/SKILL.md",
  );

  assert.match(implementation, /从最新 `main` 独立实现/u);
  assert.match(implementation, /从最新 `origin\/main` 新建/u);
  assert.match(implementation, /禁止 merge、整分支 cherry-pick/u);
  assert.match(implementation, /prototype-only mock/u);
});
