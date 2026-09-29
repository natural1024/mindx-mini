---
name: start-feature
description: 当产品/设计师明确要求创建、记录或提交 Feature、Bug、体验优化 CNB Issue，或开发者提出尚无 Issue 的同类工作时使用；开始原型和已有 Issue 的实现分别转交对应技能。
---

# start-feature 兼容入口

本技能用于创建产品需求池 Issue，或补齐缺失的 Issue 基础设施。它不是产品原型或规格流程，不得把 spec 或 README 当作业务契约。

## 写入前路由

先确定角色、意图，以及请求是否已经给出可解析的 Issue 或 PR。

| 场景                                               | 动作                                                                          | 稳定标记                                                                              |
| :------------------------------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| 产品/设计师明确只要求创建、记录或提交 Issue        | 创建一个`需求池` Issue；不建分支、不开始原型                                  | `[MindXRoute] route=start-feature status=INTAKE_CREATED issue=#<id> state=需求池`     |
| 产品/设计师明确要求开始原型、改页面或制作原型      | 加载 `prototype-workflow`；它会校验或创建`原型中` Issue 与新的 prototype 分支 | `[MindXRoute] route=prototype-workflow status=REDIRECTED from=start-feature`          |
| 开发者给出已有 Issue、PR 或其它可解析的 Issue 引用 | 解析 Issue 后加载 `implement-issue`                                           | `[MindXRoute] route=implement-issue status=REDIRECTED from=start-feature issue=#<id>` |
| 不包含产品、Bug 或 Experience 语义的纯工程工作     | 转交基础设施流程和现有 `[no-issue]` 规则                                      | `[MindXRoute] route=infrastructure status=REDIRECTED from=start-feature`              |

一旦完成转交，立即停止本技能；不得继续进入第二个 Issue 或分支流程。

## 产品需求池路径

仅当产品经理或设计师明确要求创建、记录或提交 Issue，且未要求开始原型或改页面时，才使用此路径。

完整阅读[共享 Issue 创建契约](../_shared/issue-creation.md)。若已识别出已有 Issue 则复用；否则检查完整会话，以及 `git status`、暂存 diff 和未暂存 diff，再按其中确定的 Feature/Bug/Experience 边界分类。只有证据仍跨边界冲突时，才提一个最小澄清问题；不得要求用户自行分类。

只有匹配的模板通过共享标题和内容校验后，才创建一个 Issue；它必须包含映射后的标题前缀、唯一 type 标签和唯一`需求池`标签。不得建分支或开始原型。需求池 Issue 可以省略 AC；若已填写则必须有效。在结构化 AC 完整前，不得开始原型或研发。指派当前操作者后立即重新拉取，验证模板、负责人、唯一 type 标签和唯一`需求池`标签。

创建后输出：

```text
[MindXRoute] route=start-feature status=INTAKE_CREATED issue=#<issue-id> state=需求池 type=<Feature|Bug|Experience>
```

随后停止。

## 开发者缺失 Issue 路径

仅在以下条件全部满足时使用此路径：

- 用户是开发者；
- 工作属于 Feature、Bug 或 Experience，而非纯基础设施；
- 无法解析出已有 Issue；
- 用户已描述足以形成 AC 的可观察行为。

完整阅读[共享 Issue 创建契约](../_shared/issue-creation.md)。检查完整会话，以及 `git status`、暂存 diff 和未暂存 diff。按其中确定的 Feature/Bug/Experience 边界分类；只有证据冲突时才允许提一个最小澄清问题。只有映射模板通过共享标题和内容校验，并且具备唯一 type 标签和可独立测试的 `## 验收标准` 条目后，才创建一个 Issue。初始状态为`待研发`；保留当前开发者为负责人，并立即重新拉取验证模板、AC、负责人、type 和状态标签。`implement-issue` 负责创建生产分支并将其推进到`开发中`。

远端验证成功后，采集具名的内存 `strict_create_snapshot`：version/ETag、精确正文 bytes/SHA-256、规范化 AC JSON/摘要、唯一 type、唯一`待研发`、精确的非状态标签、负责人、open 状态、全部备注，以及已验证的无部署/冻结证据结果。此快照仅是当前调用范围内的证据，不是 Issue 评论或本地文件。

CNB 不可用时必须阻断。不得编造 `LOCAL-*`、`#0`、占位 URL 或带虚假 Issue ID 的分支。

创建后输出：

```text
[MindXRoute] route=start-feature status=ISSUE_CREATED issue=#<issue-id> state=待研发 type=<Feature|Bug|Experience> contract=issue-ac snapshot=strict_create_snapshot
```

随后：

- 常规 Feature、Bug 或 Experience 工作 → 使用新 Issue 加载 `implement-issue`，并显式传递同一个具名 `strict_create_snapshot`；稳定标记不得输出或序列化其中的敏感数据、大段正文、AC JSON、notes 或 assignee payload；
- 明确“补 issue / 漏建 issue” → 创建 Issue 后停止，不触碰用户已有分支或 worktree。

## 已有 Issue 复用规则

若用户给出 Issue ID 或 URL，始终拉取并复用它。不得询问“复用还是新建”，也不得创建重复 Issue。若缺少 AC 或最新请求改变范围，要求产品负责人确认更新 Issue；不得把新范围隐藏在本地 spec 中。

## 禁止的旧行为

- 不走产品五维度/spec-kit 流程。
- 不得把 `.vibe/specs` 作为业务契约。
- 不得把 Page README 或第二份业务契约作为交付必需产物；README 如存在仅作技术导航。
- 不得在本技能内创建分支；分支不变量由 `prototype-workflow` 和 `implement-issue` 负责。
- 不从演示或 prototype 证据恢复整段 cherry-pick 路径。
