import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const skillPath = path.join(
  root,
  ".codebuddy/skills/prototype-deploy/SKILL.md",
);

test("prototype sharing delegates a verified package through the WorkBuddy Library skill", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /分享 #123/u);
  assert.match(skill, /不提交、不 push/u);
  assert.match(skill, /pnpm prototype:package/u);
  assert.match(skill, /sourceTreeSha/u);
  assert.match(skill, /artifactSha256/u);
  assert.match(skill, /不超过 200/u);
  assert.match(skill, /不一致就提示人工处理/u);
  assert.match(skill, /不创建 PR/u);

  const prepareIndex = skill.indexOf("share-prepare");
  const publisherIndex = skill.indexOf("page/import_html.py");
  const completeIndex = skill.indexOf("share-complete");
  assert.ok(prepareIndex >= 0);
  assert.ok(prepareIndex < publisherIndex);
  assert.ok(publisherIndex < completeIndex);
  assert.match(skill, /page\/import_html\.py.*等价发布能力/su);
  assert.match(skill, /发布失败.*share-reject/su);
  assert.match(skill, /既有.*(?:page|node).*覆盖/su);

  const connectIndex = skill.indexOf("connect_open_platform");
  const publishIndex = skill.indexOf("page/import_html.py");
  assert.ok(connectIndex >= 0);
  assert.ok(connectIndex < publishIndex);
  assert.match(skill, /每次分享.*当次新 token/su);
  assert.match(skill, /token.*stdin \/ 内存/su);
  assert.match(skill, /严禁.*token.*仓库.*状态.*回执.*日志.*命令行参数/su);
  assert.match(
    skill,
    /code=10034.*丢弃.*重新.*connect_open_platform.*一次.*仅重放.*一次/su,
  );
  assert.match(skill, /第二次.*10034.*AUTHENTICATION_BLOCKED/su);
  assert.match(skill, /严禁循环.*connect/su);
  assert.match(skill, /非空.*publish_url.*发布链接契约/su);
  assert.match(skill, /publish_url.*为空/su);
  assert.match(skill, /发布能力.*不可用/su);
  assert.match(skill, /share-reject/u);
  assert.match(skill, /SHARE_INCOMPLETE/u);
  assert.match(skill, /EXTERNAL_PUBLISH_CAPABILITY_MISSING/u);
  assert.match(skill, /detail `url`.*Page 详情 URL.*不得.*分享链接/su);
  assert.match(skill, /share-reject.*不得写入成功 publication.*Issue/su);
  assert.doesNotMatch(skill, /\bpublish_html\.py\b/u);
  assert.doesNotMatch(skill, /MINDX_PROTOTYPE_HOST_ADAPTER/u);
  assert.match(skill, /不得修改 WorkBuddy/u);
  assert.match(skill, /不要求产品手工修环境/u);
  assert.match(skill, /严禁降级.*CloudStudio.*EdgeOne.*本地端口链接/su);
});
