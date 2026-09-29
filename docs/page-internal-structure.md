# Page 内部结构规范

> **适用范围**：`apps/mindx/src/`。
>
> 本文件是 MindX page 内部结构、代码导航注释和业务 parser 落点的唯一规范入口。
> Page 私有能力默认放在 page 自己的目录；跨 page 复用前必须先提升到 app 公共目录。

## 1. 标准目录骨架

```text
apps/mindx/src/
├── hooks/                          # 公共 hooks：跨 page 复用或存量未拆分
├── components/                     # 公共业务组件：跨 page 复用
├── parsers/                        # 公共业务数据到 UI 的语义映射
├── utils/                          # 公共纯函数
└── pages/
    └── <xxx-page>/
        ├── index.ts                # 必须：page 对外唯一出口
        ├── pc.tsx                  # 必须
        ├── pc.less                 # 必须
        ├── mobile.tsx              # 按需
        ├── mobile.less             # 按需
        ├── README.md               # 可选：仅作为技术导航
        ├── hooks/                  # page 私有 hooks
        ├── components/             # page 私有业务组件
        └── parsers/                # page 私有业务语义映射
```

Page README 不是强制 schema、产品契约、代码反向锚点或交付门禁。已有 README 可以继续
说明模块边界、关键 Hook、Record 映射、技术限制和调试入口，但不要求与 `@region` 集合一致，
也不做 staleness 扫描。产品行为与验收以 Issue AC 为准。

## 2. 公共与私有落点

新增 hook、业务组件或 parser 前，按以下规则选择落点：

```text
准备新增 hook / 业务组件 / parser
  │
  ├─ 被两个及以上 page 使用，或被 page 之外的 app 入口使用？
  │    ├─ 是 → apps/mindx/src/{hooks|components|parsers}/
  │    └─ 否 → apps/mindx/src/pages/<xxx-page>/{hooks|components|parsers}/
  │
  └─ 无法确认 → 先放 page 私有目录，出现真实复用方后再提升
```

### 2.1 新增单 page 能力必须私有

只服务一个 page 的新 hook、业务组件和 parser，禁止直接放到 app 顶层公共目录。
从私有提升到公共目录有明确的复用证据；提前公共化会扩大 API 和依赖面。

### 2.2 业务组件与原子组件先分层

`packages/ui-components` 只接收符合
[原子组件准入清单](./ui-components/atomic-component-criteria.md)的共享原子组件。
包含 MindX 业务语义的组件先回到 `apps/mindx`，再由本文件决定放公共目录还是 page 私有目录。

## 3. 禁止跨 page 引用

任何 page 的代码都不得 import 另一个 page 目录下的文件，包括 hook、组件、parser、
工具函数、数据和类型定义。

```ts
// ❌ pages/agent-page/pc.tsx
import { useArtifactWorkspace } from "@/pages/workbuddy-page/hooks/use-artifact-workspace";

// ❌ pages/share-landing-page/pc.tsx
import type { Artifact } from "@/pages/workbuddy-page/parsers/parse-artifact";
```

需要复用时必须先执行提升：

1. 确认能力确实存在第二个消费 page。
2. 将文件从 page 私有目录物理移动到 `apps/mindx/src/{hooks|components|parsers|utils}/`。
3. 同步修正原 page 的 import。
4. 新消费方再从公共目录 import。

```ts
// ✅ 两个 page 都从 app 公共目录引用
import { useArtifactWorkspace } from "@/hooks/use-artifact-workspace";
import type { Artifact } from "@/parsers/parse-artifact";
```

唯一例外是 page 的 `index.ts`：路由等 app 基础设施可以从 page 入口导入，不能直达
`pc.tsx`、`mobile.tsx` 或子目录。

## 4. `index.ts` 是 page 对外唯一出口

每个 page 目录必须有 `index.ts`，由它聚合导出 PC 和按需存在的 Mobile 页面。

```ts
// pages/workbuddy-page/index.ts
export { WorkBuddyPagePC } from "./pc";
// export { WorkBuddyPageMobile } from "./mobile";
```

```ts
// ✅ routers/index.tsx
import { WorkBuddyPagePC } from "@/pages/workbuddy-page";

// ❌ 禁止绕过 page 入口
import { WorkBuddyPagePC } from "@/pages/workbuddy-page/pc";
```

## 5. Page 代码导航注释

注释用于从页面语义快速定位组件与 Hook，不承担需求、验收或 README 同步职责。

### 5.1 `@region` 与 `@hooks`

新增或修改 Page JSX 的主要业务区块时，使用相邻的 `@region` 与 `@hooks` 注释：

```text
{/* @region: 萃取胶囊面板（勾选/萃取/导入联动） */}
{/* @hooks: useExtractCapsule, useRawDataCapsuleFlow */}
<ExtractCapsulePC />
```

- `@region` 按产品语义区块划分，保持粗粒度；通常每页 5–10 个即可。
- 不按 DOM 嵌套拆分 region，也不要求每个基础原子组件都有独立 region。
- `@hooks` 列出支撑该区块的自定义 Hook；没有对应 Hook 时写 `none`。
- region 名不与 README 列表做集合相等校验，增删 region 也不要求同步 README。

### 5.2 `@bizRegion`

为承担页面业务能力的自定义 Hook 添加文件级 JSDoc，便于按业务区块反查：

```ts
/**
 * @bizRegion 萃取胶囊
 * @page raw-data-page
 * @relatedHooks useRawDataCapsuleFlow
 */
export function useExtractCapsule() {}
```

- `@bizRegion` 使用与 page `@region` 可对应的业务名称。
- `@page` 使用 page 目录名；公共 Hook 可列出多个实际消费 page。
- `@relatedHooks` 仅列真实协作 Hook，没有时可省略。
- 该标记服务代码检索和 Review，不与 README schema 绑定。

## 6. Parser 规则

“业务数据 → UI Props”的语义映射必须独立放到 `parsers/`，不得内联在 Hook 或 Page 中。
Parser 可以包含 `parseXxxRecord`、枚举到展示属性的映射、格式归一化等纯转换逻辑；
不得负责数据请求、订阅、导航或 UI 状态副作用。

- 只服务一个 page：`apps/mindx/src/pages/<xxx-page>/parsers/`。
- 被多个 page 使用：`apps/mindx/src/parsers/`。
- Hook 负责读取数据和编排交互，再调用 parser 获得 UI Props。
- Page 只消费 Hook 返回结果，不直接解析 Record。

```ts
// pages/raw-data-page/parsers/parse-source-record.ts
export function parseSourceRecord(record: RecordSource): SourceRowProps {
  return {
    id: record.id,
    title: record.title,
    sourceType: SOURCE_TYPE_LABEL[record.sourceType],
  };
}
```

## 7. 命名与提取规则

- Hook 文件使用 `use-<功能>.ts(x)`，方法名与文件名一致；禁止用 `useXxxPage` 组织业务能力。
- 公共业务组件遵循 [UI 开发规范](./ui-development-spec.md)的完整目录、命名和 Props 规则。
- Page 私有组件默认可用 `<name>.tsx` 与 `<name>.less` 的轻量平铺形态；稳定后或需要独立测试时，
  可以展开为完整组件目录。
- Page 私有组件不离开 page 目录时，无需额外 `index.ts`；page 本身仍必须有唯一入口 `index.ts`。
- 从 page 私有目录提升到公共目录时，使用 `git mv` 保留历史，并在同一变更中修正全部 import。
- 禁止复制一份到公共目录后保留私有副本，避免实现持续漂移。

## 8. 落地与审阅

- ESLint 的跨 page import 规则负责机械阻塞可判定的违规引用。
- Code Review Agent 负责识别别名、相对路径和类型引用中的跨 page 耦合。
- 不新增或恢复 Page README schema、region 集合校验、README staleness 扫描。
- 机器规则无法覆盖的目录落点与注释语义，由 Review 按本文件判断。

## 9. 修订历史

| 日期       | 变更                                                                         |
| :--------- | :--------------------------------------------------------------------------- |
| 2026-05-28 | 初版：明确 page 私有目录与禁止跨 page 引用                                   |
| 2026-09-01 | 收敛为 `apps/mindx` 权威入口；迁入注释/parser 规则；Page README 降为可选导航 |
