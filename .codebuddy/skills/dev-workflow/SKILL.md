---
name: dev-workflow
description: 当准备编写或修改任意仓库代码时使用，包括产品原型、生产 Issue 实现、缺陷修复、UI/样式改动、重构和基础设施；用于选择模式及 L1/L2/L3 分档，并编排 Code/Review/Test Agent。
---

# Dev Workflow

主会话是唯一 Team Lead。它负责分档、派发、回推和维护 L3 plan；各专精 Agent 只完成自己的任务。工作流校验的是稳定的输入与结果契约，不关心执行 Agent 的具体实现。

## 模式与分档

写入前输出且只输出一次：

```text
[DevWorkflow] 模式=<prototype|implementation|infrastructure>，分档=L<1|2|3>，理由=<一句话>
```

| 模式             | 上游入口                   | 契约                                                | 重点                                             |
| :--------------- | :------------------------- | :-------------------------------------------------- | :----------------------------------------------- |
| `prototype`      | `prototype-workflow`       | Issue AC；local draft 使用可变的 `DRAFT-*` 探索目标 | mock 边界、无真实副作用、制品可搬运              |
| `implementation` | `implement-issue`          | Issue AC                                            | fresh main、真实数据链路、无 prototype-only 文件 |
| `infrastructure` | 工具、规则、文档或 CI 任务 | 用户确认的 `ENG-*` 工程目标                         | 回归、安全、兼容性                               |

| 档位 | 条件                                                 | 流程                                                              |
| :--- | :--------------------------------------------------- | :---------------------------------------------------------------- |
| L1   | 预计不超过 20 行、单文件、非 core-data、且不新建文件 | 主会话直改，再跑相关 typecheck/lint                               |
| L2   | 1–3 个组件或 Hook、小特性、bug 修复                  | Code → Review → Test                                              |
| L3   | 新页面、跨层改动、正式业务模型、或至少 4 文件重构    | 先生成 tracked plan 并获用户批准，再分段 Code → Review，最后 Test |

判不准时向上升一档。新增 `packages/ui-components/src/components/` 内容前先按 `docs/ui-components/atomic-component-criteria.md` 判断；业务组件回到 `apps/mindx`。

## 通用派发契约

Plan、Code、Review、Test 的 prompt 顶层一律只有以下六个字段；角色细节放在字段内部，不新增同义字段：

```yaml
workflow_mode: prototype | implementation | infrastructure
tier: L1 | L2 | L3 | Polish
task: 本角色要完成的任务；L3 可包含稳定 plan_key、plan 路径、task id 和回推轮次
contract: Issue AC 原文、local draft 的 DRAFT-* 探索目标，或 infrastructure 的 ENG-* 工程目标
scope: 允许读写或审阅的文件、包、分支与明确非目标
evidence: 已有 handoff、diff、测试日志、上轮问题或 none
```

Issue-bound prototype 与 implementation 的 `contract` 必须保留稳定 AC ID 与完整原文。local draft 使用本轮可修改的 `DRAFT-*` 探索目标；它不是业务 AC，promote 后必须替换为真实 Issue AC。infrastructure 使用稳定 `ENG-*` 引用。证据只能证明当前契约，不能扩写契约。

## L3 tracked plan

Plan Agent 先从 `task` 取得稳定 `plan_key`，再把规划写入 `.vibe/plans/plan-<plan_key>.md`。Issue 的 key 沿用 `<issueId>`，保持既有 `plan-74.md` 兼容；local draft 使用 `draft-<draftId>`；infrastructure 使用 `infra-<stable-task-id-or-slug>`。不同任务不得共用占位 key，`NO-ISSUE` 不得作为文件名。文件必须使用以下稳定 heading，所有读取、状态投影和日志追加都按 heading 名定位：

```markdown
# Plan: <标题>

- plan_key: <IID | draft-draftId | infra-stable-task-id-or-slug>
- issue_id: <IID，仅 Issue-bound；否则省略>
- branch: <branch>
- workflow_mode: <mode>
- tier: L3
- updated_at: <ISO 时间>

## Contract

<AC 原文、DRAFT-\* 探索目标或 ENG-\* 工程目标；handoff 单列为 evidence-only>

## Design

<影响面、关键决策、风险、非目标与信息缺口>

## Tasks

| Task | Size | Contract refs          | Done when  | Status |
| :--- | :--- | :--------------------- | :--------- | :----- |
| T1   | S    | AC-1 / DRAFT-1 / ENG-1 | 可交付标志 | todo   |

## Verification

| Contract ref           | Automated evidence | Manual evidence |
| :--------------------- | :----------------- | :-------------- |
| AC-1 / DRAFT-1 / ENG-1 | 命令或测试         | 必要时填写      |

## Execution log

- [ISO 时间] Plan created
```

`Status` 只允许 `todo`、`in_progress`、`done`、`blocked`。`## Tasks` 是 todos 的权威来源，`todo_write` 只是投影。`## Execution log` 只追加里程碑。业务范围仍由 Issue AC 决定，plan 不创建第二份业务契约。

Plan Agent 成功时首行精确输出：

```text
✓ plan 已生成 → .vibe/plans/plan-<plan_key>.md
```

随后返回 `result: PASS`、规划摘要和逐 AC/DRAFT/ENG 的 `ac_evidence`。输入缺口返回 `result: NOT_PASS` 与缺口证据，不生成或覆盖有效 plan。

主会话展示摘要并等待用户批准。批准后从 `## Tasks` 投影 todos；启动任务时改为 `in_progress`，最终 Test 通过后改为 `done`，熔断时改为 `blocked`。每次 Code/Review/Test 里程碑追加到 `## Execution log`。现有 plan 有进度时，先展示摘要并询问是否继续。

## Code

主会话按通用六字段派发 Code Agent。L3 的 `task` 指明 plan 路径与一个 `Task` 行；Code Agent 读取 `## Contract`、`## Design`、对应的 `## Tasks` 行和 `## Verification`，不得处理其他 task，也不直接修改 plan。

Code Agent 先写失败测试或明确验证，再做最小实现与相关静态检查。返回：

```yaml
result: PASS | FAIL
changed_files:
  - path
ac_evidence:
  AC-1: 实现与自检证据
  ENG-1: 实现与自检证据
```

`FAIL` 还要给出阻塞原因；主会话决定是否补充信息或回推。

## Review

Review Agent 只读本轮 diff，逐条核对 AC/ENG、当前模式边界、安全、依赖方向、组件落点与测试覆盖。返回：

```yaml
result: PASS | NOT_PASS
ac_evidence:
  AC-1: 文件、行号与判定
  ENG-1: 文件、行号与判定
issues: []
```

`NOT_PASS` 的每条问题包含 `file`、`line`、`category`、`detail`、`fix`。主会话最多回推 Code 两轮；仍未通过则熔断并交还用户。L3 每个 task 完成代码后都 Review。

## Test

Test Agent 根据改动范围执行相关构建、单测、typecheck、lint 和必要的页面验证，逐条给出 AC/ENG 证据。返回：

```yaml
result: PASS | FAIL
ac_evidence:
  AC-1: 测试命令与结果
  ENG-1: 测试命令与结果
commands: []
```

`FAIL` 给出首个有效失败、命令和修复建议。主会话最多回推 Code 两轮；仍失败则熔断。L3 可在所有 task Review 通过后统一 Test。

## 收尾与 Polish

全部通过后主会话汇报改动、Review 与 Test 证据，并进入 L2/L3 Polish 窗口。窗口内仅处理单文件、不超过 20 行且不新建文件的小改，跑相关守底；累计至少 5 文件或 80 行时做一次增量 Review。新需求、新文件、跨层改动或超阈值时退出窗口并重新分档。

用户明确说提交、push 或发布时关闭窗口；存在未验证增量就补跑相关检查。dev-workflow 不自动提交、push、创建 PR 或发布，出口仍由 `cmd-publish` 处理。

## 熔断

Review 或 Test 两轮仍未通过时，停止自动回推，保留当前改动和 L3 状态，向用户说明失败证据与需要的决定。不要为了通过流程改写 AC、扩大 scope 或降低安全边界。
