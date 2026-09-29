# UI 开发规范

> **流程优先级**：Issue AC 是唯一业务契约；正式产研协作遵循
> [`prototype-workflow.md`](./prototype-workflow.md) 与
> [`release-workflow.md`](./release-workflow.md)。
>
> **权威入口**：`packages/ui-components` 的写入边界只看
> [原子组件准入清单](./ui-components/atomic-component-criteria.md)；MindX page 的私有/公共
> 落点、唯一出口、跨 page import、代码导航注释和 parser 规则只看
> [Page 内部结构规范](./page-internal-structure.md)。本文件不复制这两类规则。

本规范适用于 `apps/mindx` 的页面、React Hooks 和业务组件，以及
`packages/ui-components` 的共享原子组件。

应用页面由三层构成：

- **Page**：定义页面骨架，调用 Hook 和组件完成布局。
- **React Hook**：承载业务数据、派生状态、事件与副作用。
- **UI Component**：根据 Props 渲染内容并通过回调暴露交互；业务组件位于
  `apps/mindx`，共享原子组件位于 `packages/ui-components`。

## 1. 设计系统

所有 UI 开发必须基于 **DesignMD Studio Design System**。

- 完整设计规范：`docs/Design/DESIGN.md`
- CSS Token：`packages/ui-components/src/styles/globals.css`
- AI 规则：`.codebuddy/rules/design-system-overview.mdc`、
  `.codebuddy/rules/tokens-usage.mdc`、`.codebuddy/rules/components-usage.mdc`

核心要求：

1. 颜色使用 CSS 变量或对应 Tailwind 工具类，禁止硬编码色值。
2. 间距来自 4px 基数的 spacing scale，禁止任意值。
3. 圆角来自 radius scale。
4. 组件样式遵循 `DESIGN.md`。
5. 设计系统未覆盖的处理添加 `/* DESIGN_FALLBACK: <原因> */` 注释。

设计 token 是全局联动入口。调整视觉体系时优先修改或复用 token，不逐个组件复制常量。

## 2. 业务模型与数据

需求涉及业务数据或模型时，必须完整阅读[业务模型规范](./biz-model-spec.md)。

1. 先核对 `packages/core-data` 的既有实体与字段能否满足 Issue AC。
2. 原型需要表达尚未落地的数据时，在 Issue 中记录状态与期望行为，并通过
   branch-local transport fixture 构造最小数据；不得修改 `packages/core-data` 伪造生产模型。
3. 研发实现阶段由开发者评估模型变更、真实接口和迁移策略。
4. 不在 Page 或组件中直接构造业务数据，也不建立 Issue AC 之外的第二份业务契约。

### 2.1 Prototype transport fixture

正式 prototype 只允许使用 `prototype:scaffold` 生成的 branch-local transport fixture：

- fixture 位于 `apps/mindx/src/prototype/**`，只存在于一次性 `prototype/**` 分支；
- Page、Hook 和组件仍通过真实 `RecordService` 或 request 路径取数，不直接 import fixture；
- endpoint 使用显式 allowlist，未知 MindX API fail closed，禁止用 `/**` 通配成功；
- static build 可将 fixture 打入前端 bundle，无需额外 mock server；
- production branch 禁止保留 prototype runtime 或 fixture。

### 2.2 数据职责

| 数据类型     | 归属                                 | 约束                               |
| :----------- | :----------------------------------- | :--------------------------------- |
| 业务数据     | Service / `@mindx/core-data` Record  | Hook 读取，Page 与组件不直接请求   |
| 纯交互状态   | 自定义 Hook 的 `useState` / `useRef` | 如 `visible`、`selected`、`active` |
| 页面静态配置 | 自定义 Hook 中的常量或 `useMemo`     | 如导航项、Tab 定义、固定文案       |
| 衍生数据     | parser 或 Hook                       | 通用纯逻辑可下沉到 `src/utils`     |

“业务数据 → UI Props”的映射必须遵循
[Page 内部结构规范的 Parser 规则](./page-internal-structure.md#6-parser-规则)。

## 3. UI Component 开发

在 Issue AC 与目标页面状态明确后，再开始组件开发。

组件可以是只负责展示的静态组件，也可以通过 Props 接收状态并暴露交互回调。
业务逻辑、数据请求、跨组件状态和导航副作用不放在组件内部。

### 3.1 基础组件与共享层准入

- 开发组件时加载 shadcn Skill，优先使用 shadcn 提供的基础组件。
- 只有 shadcn 不支持且满足六条准入时，才向 `packages/ui-components` 新增实现。
- 是否属于共享原子组件，唯一依据是
  [原子组件准入清单](./ui-components/atomic-component-criteria.md)。
- 包含 MindX 业务语义的组件留在 `apps/mindx`；其公共或 page 私有落点由
  [Page 内部结构规范](./page-internal-structure.md)决定。

### 3.2 Import 路径

`packages/ui-components` 是库包，会被应用源码和发布后的第三方消费：

- `packages/ui-components/src/**` 禁止使用 `@/*`、`~/*` 等路径别名。
- 库内 import 使用相对路径或 npm 包名。
- shadcn add 生成的 `~/lib/utils`、`~/components/ui/*` 等别名必须立即改为相对路径。
- `apps/mindx` 内可使用 `@/*` 引用本 app 源码。
- 跨包引用使用 `@mindx/ui-components`、`@mindx/core-data` 等 npm 包名，禁止相对路径穿透包边界。
- 依赖方向只能是 `apps/mindx` → `packages/*`；`packages/*` 不得反向 import app 代码。
- 业务模型类型统一从 `@mindx/core-data` 引入。

### 3.3 公共组件目录结构

本节适用于以下完整组件目录：

1. `packages/ui-components/src/components/<name>/` 的共享原子组件；
2. `apps/mindx/src/components/<name>/` 的公共业务组件。

Page 私有业务组件可以采用轻量结构，具体以
[Page 内部结构规范](./page-internal-structure.md)为准。

```text
<components-base>/
└── <component-name>/              # kebab-case
    ├── index.ts                   # 对外聚合导出
    ├── pc/
    │   ├── interface.ts           # Props 定义
    │   ├── <component-name>.tsx
    │   ├── <component-name>.less
    │   └── assets/                # 按需
    └── mobile/                    # 按需
        ├── interface.ts
        ├── <component-name>.tsx
        └── <component-name>.less
```

完整结构的约束：

1. 一个组件一个目录，测试和私有资源也归属于该目录。
2. `index.ts` 是对外入口，外部不直达 `pc/`、`mobile/` 内部文件。
3. Props 在 `interface.ts` 中定义，不内联在组件实现中。
4. PC 与 Mobile 分目录；默认只创建需求明确的 PC 实现。
5. 公共组件禁止以单个 `.tsx` 文件平铺在 `components/` 根目录。

### 3.4 命名

- 组件目录使用 kebab-case。
- `apps/mindx` 的业务组件名体现业务实体与职责，例如 `AgentInfoCardPC`。
- 满足原子准入的共享组件可以使用 `Button`、`Avatar` 等通用名。
- 组件名带 `PC` 或 `Mobile` 后缀区分端。
- CSS class 使用小写字母、数字和连字符，并带组件职责与端后缀，例如
  `.agent-card-wrapper-pc`。
- 内部元素采用 `{组件名}-{元素角色}-{端后缀}` 的扁平命名，避免依赖深层后代选择器。

```less
/* ✅ 扁平且具备组件前缀 */
.doc-search-box-input-pc {
}
.doc-search-box-icon-pc {
}

/* ❌ 依赖模糊的后代类名 */
.doc-search-box-wrapper-pc {
  .input {
  }
}
```

### 3.5 Props 设计

- 动态内容通过 props 传入，不在组件内获取业务数据。
- 交互通过 `onClick`、`onDelete`、`onSelect` 等 callback props 暴露。
- `apps/mindx` 的业务组件优先直接使用 `@mindx/core-data` 的枚举和字段类型。
- 禁止为了“扩展性”把已有业务枚举退化为裸 `string`；需要扩展时使用联合类型或泛型。
- `packages/ui-components` 的 Props 只表达视觉与交互意图，禁止依赖业务类型。

```tsx
import type { TRecordAgentStatus } from "@mindx/core-data";

type AgentPermission = `Read(${string})` | `Write(${string})`;

interface AgentInfoCardPropsPC {
  name: string;
  description: string;
  status: TRecordAgentStatus;
  permissions: AgentPermission[];
  onDelete?: () => void;
  onViewDetails?: () => void;
}
```

## 4. React Hooks

1. 一个 Page 可以调用多个自定义 Hook。
2. Page 中只允许直接使用 `useState`、`useRef`、`useContext`，且仅用于：
   - `useState`：无业务含义、无需跨组件共享的局部瞬时 UI 状态；
   - `useRef`：DOM 引用；
   - `useContext`：读取已有 Context，禁止在 Page 中创建 Provider。
3. `useEffect`、`useMemo`、`useCallback`、`useReducer`、事件处理、业务数据读取与派生
   必须进入自定义 Hook。
4. Hook 的公共或 page 私有落点遵循
   [Page 内部结构规范](./page-internal-structure.md)。
5. Hook 按功能或业务实体命名，禁止 `useXxxPage`；文件名与方法名对应，例如
   `use-agent.ts` → `useAgent()`。
6. Hook 遵循单一职责原则；通用纯逻辑可以抽取到 `src/utils`。

Hook 与 Page 的 `@bizRegion`、`@region`、`@hooks` 导航标记只在
[Page 内部结构规范](./page-internal-structure.md#5-page-代码导航注释)定义。

## 5. Page 开发

Page 是页面布局骨架。Page 的目录、私有能力落点、`index.ts` 唯一出口、跨 page import、
导航注释和可选 README 均以[Page 内部结构规范](./page-internal-structure.md)为准。

Page README 仅可作为技术导航；它不是产品契约、handoff 条件或 CI 门禁。

### 5.1 文件内容

Page 文件只包含：

- import 语句；
- 当前页面的静态常量定义，不包含业务数据或 fixture；
- `export function {PageName}() {}`。

Page 函数体只负责 Hook 调用、必要的 Utils 调用与 JSX 拼装。业务请求、派生计算、
事件函数和副作用进入 Hook；业务数据到 UI Props 的映射进入 parser。

### 5.2 JSX

JSX 只包含 HTML 布局标签、UI Component 和 ErrorBoundary、ContextProvider 等基础技术组件。
独立文案、图片、链接等内容应由组件承载。

JSX 中允许使用 `.map()` 渲染数组，但必须满足：

1. 回调体只返回 JSX 或 JSX 条件组合，不包含赋值、局部变量或额外计算。
2. 禁止在 JSX 中使用 `.filter()`、`.reduce()`、`.sort()`、`.flatMap()` 及其链式组合。
3. 回调参数只使用 `(item)` 或 `(item, index)`；字段计算提前在 Hook 或 parser 中完成。

```tsx
// ✅ Hook 已返回展示所需的数据
cards.map((card) => <AgentInfoCardPC key={card.id} {...card} />);

// ❌ 过滤和派生逻辑不应留在 JSX
cards.filter(isVisible).map((card) => <AgentInfoCardPC {...normalize(card)} />);
```

## 6. 测试

项目采用 TDD。UI 层测试粒度如下：

| 对象                       | 是否必须测试 | 理由                                                  |
| :------------------------- | :----------: | :---------------------------------------------------- |
| 自定义 Hook                |      ✅      | 承载数据读取、状态、事件和副作用                      |
| 有交互的 UI Component      |      ✅      | 覆盖点击、输入和受控 Props 变化                       |
| 纯静态 UI Component        |     可选     | 只透传 Props 且无分支时可不写；出现条件渲染后必须补测 |
| Page                       |      否      | Page 只做布局拼装；页面链路由端到端测试覆盖           |
| `src/utils` 纯函数         |      ✅      | 覆盖典型输入与边界值                                  |
| Service                    |      ✅      | 覆盖所有 public 方法的典型与异常路径                  |
| `packages/core-data` Model |      ✅      | 覆盖 public 属性、方法与 parse/serialize 等转换       |

测试实现必须遵循[单元测试规范](./unit-test-spec.md)。

## 7. 修订历史

| 日期       | 变更                                                               |
| :--------- | :----------------------------------------------------------------- |
| 2026-09-01 | 删除已退役概念环境的数据与双应用规则；收敛 atomic 与 Page 规范入口 |
