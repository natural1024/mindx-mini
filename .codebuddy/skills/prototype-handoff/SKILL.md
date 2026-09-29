---
name: prototype-handoff
description: 当产品经理或设计师说“冻结原型”“交给研发”“结束 #ID 原型”时使用。它以最近一次可验证的 Page/package 和当前 Issue AC 交接，然后清理本地原型。
---

# 冻结原型

冻结是“方向确认，交给研发”，不是把原型代码送进生产。

1. 先确认目标是 Issue-bound 原型。`draft:<draftId>` 直接返回 `DRAFT_PROMOTION_REQUIRED`，不得 checkpoint、push、写 Issue 或清理 worktree；先用 `promote` 绑定 open、唯一`原型中`且有结构化 AC 的真实 Issue，保留原 worktree，迁移 runtime identity，并沿用稳定 Page 锚点重新分享。
2. 确认 #ID 是处于 active 或 paused 的受管 prototype worktree，且已有最近一次分享的资料库 Page 与 package；没有 Page 时提醒先分享。paused 可直接冻结，不必为交付重新启动服务。
3. 重新读取 Issue：它必须 open、唯一 `原型中`，有结构化 AC，且当前 AC digest 与最近分享一致。AC 变更时要求先重新分享，避免未记录的原型范围进入研发。
4. 复验最小 publication 回执只包含稳定 `pageId`、`nodeBlockId`、`pageUrl` 与 package identity（`sourceTreeSha`、`artifactSha256`、`archiveSha256`、`packageManifestSha256`、`fileCount`），并与当前 package 完全一致。
5. **提交并推送 prototype 分支（这是提交原型代码的唯一时机）**：宿主 `checkpointPrototype` 用临时/真实暂存后的 tree 校验当前源码必须等于最近一次分享的 `sourceTreeSha`。漂移则返回 `RESHARE_REQUIRED`，不得 commit/push/写 Issue；一致时幂等 commit 并**普通 push**，返回相同 tree 的 `commitSha/treeSha/remoteSha`。**绝不创建 PR、绝不合入 main、绝不 force push**。
6. 只有 checkpoint 复验成功后，才以 Issue version/ETag、AC digest 和幂等键，把 Page、不可变 publication revision、package 摘要、已推送 commit 和交接说明写回 Issue，并转为`待研发`。随后重新读取远端 Issue，完整复验 publication、package、checkpoint、remote、AC 与版本证据；仅 label 与 AC 一致不算成功。
7. 成功写回后删除**这个** prototype worktree 和本地记录。清理失败时只重试清理，不能重复推进 Issue。

研发从最新 `main` 新建生产分支，以 Issue 为契约、以 Page 和已推送 prototype 分支为设计参考独立实现；不 merge、cherry-pick 或把 prototype runtime 带入生产。

不要创建 PR、merge 或额外 tag；仓库不保存 WorkBuddy 凭据。
