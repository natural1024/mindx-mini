# SDK Token 映射参考文档

> ⚠️ 本文件是辅助参考，非权威源。SDK Token 的权威定义始终是 `node_modules/@tencent/smart-doc-editor/dist/view/theme/tokens/` 中的实际文件。
> AI 在执行 skill Phase 1 时应实时读取 SDK 源文件和项目 theme 目录对比，不依赖本文档中的具体值。

## 版本信息

- SDK 包名：`@tencent/smart-doc-editor`
- 版本声明位置：`pnpm-workspace.yaml` → `catalog` 字段
- 使用方式：`apps/mindx/package.json` 中引用 `"catalog:"`

---

## 文件职责对照

| 项目文件                 | 对应 SDK 路径                            | 职责                                              |
| :----------------------- | :--------------------------------------- | :------------------------------------------------ |
| `tokens/colors.less`     | `dist/view/theme/tokens/colors.less`     | 颜色/阴影 Token，桥接 `--sc-*` → MindX `var(--*)` |
| `tokens/spacing.less`    | `dist/view/theme/tokens/spacing.less`    | 圆角/间距 Token                                   |
| `tokens/typography.less` | `dist/view/theme/tokens/typography.less` | 字体/排版 Token                                   |
| `tokens/dark-theme.less` | `dist/view/theme/tokens/dark-theme.less` | 深色主题桥接                                      |
| `theme-config.ts`        | SDK JS API (`createTheme`)               | 通过 JS 注入 spacing + typography 配置            |
| `overrides.less`         | 无对应（最后手段）                       | SDK 无 Token 时的 `!important` 覆盖               |

---

## 优先级说明

```
JS Theme (theme-config.ts)  >  CSS Token (tokens/*.less)  >  SDK 默认值
                                                             >  overrides.less (!important)
```

- `theme-config.ts` 中的 `spacing` 和 `typography` 通过 SDK JS API 注入，优先级**高于** CSS Token
- `tokens/*.less` 中的变量覆盖在 CSS 层面覆盖 SDK 默认值
- `overrides.less` 用 `!important` 强制覆盖 SDK 内联/默认样式，**仅用于 SDK 无 Token 的场景**

### 修改策略决策顺序

1. **优先**：找到对应的 `--sc-*` Token，在 `tokens/*.less` 中覆盖值
2. **次选**：属于 spacing/typography 类 → 在 `theme-config.ts` 中通过 JS 配置
3. **最后手段**：SDK 无 Token 且无 JS API → 在 `overrides.less` 中用 `!important` 覆盖，并标注原因
4. **反馈不可实现**：SDK 内部结构过于耦合，覆盖会引发副作用 → 记录到反馈清单

---

## 作用域

所有 Token 覆盖都在 `.ds-editor-style-preview` 类名下生效，不会泄漏到其他编辑器实例。

---

## SDK 升级对照流程

1. 更新 `pnpm-workspace.yaml` 中的版本号
2. 运行 `pnpm install` 拉取新版
3. 对比 `node_modules/@tencent/smart-doc-editor/dist/view/theme/tokens/` 与 `theme/tokens/` 各文件
4. 关注：新增 Token、废弃 Token、默认值变更
5. 同步修改 theme 目录对应文件
