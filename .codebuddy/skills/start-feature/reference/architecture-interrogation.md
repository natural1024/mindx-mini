# 研发架构边界对齐 Reference

本文件是研发在 `implement-issue` / `dev-workflow` 中按需使用的非业务架构参考。Issue 中稳定编号的 AC 是唯一业务契约；本环节不能新增、改写或替代 AC，冻结 prototype 也只能作为只读设计证据。

## 适用条件

仅当实现存在真实技术分叉时，选择最关键的 1–3 个问题对齐，例如：

- 新增或变更 Record / Block schema、兼容或迁移策略；
- 影响多个 page、共享 hook、service、权限或协同边界；
- SDK 能力、性能、离线行为或异常恢复存在多个实现方案；
- 需要决定复用、重写或放弃 prototype 中的某个明确片段。

简单样式、文案、既有模式内的局部实现不触发。产品 prototype 默认也不触发；只有可行性风险可能让 AC 无法实现时，才把风险报告给产品。

## 对齐维度

### 数据与接口

- 当前 `packages/core-data` 的 Record 模型和真实接口是否已经覆盖需求；
- 通用读取/提交是否继续收敛在 `getRecords` / `commit`，特别业务接口放在哪个既有 service；
- schema 兼容、旧数据迁移、权限和失败恢复由哪一层负责。

### 影响半径

- 目标 page、共享组件/hook/service 的实际引用链；
- 是否需要上移公共能力，且不违反禁止跨 page import 的规则；
- PC/mobile、主题、协同、离线与发布链路是否受影响。

### 状态与验证

- 状态由 Record、URL、Context、localStorage 还是后台持久化；
- 每条 Issue AC 对应什么 production test 或可观察验证；
- prototype 的 mock/禁用副作用哪些必须 `rewrite` 或 `discard`，不能进入生产。

## 输出与升级规则

```markdown
## 架构边界对齐（非业务契约）

1. **<维度>**：<具体技术问题>
2. **<维度>**：<具体技术问题>

### 已知代码证据

- <源码路径 / 类型 / 调用链>
```

- 最多 3 问；用户可回答 `skip`，没有安全或契约风险时继续现有方案。
- 问题必须基于当前源码证据，不能要求创建 README 或第二份 PRD/模型契约。
- 如果答案会改变用户可观察行为、范围或 AC 文本，立即停止实现并回到产品确认 Issue；确认后重新执行 handoff/digest 校验。
- 技术决定可记录在 implementation plan，但 plan 不能覆盖 Issue AC。

## 当前调用关系

- `implement-issue`：完成 Issue 与 frozen evidence 校验后，遇到真实架构分叉时按需引用。
- `dev-workflow`：L3 plan 阶段可用本文件收敛技术边界。
- `prototype-workflow`：只接收可行性风险结论，不把本文件变成产品立项门禁。

权威流程见 [`docs/release-workflow.md`](../../../../docs/release-workflow.md) 与 [`docs/prototype-workflow.md`](../../../../docs/prototype-workflow.md)。
