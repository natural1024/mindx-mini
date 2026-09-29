# Agent Team 协作基建（dev-workflow）

> 面向人类团队成员的机制说明。AI 侧精确编排见 `.codebuddy/skills/dev-workflow/SKILL.md`。

## 目标

dev-workflow 让轻改保持轻量，同时给完整任务提供可追踪的实现、审阅和测试证据：

- L1：主会话直改并跑相关静态检查；
- L2：Code → Review → Test；
- L3：先生成 tracked plan、等用户批准，再分段实现和审阅，最后统一测试。

Agent 的选择由运行环境负责。仓库只约定所有角色都能遵守的输入和输出，不把流程绑定到具体实现。

## 三档分流

AI 落笔前会输出一次：

```text
[DevWorkflow] 模式=infrastructure，分档=L2，理由=修改两个工具文件并补回归测试
```

| 档位 | 触发                                             | 动作                                              |
| :--- | :----------------------------------------------- | :------------------------------------------------ |
| L1   | 不超过 20 行、单文件、非 core-data、且不新建文件 | 直改 + 相关 typecheck/lint                        |
| L2   | 1–3 个组件/Hook、小特性、bug 修复                | Code → Review → Test                              |
| L3   | 新页面、跨层、正式业务模型、至少 4 文件重构      | tracked plan + 用户批准 + 分段 Review + 最终 Test |

## 稳定协作契约

Plan、Code、Review、Test 收到相同的六字段 envelope：

```yaml
workflow_mode: prototype | implementation | infrastructure
tier: L1 | L2 | L3 | Polish
task: 当前角色的单一任务
contract: Issue AC 原文、local draft 的 DRAFT-* 探索目标或 ENG-* 工程目标
scope: 文件、包、分支边界与非目标
evidence: handoff、diff、测试日志、上轮问题或 none
```

角色需要的 task id、plan 路径、回推轮次和改动清单，都放在这六个字段内部，不再各自发明同义字段。Review、Test 和 Code 都返回结构化 `result` 与逐 AC/DRAFT/ENG 的 `ac_evidence`，便于主会话稳定编排。`DRAFT-*` 只服务本地探索，不是业务 AC；promote 后由真实 Issue AC 替换。

## L3 tracked plan

L3 plan 位于 `.vibe/plans/plan-<plan_key>.md`，跟随 git 便于审阅和跨会话恢复。Issue key 沿用 IID（例如 `plan-74.md`）；local draft 使用 `draft-<draftId>`；infrastructure 使用 `infra-<stable-task-id-or-slug>`。`plan_key` 随 `task` 传递，不增加第七个 envelope 字段；不使用会让多个任务碰撞的 `NO-ISSUE` 文件名。结构固定为：

- `## Contract`：Issue AC 原文、`DRAFT-*` 探索目标或 `ENG-*` 工程目标；
- `## Design`：影响面、决策、风险与非目标；
- `## Tasks`：带状态的权威 todos；
- `## Verification`：逐 AC/ENG 验证矩阵；
- `## Execution log`：主会话追加的里程碑。

IDE todo 只是 `## Tasks` 的可视化投影。Plan 生成后 AI 展示摘要，等用户批准再进入 Code；已有 `in_progress` 或 `done` 时先展示进度再继续。

## 回推和熔断

Code 完成后由 Review 逐条核对契约和工程边界，再由 Test 运行受影响验证：

- Review `PASS` 才进入 Test；`NOT_PASS` 回推 Code；
- Test `PASS` 才收尾；`FAIL` 回推 Code；
- Review 或 Test 连续两轮仍未通过就熔断，把证据交给用户决定。

L3 每个 task 都做 Review，所有 task Review 通过后可以统一 Test。

## Polish 窗口

L2/L3 收尾后的单文件小改可以走轻量 Polish：直改并跑相关守底。累计至少 5 文件或 80 行时做一次增量 Review。出现新文件、新需求、跨层改动或超过 L1 阈值时退出窗口并重新分档。

## 与上下游的关系

```text
prototype-workflow / implement-issue / infrastructure request
  → dev-workflow
  → cmd-publish（仅用户明确要求提交或发布时）
```

dev-workflow 不替代 Issue/分支准备，也不自动提交、push、创建 PR 或发布。想调整分档、Agent 契约或 L3 plan 结构时，以 `.codebuddy/skills/dev-workflow/SKILL.md` 为真相源。
