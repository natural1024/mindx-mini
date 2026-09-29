# Project Override — MindX

> **本文件为 MindX 仓库对 shadcn skill 的项目级覆盖规则。优先级高于 `SKILL.md` / `cli.md` / `rules/*`。**
> 在本仓库内执行任何 shadcn 相关操作前，必须先阅读并遵守本文件。

## 背景

`packages/ui-components` 是一个 **npm 库包**（`@mindx/ui-components`），通过 pnpm workspace 的 `exports.development` 条件被 `apps/mindx` 在 dev 模式下**直接消费源码**（无编译步骤）。

shadcn CLI 默认为 **应用（app）** 场景设计，其 `components.json` 中的 `aliases.*` 字段（如 `@/components`、`@/lib/utils`）会被写入到生成代码的 `import` 语句中。但这套路径别名在库包场景下无解：

- ✅ 库自身 `tsc` / `rspack build` 时可通过本地 `paths` / `alias` 解析
- ❌ 被 `apps/mindx` dev server 以源码形式消费时，应用 bundler 不认识库内部的 `@/*`
- ❌ 发布为 npm 包后，下游消费方的构建工具完全无法解析 `@/*`
- ❌ `tsc --emitDeclarationOnly` 生成的 `.d.ts` 不会改写 `@/*`，会毒化下游类型解析

因此本项目**物理禁用**了所有会让 `@/*`、`~/*` 等别名能解析的配置：

| 位置                                                          | 状态                       |
| ------------------------------------------------------------- | -------------------------- |
| `packages/ui-components/tsconfig.json` 的 `paths`             | ❌ 已删除                  |
| `packages/ui-components/tsconfig.build.json` 的 `paths`       | ❌ 已删除                  |
| `packages/ui-components/rspack.config.mjs` 的 `resolve.alias` | ❌ 已删除                  |
| `packages/ui-components/components.json` 的 `aliases` 前缀    | 使用 `~/*`（故意不可解析） |

## 强制规则

### 规则 1：禁止任何路径别名 import

在 `packages/ui-components/src/**` 下的所有源码文件中：

- ❌ 禁止 `from '@/...'`
- ❌ 禁止 `from '~/...'`
- ❌ 禁止任何基于 `tsconfig.paths` 或 `rspack.alias` 的路径别名
- ✅ 仅允许**相对路径**（`./xxx`、`../xxx`）
- ✅ 允许从 npm 包名导入（`react`、`@phosphor-icons/react`、`clsx` 等）

### 规则 2：`shadcn add` 之后必须立即后处理

执行 `npx shadcn@latest add <component>` 或 `pnpm dlx shadcn@latest add <component>` 时，生成的新文件会包含形如：

```ts
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
```

由于仓库 tsconfig/rspack 均未注册 `~` 前缀，这些 import 在 tsc typecheck 和 rspack 构建时**必然报错**。

**在提交任何代码前，你（AI）必须完成以下后处理**：

1. 识别本次 `shadcn add` 生成的所有新文件（shadcn CLI 的输出会列出路径）
2. 对每个新文件，将所有 `~/*` 形式的 import 改写为**相对当前文件**的相对路径
   - 参考 `components.json` 的 aliases 映射（`~/` → `packages/ui-components/src/`）做路径换算
   - 例如，文件 `packages/ui-components/src/components/ui/dialog.tsx` 内的 `from "~/lib/utils"` → `from "../../lib/utils"`
3. 运行 `pnpm typecheck`（或至少对 ui-components 子包跑 `pnpm --filter @mindx/ui-components typecheck`）验证无报错
4. 完成后方可进入后续流程（手动提交 / SOP / 其他）

### 规则 3：禁止"恢复"路径别名以绕过规则 2

如果在工作过程中发现 `~/*` / `@/*` 解析不了，**不允许**通过以下方式规避：

- ❌ 向 `tsconfig.json` / `tsconfig.build.json` 添加 `paths`
- ❌ 向 `rspack.config.mjs` 添加 `resolve.alias`
- ❌ 向 `apps/mindx` 的 rspack 配置添加映射到 ui-components 内部的别名
- ❌ 修改 `components.json` 的 aliases 换成一个"能解析"的前缀

这些做法会让库包发布后在下游失效，**必须**通过规则 2 的"改写为相对路径"来解决。

## 补充说明

### 为什么 `components.json` 还保留 aliases 字段？

shadcn 官方 JSON Schema 强制要求 `aliases` 必填（且 `utils` / `components` 子键必填）。完全移除会让 `shadcn add` / `shadcn init` / `shadcn info` 直接 schema 校验失败，无法使用 CLI。

使用 `~/*` 而非 `@/*` 的原因：`@/*` 在 `apps/mindx` 中真实存在并指向应用自身的 src，继续用 `@/*` 会与应用侧配置在心智上产生混淆；`~/*` 在本仓库内任何地方都没有注册，一旦出现在生成代码里就是明确的“AI 忘记后处理”信号。

### 与 `apps/mindx` 的关系

本规则**仅**约束 `packages/ui-components`。`apps/mindx` 作为应用端，继续使用自身的 `@/*` → `apps/mindx/src/*` 别名（在 tsconfig/rspack 中注册），不受本文件约束。
