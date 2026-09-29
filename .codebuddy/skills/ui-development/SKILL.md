---
name: ui-development
description: 当开发或修改 MindX 页面、Hook、UI 组件，或在 prototype 分支上制作产品原型时使用。
---

# UI Development

> 实现结构遵循 `docs/ui-development-spec.md`。共享原子组件的唯一准入入口是
> `docs/ui-components/atomic-component-criteria.md`；Page 私有/公共落点、注释和 parser 的唯一
> 入口是 `docs/page-internal-structure.md`。业务范围只来自 Issue AC；local draft 只使用本轮
> `DRAFT-*` 探索目标。

## Mode 0：先按分支与契约选择模式

执行 `git branch --show-current`，在读取需求或写代码前选定模式：

| 条件                                          | 模式             | 契约                  | 可写范围                                        |
| :-------------------------------------------- | :--------------- | :-------------------- | :---------------------------------------------- |
| `prototype/<issue>-<slug>` 或受管 local draft | `prototype`      | Issue AC 或 `DRAFT-*` | `apps/mindx/**`；必要的共享原子组件作为设计证据 |
| 开发者生产分支                                | `implementation` | Issue AC              | `apps/mindx/**` 与确有必要的共享层              |
| 用户确认的纯工程 UI 基建任务                  | `infrastructure` | `ENG-*`               | 明确 scope 内的共享 UI 工具、规则或文档         |

prototype 模式必须输出：

```text
[MindXRoute] route=ui-development status=MODE_SELECTED mode=prototype contract=<issue-ac|draft> target=apps/mindx
```

硬边界：

- prototype 与 implementation 都直接维护 `apps/mindx`，不得建立第二套 app 实现。
- Issue-bound 业务范围逐条来自 Issue AC；新增范围先由产品明确更新 Issue。
- local draft 可探索，但 promote 后必须以真实 Issue AC 替换 `DRAFT-*`。
- prototype 只在 transport 层模拟数据，不修改 `packages/core-data` 迁就 fixture。
- README 如存在，只能辅助代码导航，不能新增或覆盖 AC，也不是 handoff/CI 门禁。
- prototype 分享走 `prototype-deploy`，冻结走 `prototype-handoff`；永不创建 PR。

## 必读规范

开始实现前按改动范围阅读：

- [UI 开发规范](../../../docs/ui-development-spec.md)
- [原子组件准入清单](../../../docs/ui-components/atomic-component-criteria.md)
- [Page 内部结构规范](../../../docs/page-internal-structure.md)
- 涉及业务模型时：[业务模型规范](../../../docs/biz-model-spec.md)
- 涉及测试时：[单元测试规范](../../../docs/unit-test-spec.md)

所有代码改动同时走 `dev-workflow` 分档和 Code/Review/Test 协作。

## UI 开发流程

### Step 0：确定范围

明确本轮是 prototype、implementation 还是 infrastructure，以及涉及的 page、Hook、组件、
数据链路、PC/Mobile 和共享包。不得把一个模式的证据扩大成另一个模式的授权。

### Step 1：对齐可观察行为

- Issue-bound：逐条读取稳定 AC ID，列出页面状态、交互、边界态与非目标。
- local draft：使用本轮 `DRAFT-*` 目标，允许快速调整，但不把它当生产契约。
- infrastructure：只实现获确认的 `ENG-*` 工程目标，不引入产品语义。

范围变化必须回到契约确认，不写入 README 或本地说明来绕过。

### Step 2：规划业务模型

- prototype：复用现有 Record/wire contract，把最小假数据限制在 branch-local transport fixture。
- implementation：读取当前 `packages/core-data` 与真实 API，评估模型、迁移和兼容策略。
- infrastructure：不得借工程任务修改业务模型。
- 新实体不在源码中时，停止推断并回到 Issue 澄清；由研发在 implementation 设计中评估
  Record、接口、迁移和兼容方案。

### Step 3：准备数据边界

- prototype：fixture 只放 `apps/mindx/src/prototype/**`；页面和 Hook 继续走真实
  Record/request 路径；未知 MindX API fail closed。
- implementation：使用真实 Record/API；测试桩只存在测试文件。
- Page 和 UI 组件不直接 import fixture，不直接请求业务数据。

### Step 3a：组件落点决策

写任何组件前先读取
[原子组件准入清单](../../../docs/ui-components/atomic-component-criteria.md)。

新增组件前输出：

```text
[ComponentPlacement] 组件名=<name>，目标路径=<path>，类型=<atomic|business|shadcn-add>，shadcn 检索结果=<已检索|不适用>
```

决策顺序：

1. 含 Agent、Workspace、SmartDoc、Memory 等业务语义 → 业务组件，进入 `apps/mindx`。
2. 不含业务语义 → 使用 shadcn Skill 执行检索；命中时走 shadcn add。
3. 未命中 → 按 atomic 条件 A–F 逐项审查；全过才可进入
   `packages/ui-components/src/components/<name>/`。
4. 业务组件在公共目录还是 page 私有目录，按
   [Page 内部结构规范](../../../docs/page-internal-structure.md)决定。

implementation / production 在 PR 描述保留自检和检索证据；prototype 不创建 PR，证据写入
本轮 Review 结果。

修改既有共享组件时按 atomic 文档 §3 判断。新增业务字段或业务化倒退时，停止修改共享组件，
把业务能力放回 `apps/mindx`。

### Step 4：组件开发

- 先写或更新交互/条件渲染测试，再实现组件。
- 组件只负责 Props 渲染与回调，不持有业务请求或导航副作用。
- 目录、命名、Props、import 与设计 token 遵循 `docs/ui-development-spec.md`。

### Step 5：Hook 与 parser

- Hook 承载数据读取、状态、事件和副作用；Page 不直接处理这些逻辑。
- 业务数据到 UI Props 的纯映射进入 `parsers/`。
- 单 page 能力放 page 私有目录；真实跨 page 复用前先提升到 `apps/mindx/src/` 公共目录。
- 禁止 import 另一个 page 的私有文件。

### Step 6：Page

- Page 只做 Hook 调用、必要的 Utils 调用和 JSX 拼装。
- `index.ts` 是 page 对外唯一出口。
- `@region` / `@hooks` / `@bizRegion` 用于代码导航，不与 README 做集合校验。
- README 可选；若更新，只记录技术导航，不复制需求或验收标准。

### Step 7：验证

按改动范围执行，不运行无关 app：

```bash
pnpm --filter @mindx/ui-components build
pnpm --filter @mindx/ui-components test
pnpm --filter @mindx/app-mindx test
pnpm typecheck
pnpm lint
```

- 只选择受影响的命令；缺少某个 package script 时使用仓库实际可用命令并记录原因。
- dev server 已运行时，检查它输出的实际 URL、模块缺失、白屏和 console error；不硬编码端口。
- prototype 额外运行 `prototype:build` / `prototype:verify` 并检查相对资产、manifest、
  fail-closed mock 与无真实副作用。
- implementation 验证真实数据行为、受影响边界态和无 prototype-only 文件。
- infrastructure 用 `ENG-*` 记录策略、静态检查和回归证据。

## 完成标准

- 契约中的每条 AC、DRAFT 或 ENG 都有实现与验证证据。
- 组件落点、跨 page 引用、数据职责与设计 token 符合三个权威规范。
- README 未被用作业务契约或门禁。
- 没有创建平行 app 实现、跨 app 同步义务或隐含验收标准。
