---
name: add-custom-icon
description: |
  将自定义 SVG 图标添加到 ui-components 图标库的完整流水线。包括：放入 SVG 源文件 → 运行转换脚本生成 TSX 组件 → 在 icon-catalog.ts 注册元数据 → 在 icon-adapter.ts 注册组件映射。适用于设计师提供新 SVG 图标或开发者需要添加自定义图标的场景。
  触发关键词："添加图标"、"新增图标"、"注册图标"、"加个图标"、"导入 SVG 图标"、"icon 注册"、"add icon"。
---

# 添加自定义 SVG 图标流程

## 图标架构概览

项目使用 **Catalog → Adapter → Component** 三层架构：

```
Layer 1 (数据层):  icon-catalog.ts       — 图标元数据注册表（名称、分类、描述、别名）
Layer 2 (适配层):  icon-adapter.ts        — 语义名 → 实际 React 组件映射
Layer 3 (消费层):  icons/index.tsx        — <Icon name="xxx" /> 统一入口
```

业务代码只使用 `<Icon name="xxx" />` 消费，不直接引用具体组件。

## 添加上游 SVG 文件的完整步骤

按顺序操作 **4 个位置**：

### 步骤 1：放入 SVG 源文件

将 `.svg` 文件放入：

```
packages/ui-components/src/icons/custom-svg/<name>.svg
```

命名规则：

- 使用 **kebab-case**（如 `my-icon.svg`、`pdf-solid.svg`）
- 名称应描述图标的语义用途，而非外观
- SVG 中避免使用 `fill="white"` / `stroke="black"` 等硬编码色值——脚本会自动转为 `currentColor`

### 步骤 2：运行转换脚本生成 TSX 组件

```bash
# 转换指定图标
node packages/ui-components/scripts/convert-svg-to-icon.mjs <name>

# 转换全部 custom-svg 下的图标
node packages/ui-components/scripts/convert-svg-to-icon.mjs

# 预览模式（不写入文件）
node packages/ui-components/scripts/convert-svg-to-icon.mjs <name> --dry-run
```

脚本的行为：

- 读取 `custom-svg/<name>.svg`
- 提取 viewBox、内部 SVG 元素
- 将 `fill="white"/"#000"` / `stroke="white"/"#000"` 替换为 `currentColor`
- 将 SVG 属性转为 React camelCase（如 `fill-rule` → `fillRule`）
- 生成 `custom/<name>.tsx`，函数名为 `{PascalCase}Icon`
- 忽略 `fill-opacity` 属性
- 自动调用 prettier 格式化输出

生成的 TSX 组件模板：

```tsx
import type { IconComponentProps } from "../icon-adapter";

export function MyIcon({ size = 20, className, ...props }: IconComponentProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {/* SVG 子元素 */}
    </svg>
  );
}
```

### 步骤 3：在 `icon-catalog.ts` 注册元数据

文件路径：`packages/ui-components/src/icons/icon-catalog.ts`

在对应分类下添加 `IconMeta` 条目。分类选择：

| 分类         | 用途                                   |
| :----------- | :------------------------------------- |
| `action`     | 操作类：close, edit, delete, copy      |
| `navigation` | 导航类：back, forward, expand          |
| `status`     | 状态类：info, warning, success, error  |
| `content`    | 内容类型：document, file, image, audio |
| `identity`   | 身份类：user, agent                    |
| `misc`       | 其他                                   |

注册模板：

```ts
"my-icon": {
  name: "my-icon",
  category: "content",
  description: "我的图标描述",
  aliases: ["alias1", "alias2"],
  sizeToken: "md",
},
```

- `name`：kebab-case，与 SVG 文件名对应
- `aliases`：搜索时可以通过别名命中
- `sizeToken`：推荐尺寸，`"sm"`(16px) / `"md"`(20px) / `"lg"`(24px)

### 步骤 4：在 `icon-adapter.ts` 注册组件映射

文件路径：`packages/ui-components/src/icons/icon-adapter.ts`

**4a.** 在文件顶部 import 区添加导入（按字母序插入 `custom/` 导入区块）：

```ts
import { MyIcon } from "./custom/my-icon";
```

**4b.** 在 `iconComponents` 对象中添加映射（按字母序插入对应分类区块）：

```ts
"my-icon": MyIcon,
```

### 步骤 5：验证

类型安全：`icon-catalog.ts` 导出的 `IconName` 类型从 `iconCatalog` 的 key 自动推导，`icon-adapter.ts` 的 `iconComponents` 的 key 与之一致时，TypeScript 不会报错。

完成后即可在业务代码中通过 `<Icon name="my-icon" />` 使用。

## 补充：从 TSX 反向导出 SVG

当需要将已转换的 TSX 组件重新导出为独立 `.svg` 文件时：

```bash
# 导出全部
node packages/ui-components/scripts/export-custom-icons.mjs

# 导出指定图标
node packages/ui-components/scripts/export-custom-icons.mjs my-icon
```

输出到 `custom-svg/` 目录，覆盖已有文件。

## 非 SVG 来源的图标

如果图标不是从 SVG 转换而来（如手写的特殊组件 `web-page-icon.tsx`），跳过步骤 1-2：

1. 在 `custom/` 下手写 TSX 组件，实现 `IconComponentProps` 接口
2. 执行步骤 3（catalog 注册）
3. 执行步骤 4（adapter 注册）

## 注意事项

- 新图标建议优先使用 `currentColor` 继承父元素颜色，不要硬编码色值
- `<Icon>` 组件不支持 `@phosphor-icons/react` 的 `weight` 属性——自定义图标尺寸固定
- viewBox 建议使用 `0 0 24 24`（24px 网格），与设计系统对齐
- 若 SVG 中包含 JSX 模板表达式（`{...}`），转换脚本会自动跳过，需手写 TSX
