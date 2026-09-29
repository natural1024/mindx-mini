import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const skillPath = path.join(
  root,
  ".codebuddy/skills/prototype-handoff/SKILL.md",
);

test("prototype freeze binds a current AC checkpoint and releases only its own worktree", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /最近一次分享的资料库 Page/u);
  assert.match(skill, /当前 AC digest 与最近分享一致/u);
  assert.match(skill, /checkpointPrototype/u);
  assert.match(skill, /sourceTreeSha/u);
  assert.match(skill, /RESHARE_REQUIRED/u);
  assert.match(
    skill,
    /Page、不可变 publication revision、package 摘要、已推送 commit 和交接说明写回 Issue/u,
  );
  assert.match(skill, /转为`待研发`/u);
  assert.match(skill, /删除\*\*这个\*\* prototype worktree/u);
  assert.match(skill, /清理失败时只重试清理/u);
  assert.match(skill, /从最新 `main` 新建生产分支/u);
  assert.doesNotMatch(skill, /frozen ref|prototype-freeze/u);
});
