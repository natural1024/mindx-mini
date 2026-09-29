# 业务模型规范

Issue AC 是业务需求的唯一契约。生产业务模型的真相源是
`packages/core-data/src/models/`；prototype 只能在
`apps/mindx/src/prototype/**` 的 transport fixture 中构造满足本轮验证所需的最小数据，不能为适配
fixture 修改生产模型。

若需求中的实体或字段在当前源码中不存在，先回到 Issue 澄清业务语义、可观察行为和兼容要求；研发在
implementation 设计中评估 Record、接口、迁移与兼容方案。不得在文档或 prototype 中另建一份模型契约。

MindX 需要持久化、协同和同步的业务数据基于 Record / Block 体系：

```text
生产业务模型 = Record + Block
```

纯交互状态、页面静态配置、衍生展示值、第三方平台临时数据、编辑器内部态和接口聚合响应不属于生产业务模型，
按本文后续边界处理。

## 业务模型代码构成

生产业务模型位于 `packages/core-data/src/models/`，源于 `RecordBase` 和 `BlockBase`。具体模型文件同时包含：

1. 接口定义；
2. 类实现。

涉及业务数据 CRUD 前，必须读取 `packages/core-data` 中相应模型的完整类型与实现，不能依据页面局部类型反推
生产 schema。

## Record

Record 是业务实体在前端的持久化表示。Record 接口继承 `IRecordValue`，实现类继承 `RecordBase`。公共字段以
`models/record-base.ts` 的当前实现为准，下面仅展示结构：

```ts
interface IRecordValue {
  id: string;
  spaceId: string;
  version: number;
  enabled: boolean;
  table: RecordTable;
  parentId?: string;
  parentTable?: RecordTable;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}
```

约定：

- 完整 Record 种类从 `models/records/` 读取；
- 接口命名为 `IRecordXxx`，实现类命名为 `RecordXxx`，例如 `IRecordAgent` / `RecordAgent`；
- 字段的可选性、枚举和默认值以生产模型与服务端契约为准，不从 UI 示例或 fixture 推断。

### Record.id：由客户端生成

所有 Record（包括 Block）的 `id` 都由客户端创建时生成，服务端不生成、不分配、不替换。这里的客户端包括
MindX 前端、外部 Agent，以及所有通过 MCP / Skill 写入 MindX 的第三方调用方。

统一使用 `@mindx/core-data` 导出的 `uniqueRecordId()`：

```ts
import { uniqueRecordId } from "@mindx/core-data";

const id = uniqueRecordId();
```

客户端生成 ID 是离线写入、多端并发和本地 op 链即时引用的前提。典型用法：

```ts
// 子 Record：RecordBase.create 内部生成 id
await page.create<NodeBlock>({ table: "block", type: "node", ... });

// 顶层 Record：显式传入 id
await recordService.op.batch(
  (tx) =>
    tx.create({
      table: "space",
      id: uniqueRecordId(),
      spaceId: "",
      enabled: true,
      name: "新空间",
      nodes: [],
      meta: {},
    } as never),
  { spaceId: recordService.mySpace.id },
);
```

禁止：

- 创建时留空 `id` 并等待服务端回填；
- 先通过 HTTP 请求向服务端申请 ID；
- 用 UUID、时间戳或自增数字替代 `uniqueRecordId()`。

遇到“POST 创建后等待服务端返回 ID，再继续后续逻辑”的实现，应改为本地生成 ID 的 op 模式。

## Block

Block 是特殊的 Record。接口继承 `IRecordValue`，实现类继承 `BlockBase`，公共结构以
`models/block-base.ts` 和 `models/blocks/` 当前实现为准：

```ts
interface IBlock extends IRecordValue {
  type: string;
  props?: IBlockProps;
  children?: string[];
  discussions?: string[];
  permissions?: IPermission[];
}
```

- `type`：必填；每种 Block 使用稳定、唯一的类型标识。
- `props`：可选；持久化时是序列化 JSON，字段必须读取具体 Block 类型定义。
- `children`：可选；通过子 Block ID 构造树形文档结构。
- `discussions`：可选；关联评论记录。
- `permissions`：可选；主要表达 NodeBlock 等页面级对象的权限角色。

处理 Block 数据或逻辑时，必须先读取 `models/blocks/` 下对应类型，不能只依据渲染组件猜测字段。
新增 Block 业务属性必须扩展具体 Block 的 `props` 类型，禁止直接扩展 Block 顶层字段；顶层结构与编辑器的
序列化、协同和渲染协议耦合。

## 生产模型变更流程

1. 在 Issue AC 中明确实体语义、可观察行为、数据来源和兼容要求。
2. 读取现有 `RecordTable`、Record / Block 类型、服务端接口与调用方。
3. 判断需求属于新增实体、扩展既有字段、接口聚合视图，还是仅 UI 状态。
4. 由研发在 implementation 设计中确定 schema、接口、迁移、默认值和兼容策略。
5. 修改 `packages/core-data` 后，更新真实调用方及相应测试；不得把 prototype fixture 当成生产 schema 证据。

生产字段使用 camelCase 和已有业务术语；状态、类型等有限集合优先使用字符串字面量联合类型，不使用无法约束
取值的裸 `string`。修改既有字段的类型或可选性时，必须同时评估历史数据迁移、序列化与所有调用方兼容。

## UI 数据分类

### 业务数据

需要由 MindX 持久化、同步或协同的数据，使用当前生产 Record / Block 模型表达。

### 纯交互数据

组件渲染或交互状态，例如 `visible`、`active`、`selected`、`disabled`、`current`。这些状态属于前端逻辑，
服务端不应感知，也不应为其新增 Record 字段。

### 页面静态配置

固定菜单项、Tab、文案和不需要个性化存储的功能区配置。它们留在代码中，不进入 Record / Block。

### 衍生数据

由业务数据计算出的展示值，例如：

1. 根据 `RecordMemory.category` 选择图标；
2. 将 `createdAt` 格式化为展示文本；
3. 由多个业务字段计算指标。

衍生值在 parser、selector 或运行时计算，除非 Issue 和生产模型明确要求持久化，否则不写回业务模型。

## 不纳入 Record / Block 的数据类别

### 外部平台数据

腾讯文档、Google Drive、Notion 等第三方资源列表、选择器数据和导入候选不由 MindX 持有。用户完成选择后，
才可能转换为 MindX 自己的 Record。字段由第三方接口决定，不纳入 `packages/core-data`。

### 编辑器内部态

`@tencent/smart-doc-editor` / `@tencent/smart-engine` 管理的版本历史列表、Presence、评论聚合和发布配置等，
由编辑器维护生命周期。虽然 NodeBlock 自身可能包含 `discussions` / `permissions`，一次性拉取的协作者或版本
列表仍是接口视图，不是新的 Record。

### 接口聚合视图

HTTP 响应顶层可以包含多个 Record / Block 数组、分页游标和接口元信息，例如：

```ts
type AgentListResponse = {
  records: IRecordAgent[];
  hasMore: boolean;
  nextCursor?: string;
};
```

响应对象不是单条 Record。它的类型应与接口定义放在一起；内部真正需要持久化的实体继续使用生产 Record /
Block 类型。

## Prototype 数据边界

prototype 可在 `apps/mindx/src/prototype/**` 的 transport 层为既有 wire contract 提供最小 fixture，用于验证
Issue AC 的界面与交互。fixture 不得：

- 修改或扩写生产 Record / Block 契约；
- 逃逸到 production bundle 或触发真实副作用；
- 被 implementation 直接复制为生产模型；
- 替代 Issue 中对未知实体、迁移和兼容要求的澄清。
