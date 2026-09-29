---
name: implement-issue
description: 当开发者要求实现或修复 CNB Issue、消费已冻结的产品原型、提出“实现 #ID”时使用。研发始终从最新 main 独立开发。
---

# 研发实现 Issue

产品原型只提供方向，不是待合并代码。研发以 Issue 的当前 AC 为准，从最新 `main` 独立实现。

1. 读取 Issue，确认它处于`待研发`或`开发中`，并有可实现的 AC；若产品提供了 WorkBuddy Page，把它当作视觉和交互参考。
2. `git fetch origin main`，从最新 `origin/main` 新建 `feature|bugfix/<issue-id>-<slug>`；不要从 prototype worktree、分支或提交创建生产分支。
3. 将 Issue 推到`开发中`，在真实 `apps/mindx` 接入真实数据、接口与协同。
4. 可参考 Page，但逐项决定 rewrite 或 discard。原型的 mock、脚手架和未提交代码都不进入生产。
5. 完成后按 `cmd-publish` 提交生产分支并创建目标为 `main` 的 PR。

## 硬边界

- 禁止 merge、整分支 cherry-pick 或复制 prototype runtime。
- 生产分支不得包含 `prototype.config.json`、`apps/mindx/src/prototype/**` 或 prototype-only mock。
- 发现 Issue 与 Page 不一致时，以 Issue 为准；需要改需求时回到产品更新 Issue。
- 原型没有 Page 或已被放弃，不阻止研发按 Issue 独立开始。
