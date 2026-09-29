---
name: i18n-expert
description: |
  国际化配置初始化，国际化词条补全。触发关键词：国际化、i8n、多语言、补全词条、词条遗漏、词条缺失、翻译补全
---

# 国际化词条补全专家

你是当前项目仓库的国际化词条补全专家，为新 packages / apps 初始化国际化配置，帮助开发者检查、补全代码中的国际化词条。

---

## 核心能力

- 为新 packages / apps 自动初始化国际化配置
- 识别代码中存在的中文文案，自动转化为国际化词条
- 检查代码中的国际化词条是否完整
- 识别空值词条和缺失的 key
- 自动补全翻译内容

---

## 校验与验证工具（`tools/script/`，三个词条包共用）

校验脚本本体收敛在仓库根 `tools/script/i18n-check.mjs` / `i18n-pseudo.mjs`（共享逻辑在 `tools/script/i18n-shared.mjs`），当前接入的词条包有三个：`apps/mindx`、`packages/ui-components`、`packages/import-kit`，各自 `package.json` 中的 `i18n:check` / `i18n:pseudo` 都是转调这两个共享脚本。**改动词条或外化文案后应先跑校验，不要靠肉眼判断。**

### `pnpm i18n:check` — 静态校验（改完必跑）

```bash
# 仓库根：一次校验全部三个词条包
pnpm i18n:check                                    # 有问题时退出码 1
pnpm --filter @mindx/ui-components run i18n:check  # 只校验单个包

# 或进入包目录单独跑
cd apps/mindx && pnpm i18n:check          # 有问题时退出码 1
cd apps/mindx && pnpm i18n:check --quiet  # 只输出问题
```

十二项检查：

| 检查项                                                                                | 为什么重要                                                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `$t()` 的 key 未登记到 zh-CN                                                          | i18next 未命中时**回落显示 key 本身（即中文原文）**，中文环境完全看不出异常，切语言才漏出中文                    |
| 各语言 key 集合与 zh-CN 不一致                                                        | 缺失/多余会导致部分语言漏翻                                                                                      |
| 词条文件重复 key                                                                      | `JSON.parse` 静默保留最后一个，**前面的条目莫名失效**（改了不生效的诡异 bug）                                    |
| 词条值为空                                                                            | 显示空白                                                                                                         |
| 插值变量 `{{var}}` 各语言不一致                                                       | 占位符原样显示或内容丢失                                                                                         |
| 模块级常量 / `useMemo([])` 缓存了 `$t()`，或模块级常量含裸中文未走 `$t()`             | 前者**加载时求值一次即固化**，运行中切换语言不生效；后者是完全没外化的中文，同样存在固化风险且更该优先修         |
| 与其它词条包同名 key 翻译内容冲突（跨 `mindx` / `ui-components` / `import-kit` 比对） | `$t()` 是跨包全局查找，先注册的包会"劫持"同名 key 的翻译结果——代码调用正确、词条也登记了，显示的却是别的包的翻译 |
| JSX 文本节点里的裸中文（未走 `$t()`）                                                 | 直接写在组件 `return` 的 JSX children 里的中文/全角标点（用 TS AST 精确识别 JsxText 节点），切语言时原样漏出中文 |
| `$t()` 用模板字符串 + `${...}` 做 JS 插值                                             | `${...}` 会在运行时拼进 key，导致 key 每次都不同、**永远无法命中词条**；应改用 i18next 的 `{{var}}` 插值语法     |
| 函数体内 / JSX 属性 / 普通赋值处的中文字符串字面量未走 `$t()`                         | 覆盖 `toast("操作成功")`、`placeholder="中文"` 等位置——pre-commit 只查 staged diff，全量扫描此前完全看不到       |
| `$t()` 调用点的插值传参与 key 声明不一致（漏传 / 多传）                               | 与「插值变量各语言不一致」互补：漏传会让 `{{var}}` 原样显示，多传被静默忽略（用 TS AST 解析调用点第二个参数）    |
| 硬编码 `zh-*` locale（`toLocaleDateString("zh-CN")` / `Intl.DateTimeFormat`）         | 英文环境仍显示中文日期格式（如 `2026年9月2日`）；应改用 `getCurrentLanguage()` 或省略 locale 参数跟随系统        |

个别检查项支持显式豁免：模块级常量/裸中文误报时，在声明行或其上一行加注释 `// i18n-check-ignore: <理由>` 可跳过该项检测（若命中行位于某个顶层 `const` 声明块内部，标记写在声明行即可豁免整块）；整份文件都不做 i18n 时，在文件内任意位置加 `// i18n-check-ignore-file: <理由>` 可跳过该文件全部源码扫描类检测。两者都要求写明理由，避免静默扩大白名单。这两个标记同时被本地 `.husky/pre-commit`（`check-i18n-literals.mjs`）识别，一条注释可同时满足本地提交校验与 CI 全量扫描。

### `pnpm i18n:pseudo` — 伪翻译（人工验证界面）

```bash
# 仓库根：一次性对三个词条包同时生成伪翻译（验证跨包拼接的界面必须这样跑）
pnpm i18n:pseudo                          # 默认改写 en-US
pnpm i18n:pseudo -- --expand              # 同时加长 40%，查布局溢出
pnpm i18n:pseudo -- --lang=zh-HK          # 改写指定语言
pnpm i18n:pseudo -- --restore             # 验完必须还原

# 或进入单个包目录只验证该包词条
cd apps/mindx && pnpm i18n:pseudo --restore
```

把目标语言词条的值包上标记（`Share` → `[[Share]]`），切到该语言后：

| 看到       | 含义                         |
| ---------- | ---------------------------- |
| `[[Text]]` | ✅ 走了 i18n                 |
| 裸中文     | ❌ 未 `$t` 包裹 / key 未登记 |
| 无括号英文 | ❌ 代码里硬编码的英文        |

价值是把"需要判断"变成"视觉扫括号"，无需对照设计稿或读代码，也能暴露半外化的拼接文案（`[[Saved to]] 微信`）。原文件自动备份为 `<词条文件>.orig`（已 gitignore），`--restore` 可完整还原；备份已存在时会拒绝重复生成，避免把带标记的值当基线二次改写。

**跨包验证提醒**：$t() 是跨包全局查找，同一界面上的文案可能来自三个词条包中的任意一个。只对单包跑伪翻译，界面上仍会有一部分文案显示正常中文/英文（因为来自未处理的包），容易误判为"没问题"——**要完整验证一个界面，必须在仓库根跑 `pnpm i18n:pseudo`（三包一起处理）**，验证完同样在仓库根跑 `pnpm i18n:pseudo -- --restore` 一次性还原。

### 两者的分工（不能互相替代）

- **伪翻译**抓「没走 i18n」，但**抓不到语言固化**——页面初始即为目标语言时，固化的常量取到的就是带标记的值，显示正常。
- 固化问题靠 `i18n:check` 静态检出，或**不刷新页面切换语言**（固化的文案会卡住不变）来验证。
- **`i18n:check` 独有、伪翻译测不出的问题**：词条文件重复 key、插值变量不一致、跨包同名 key 翻译冲突——这三类问题不影响"是否显示正常文案"，伪翻译肉眼看不出异常，必须靠 `i18n:check` 静态扫描。

### 自动化现状（四层闸门，已闭环）

- **编码阶段（主动，不依赖用户提关键词）**：`.codebuddy/rules/i18n-coverage-route.mdc`（alwaysApply）强制 AI 在 `apps/mindx/src/**`、`packages/ui-components/src/**`、`packages/import-kit/src/**` 下新增用户可见中文文案时，必须先按本 skill 的 key 规范 `$t()` 包裹并在对应包 `src/locales/` 下**当前支持的全部语言**词条文件中登记同一 key（见「支持的语言」），无需用户显式提"国际化"/"多语言"关键词。
- **Review 阶段**：`.codebuddy/agents/code-review-agent.md` 的 `i18n-coverage` 审阅类别兜底检查新增中文文案是否已处理。
- **commit 阶段（本地兜底）**：`.husky/pre-commit` 里的 `scripts/workflow/check-i18n-literals.mjs`——只检查 staged diff 中新增的中文字符串字面量是否被 `$t()` 包裹，**不检查**词条文件本身是否完整、一致、有无固化风险；识别与 CI 全量扫描相同的 `i18n-check-ignore` / `i18n-check-ignore-file` 豁免标记，同一条注释两处都生效。
- **CI 阶段（最终兜底）**：`pnpm i18n:check` 已接入 `.cnb.yml`「MindX PR checks」job（`scripts/workflow/check-i18n-consistency.mjs`），对三个词条包做全量一致性校验（重复 key、空值、插值不一致、语言固化、跨包同名 key 冲突等 check-i18n-literals 抓不到的问题），失败硬阻断 PR 合并；确有紧急场景可在 commit body 追加一行 `[skip-i18n]: <说明>` 显式豁免，CI 会把失败降级为醒目告警放行而非静默通过。
- **不接入 `.husky/pre-push`**：开发者本地 push 会直接跳过全部本地检查（含 typecheck/lint/test），完整校验统一由 CNB PR 流水线兜底，因此 i18n:check 只加在 CI 层才有实际拦截效果。
- 补全词条后仍建议手动跑一次 `pnpm i18n:check` 自检，尽早发现问题，不必等到 CI 才暴露。

---

## 关键陷阱：模块级常量会固化语言

**这是本仓库反复出现过的问题（曾累计修复 20+ 处），写代码时必须避开。**

```ts
// ❌ 错误：模块加载时 $t() 只求值一次，之后切语言文案不再更新
const PERMISSION_OPTIONS = [{ value: "manage", label: $t("可管理") }];

// ✅ 正确：改成函数，在调用时求值
function getPermissionOptions() {
  return [{ value: "manage", label: $t("可管理") }];
}
```

同类形态还包括：

- `const XXX_LABELS = { a: $t("...") }` 映射表
- `useMemo(() => ({ label: $t("...") }), [])` —— 空依赖把结果缓存住了
- 注意 `useCallback(() => { toast($t("...")); }, [])` **是安全的**：`$t` 在函数体内，只有回调被调用时才执行

补齐规则：**给常量补 `$t()` 时必须同时改成函数**，否则只是把「没做 i18n」变成「做了但固化」。

---

## 国际化规范

### 支持的语言

支持的语言**可扩展**，以各词条包 `src/locales/` 目录下实际存在的语言子目录为准（新增语言 = 新增一个语言目录 + 在 `index.ts` 接入，无需改校验脚本）。当前已支持：

| 语言代码 | 说明                 |
| -------- | -------------------- |
| `zh-CN`  | 简体中文（基准语言） |
| `zh-HK`  | 繁体中文             |
| `en-US`  | 英文                 |
| `id-ID`  | 印尼语               |
| `pt-BR`  | 葡萄牙语（巴西）     |

> ⚠️ 补词条 / 初始化新包时，**必须覆盖 `src/locales/` 下当前存在的全部语言目录**，而非固定三种。基准语言恒为 `zh-CN`（key 与其它语言对齐的基准）。新增语言标识还需在 `packages/i18n/src/index.ts` 的 `Language` 枚举与 `languageMap` 登记别名，并在 `apps/mindx/src/utils/locale.ts` 的 `normalizeLocale` 前缀映射表放行，宿主下发对应 locale 才能切换生效。

### 词条文件位置

每个 package / app 的词条文件收敛在各自的 `src/locales` 目录下，**每种支持的语言一个子目录**（子目录集合以该包实际存在的为准，见上文「支持的语言」）。以当前语言集合为例：

```
packages/example-pkg/src/locales/
  |-- zh-CN/
  |   |-- sc-data.json
  |-- zh-HK/
  |   |-- sc-data.json
  |-- en-US/
  |   |-- sc-data.json
  |-- id-ID/
  |   |-- sc-data.json
  |-- pt-BR/
  |   |-- sc-data.json
  |-- index.ts

apps/example-app/src/locales/
  |-- zh-CN/
  |   |-- example-app.json
  |-- zh-HK/
  |   |-- example-app.json
  |-- en-US/
  |   |-- example-app.json
  |-- id-ID/
  |   |-- example-app.json
  |-- pt-BR/
  |   |-- example-app.json
  |-- index.ts
```

### 国际化词条 key 规范

- key 使用**简体中文原文**
- value 对应各语言的翻译

示例：

zh-CN/sc-data.json

```json
{
  "保存成功": "保存成功"
}
```

zh-HK/sc-data.json

```json
{
  "保存成功": "儲存成功"
}
```

en-US/sc-data.json

```json
{
  "保存成功": "Saved successfully"
}
```

### 词条补全原则

- 插值使用 `{{变量名}}` 格式
- 不要添加空值词条
- 英文翻译词条，首字母应该大写
- 繁体中文翻译词条，请逐字转换为繁体中文对应的汉字，不需要意译

### 国际化词条函数

统一从 `@mindx/i18n` 包中导入 `$t` 函数：

```typescript
import { $t } from "@mindx/i18n";
```

调用方式：

```typescript
$t("保存成功");
```

---

## 新 package / app 国际化初始化

当用户要求为某个 package / app 添加国际化文案时，如果该目录下**尚未存在** `src/i18n/index.ts`，则需要**首先自动初始化国际化配置**，步骤如下：

### 第一步：创建 `src/i18n/index.ts`

在对应子包目录下新建 `src/i18n/index.ts`，内容如下（将 `{app-or-package-name}` 替换为当前子包的实际名称）：

```ts
import resource from "../locales";
import { loadResources } from "@mindx/i18n";

loadResources("mindx-{app-or-package-name}", resource);
```

例如，以 `packages/ui-components` 为例：

```ts
import resource from "../locales";
import { loadResources } from "@mindx/i18n";

loadResources("mindx-ui-components", resource);
```

### 第二步：创建各语言词条目录和 JSON 文件

在 `src/locales/` 下为**当前支持的每种语言**各建一个语言目录（语言集合见上文「支持的语言」，以其它已接入词条包的 `src/locales/` 目录为准），每个目录下新建 `{app-or-package-name}.json`（初始为空对象）。以当前语言集合为例：

```
src/locales/
  |-- zh-CN/
  |   |-- {app-or-package-name}.json   （内容：{}）
  |-- zh-HK/
  |   |-- {app-or-package-name}.json   （内容：{}）
  |-- en-US/
  |   |-- {app-or-package-name}.json   （内容：{}）
  |-- id-ID/
  |   |-- {app-or-package-name}.json   （内容：{}）
  |-- pt-BR/
      |-- {app-or-package-name}.json   （内容：{}）
```

### 第三步：创建 `src/locales/index.ts`

为每种语言 import 对应 json，并在导出对象中登记同名语言键（下例覆盖当前语言集合；实际以第二步创建的语言目录为准，新增语言时同步增列）：

```ts
import enUS from "./en-US/{app-or-package-name}.json";
import idID from "./id-ID/{app-or-package-name}.json";
import ptBR from "./pt-BR/{app-or-package-name}.json";
import zhCN from "./zh-CN/{app-or-package-name}.json";
import zhHK from "./zh-HK/{app-or-package-name}.json";

// 注意：命名空间 key 必须与第一步 loadResources 的第一个参数完全一致（均带 mindx- 前缀）
export default {
  "en-US": {
    "mindx-{app-or-package-name}": enUS,
  },
  "zh-CN": {
    "mindx-{app-or-package-name}": zhCN,
  },
  "zh-HK": {
    "mindx-{app-or-package-name}": zhHK,
  },
  "id-ID": {
    "mindx-{app-or-package-name}": idID,
  },
  "pt-BR": {
    "mindx-{app-or-package-name}": ptBR,
  },
};
```

初始化完成后，继续执行词条补全任务。

---

## 工作流程

### 第一步：确定要检查的代码文件范围

通过以下方式确定代码文件：

1. 用户明确指定代码文件路径
2. 从 git staged 文件中提取变更的代码文件
3. 从用户指定的 git commit 中提取变更的代码文件
4. 检查当前打开的文件

### 第二步：检查是否已初始化国际化配置

检查目标 package / app 下是否存在 `src/i18n/index.ts`：

- 若**不存在**，先执行「新 package / app 国际化初始化」流程
- 若**已存在**，直接进入词条检查

### 第三步：检查代码文件是否包含词条

1. 读取代码文件内容
2. 检查代码文件是否包含*中文文案*或*国际化函数调用*：
   - 检查未使用国际化函数包裹的中文文案，包括 TSX 中的文本节点和 TypeScript 中的字符串字面量
   - 检查使用国际化函数包裹的中文文案，提取出文案内容
   - 注意：注释中的中文文案不检查、明确使用 eslint-disable 关闭检查的文案不检查
3. 如果代码文件不包含中文文案或国际化函数调用，则不检查国际化词条
4. 如果代码文件包含国际化函数调用，则检查国际化词条文件是否包含该文案对应的 key（检查中文文案对应的 key 是否存在且不为空值）

### 第四步：识别问题

检查以下问题：

| 问题类型           | 检查方式                                     | 严重程度 |
| ------------------ | -------------------------------------------- | -------- |
| 缺失国际化函数调用 | 代码中的中文文案未使用国际化函数 `$t()` 包裹 | 🔴 严重  |
| 缺失 key           | 任意词条文件中缺失相关 key                   | 🔴 严重  |
| 空值词条           | value 为空字符串 `""`                        | 🔴 严重  |

### 第五步：补全翻译

根据 zh-CN 的词条内容，用 AI 直接生成其它语言的翻译，覆盖当前 `src/locales/` 目录下**支持的全部语言**（语言集合以目录实际存在为准，见上文「支持的语言」）。新增语言时同样由 AI 直接翻译写入词条。

**翻译规则（示例：zh-HK / en-US）**：

| 原文（zh-CN） | 繁体（zh-HK） | 英文（en-US） |
| ------------- | ------------- | ------------- |
| 文档          | 文檔          | Document      |
| 保存          | 儲存          | Save          |
| 取消          | 取消          | Cancel        |
| 确认          | 確認          | Confirm       |
| 删除          | 刪除          | Delete        |
| 复制          | 複製          | Copy          |
| 分享          | 分享          | Share         |
| 导出          | 匯出          | Export        |
| 导入          | 匯入          | Import        |
| 下载          | 下載          | Download      |
| 上传          | 上傳          | Upload        |
| 编辑          | 編輯          | Edit          |
| 查看          | 查看          | View          |
| 搜索          | 搜尋          | Search        |
| 设置          | 設定          | Settings      |
| 权限          | 權限          | Permission    |

**插值变量处理**：

- 保持 `{{变量名}}` 格式不变
- 只翻译变量周围的文本

```json
// zh-CN
{ "共 {{count}} 项": "共 {{count}} 项" }

// zh-HK
{ "共 {{count}} 项": "共 {{count}} 項" }

// en-US
{ "共 {{count}} 项": "{{count}} items" }
```

### 第六步：生成修复代码

1. 直接修改词条文件，写入补全后的翻译内容
2. 如果文案未使用 `$t()` 函数包裹，则导入对应的国际化函数，并使用 `$t()` 包裹文案，同时传入正确的 key

---

## 输出格式

### 问题报告格式

```markdown
## 国际化词条检查报告

### ❌ {package-or-app-name}

#### 缺失的 Key

| 语言  | 中文文案        | Key             |
| ----- | --------------- | --------------- |
| en-US | 保存成功        | 保存成功        |
| zh-HK | 共 {{count}} 项 | 共 {{count}} 项 |
```

### 修复后确认格式

```markdown
## ✅ 词条补全完成

已为 **{package-or-app-name}** 补全以下词条：

### en-US/{package-or-app-name}.json

| Key             | 中文文案        | 翻译               |
| --------------- | --------------- | ------------------ |
| 保存成功        | 保存成功        | Saved successfully |
| 共 {{count}} 项 | 共 {{count}} 项 | {{count}} items    |

### zh-HK/{package-or-app-name}.json

| Key             | 中文文案        | 翻译            |
| --------------- | --------------- | --------------- |
| 保存成功        | 保存成功        | 儲存成功        |
| 共 {{count}} 项 | 共 {{count}} 项 | 共 {{count}} 項 |
```
