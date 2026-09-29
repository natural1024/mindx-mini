# i18n 工具脚本设计与使用说明

> 代码真相源：`tools/script/i18n-shared.mjs` / `i18n-check.mjs` / `i18n-pseudo.mjs`。
> AI 使用规范见 [`.codebuddy/skills/i18n-expert/SKILL.md`](../.codebuddy/skills/i18n-expert/SKILL.md)。
> 本文档面向人工排查/维护，记录**为什么这样设计**，避免后续改动时重新踩坑。

## 1. 背景

仓库目前有三个独立的词条包，各自维护 `src/locales/<语言>/*.json`（支持的语言集合以各包 `src/locales` 目录下实际存在的子目录为准，运行 `pnpm i18n:check` 可查看当前生效的完整语言列表，其中 `zh-CN` 为基准语言）：

| 词条包                   | 词条目录                             | 命名空间文件         |
| :----------------------- | :----------------------------------- | :------------------- |
| `apps/mindx`             | `apps/mindx/src/locales`             | `mindx.json`         |
| `packages/ui-components` | `packages/ui-components/src/locales` | `ui-components.json` |
| `packages/import-kit`    | `packages/import-kit/src/locales`    | `import-kit.json`    |

三者共用同一个全局 `$t()`（`@mindx/i18n` 提供），按注册顺序做**跨命名空间查找**——这带来两个必须靠工具兜底的风险：

1. 中文 key 未登记时，`i18next` 回落显示 key 本身（即中文原文），**中文环境下完全看不出问题**，只有切换语言才会漏出中文；肉眼很难在中文开发环境下发现。
2. 两个包用了同一句中文做 key 但翻译不同时，先注册的包会"劫持"另一个包的翻译结果——代码调用正确、词条也登记了，显示的却是别的包的翻译，属于极难定位的诡异 bug。

因此需要一套跨三个包统一运行的静态校验 + 人工可视化验证工具，而不是各包各写一份。

## 2. 整体架构

```
tools/script/
  ├── i18n-shared.mjs   # 共享逻辑：词条读写、当前包解析、源码扫描、AST 检测
  ├── i18n-check.mjs     # 静态校验 CLI（12 项检查）
  └── i18n-pseudo.mjs    # 伪翻译 CLI（人工可视化验证）
```

三个词条包各自的 `package.json`：

```json
{
  "scripts": {
    "i18n:check": "node ../../tools/script/i18n-check.mjs",
    "i18n:pseudo": "node ../../tools/script/i18n-pseudo.mjs"
  }
}
```

仓库根 `package.json` 提供聚合入口：

```json
{
  "scripts": {
    "i18n:check": "pnpm -r run i18n:check",
    "i18n:pseudo": "pnpm -r run i18n:pseudo"
  }
}
```

## 3. 为什么用相对路径跨包引用（而不是包装成 workspace 包）

`tools/script/` 本身**没有 `package.json`**，不是一个 pnpm workspace 包，这是刻意选择而非疏漏。仓库里 `tools/` 下同时存在两种性质完全不同的目录，设计上不应混为一谈：

|                         | `tools/build-config` / `tools/eslint-config`                                                                               | `tools/script/*.mjs`（含本次的 i18n 三件套）                                          |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| 是否是 workspace 包     | 是，有 `package.json`，`@mindx/xxx` 命名                                                                                   | 否，纯脚本文件                                                                        |
| 消费方式                | 各包 `devDependencies` 声明 `workspace:*`，业务代码里 `import "@mindx/build-config"`，走 pnpm 的 node_modules 符号链接解析 | 各包 `package.json` 的 `scripts` 字段里 `node <相对路径>` 启动一个独立 Node 进程      |
| 是否被业务代码 `import` | 是（被 rspack config / eslint flat config 引用）                                                                           | 否，只作为 CLI 跑一次就退出，跑完进程即结束                                           |
| 复用的必要抽象层级      | 需要稳定的模块解析（node_modules 符号链接），因为要在多种 build/lint 上下文里被 `import`                                   | 只需要能定位到文件并用 `node` 执行，进程内自己通过 `process.cwd()` 感知"当前在哪个包" |

`i18n-check.mjs` / `i18n-pseudo.mjs` 属于右列：**不会被任何业务代码 `import`**，只是 `pnpm run i18n:check` 时启动的一次性 CLI 进程。这种场景下：

- 相对路径完全没有"模块解析歪掉"的风险（Node 直接按文件系统路径加载，不经过 npm 包解析算法）。
- 包装成独立 `@mindx/i18n-tools` workspace 包反而是过度设计——要多维护一份 `package.json` + `exports` + `bin` 字段，换来的只是把 `node ../../tools/script/i18n-check.mjs` 换成 `mindx-i18n-check`，对当前 3 个消费方而言收益不成比例。
- 该写法与仓库既有约定一致：根目录 `sync:whistle` 脚本同样是 `node ./tools/script/sync-whistle-rules.mjs` 直接引用 `tools/script/` 下的独立脚本，不是新引入的模式。

**相对路径深度的隐含约束**：三个消费方 `apps/mindx`、`packages/ui-components`、`packages/import-kit` 都位于仓库根下深度为 2 的目录（`apps/<pkg>` / `packages/<pkg>`），`../../tools/script/` 统一能落到 `<root>/tools/script/`。**新增消费方时若目录深度不是 2（例如未来出现 `apps/foo/bar` 这种三级目录），必须相应调整相对路径的 `../` 层数**，否则会直接报 `MODULE_NOT_FOUND`。

## 4. 核心原理

### 4.1 用进程 cwd 解析"当前包"（`resolveCurrentPackage`）

脚本不接收包名参数，而是依赖 `pnpm run <script>` 的既有行为——**cwd 就是声明该 script 的包目录**——在运行时反查：

1. `process.cwd()/package.json` 是否存在，取其 `name` 作为包标识（用于日志与冲突比对包名归属）。
2. `process.cwd()/src/locales/zh-CN/` 下应有且仅有一个 `.json` 文件，其文件名即该包的命名空间文件（`nsFile`），与各包 `loadResources` 的命名空间一一对应。
3. 任一前提不满足（不在包目录 / 没有词条目录 / 多个或零个 json）会 `fail()` 输出自解释错误并 `exit(1)`，避免静默跑偏。

好处：**同一份脚本文件在三个包下原样运行，无需为每个包各写一份配置**；新增第四个词条包时脚本本身零改动，只需要在包目录放好 `src/locales/zh-CN/<ns>.json` 并接好 `package.json` 的 `scripts`。

### 4.2 词条包注册表（`LOCALE_PACKAGE_REGISTRY`）与跨包冲突检测

`i18n-shared.mjs` 硬编码维护一份全量词条包清单（当前 3 个），每次运行时：

- `SIBLING_PACKAGES` = 注册表中排除"当前包"后的其余包。
- `i18n-check.mjs` 检查项 7：逐个兄弟包、逐个语言，比较**同时存在**的 key 翻译内容是否一致；不一致即报告 `[lang] 与 <pkg> 同名 key 翻译不一致`。

这是唯一能提前发现"`$t()` 全局查找被劫持"问题的机制——它不依赖运行时行为，纯靠静态比对词条文件即可暴露。

**新增第四个词条包时必须同步在 `LOCALE_PACKAGE_REGISTRY` 里注册**，否则该包不会被纳入跨包冲突检测（既不会被检查，也不会作为其它包的检测对象）。

### 4.3 检查项概览（`i18n-check.mjs`，12 项）

| #   | 检查项                                                       | 为什么重要                                                                        |
| :-- | :----------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| 1   | `$t()` 调用的 key 未登记到 `zh-CN`                           | 回落显示 key 本身（即中文原文），中文环境完全看不出异常                           |
| 2/3 | 各语言 key 集合与 `zh-CN` 不一致（缺失/多余）                | 缺失导致部分语言漏翻                                                              |
| 3   | 词条文件重复 key                                             | `JSON.parse` 静默保留最后一个，前一条莫名失效                                     |
| 4   | 词条值为空                                                   | 显示空白                                                                          |
| 5   | 插值变量 `{{var}}` 各语言不一致                              | 占位符原样显示或内容缺失                                                          |
| 6   | 模块级常量/`useMemo([])` 缓存了 `$t()`，或模块级常量含裸中文 | 加载时求值一次即固化，运行中切换语言不生效                                        |
| 7   | 与其它词条包同名 key 翻译冲突                                | `$t()` 全局查找被先注册的包"劫持"                                                 |
| 8   | JSX 文本节点里的裸中文                                       | 直接写在 JSX children 里、没有引号，pre-commit 正则钩子天然漏检，需要 TS AST 识别 |
| 9   | `$t()` 用模板字符串 + `${...}` 做 JS 插值                    | key 运行时才拼出，永远无法命中词条                                                |
| 10  | 函数体内/JSX 属性/普通赋值处的中文字符串字面量未走 `$t()`    | 覆盖 `toast("操作成功")`、`placeholder="中文"` 等 6/8 之外的位置                  |
| 11  | `$t()` 调用点插值传参与 key 声明不一致                       | 漏传导致 `{{var}}` 原样显示，多传被静默忽略                                       |
| 12  | 硬编码 `zh-*` locale（`toLocaleDateString("zh-CN")` 等）     | 英文环境仍显示中文日期格式                                                        |

任一失败即整体退出码 `1`（CI/hook 可直接用退出码判断）。

### 4.4 豁免机制

| 标记       | 写法                                                 | 作用范围                                                                                                                            |
| :--------- | :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| 逐行豁免   | 声明行或其上一行加 `// i18n-check-ignore: <理由>`    | 检查项 6 / 8 / 10 命中的单点；若命中行在某个顶层 `const` 声明块内部，标记写在声明行即可豁免整块（见 `findIgnoredConstBlockRanges`） |
| 整文件豁免 | 文件内任意位置加 `// i18n-check-ignore-file: <理由>` | 跳过该文件全部源码扫描类检测（1/6/8/10）；仅建议用于整份文件完全不做 i18n 的场景，避免掩盖真实缺词条问题                            |

两者都**要求写明理由**，避免静默扩大白名单。这两个标记同时被 `scripts/workflow/check-i18n-literals.mjs`（`.husky/pre-commit` 本地钩子，见第 6 节 ③）识别——同一条注释可一次性满足本地 pre-commit 校验与 CI 全量扫描，不必分别标注两次。

### 4.5 伪翻译原理（`i18n-pseudo.mjs`）

把目标语言词条的值包上 `[[...]]` 标记（可选 `--expand` 再填充 `~` 模拟长文案），切到该语言后：

- `[[Text]]` → 走了 i18n，词条命中 ✅
- 裸中文 → 未 `$t` 包裹或 key 未登记 ❌
- 无括号英文 → 代码里硬编码的英文 ❌

把"需要判断"变成"视觉扫括号"，无需对照设计稿或读代码，还能暴露半外化的拼接文案（`[[Saved to]] 微信`）。

- 原文件改写前自动备份为 `<词条文件>.orig`（已 gitignore），`--restore` 完整还原；备份已存在时拒绝重复生成，避免把带标记的值当基线二次改写。
- **抓不到语言固化问题**：页面初始即为目标语言时，固化常量加载时取到的就是带标记的值，显示正常——固化问题只能靠 `i18n:check` 静态检出，或"不刷新页面切换语言"验证。
- **跨包验证必须三包同时开**：同一界面的文案可能来自任意词条包，只对单包跑伪翻译会有一部分文案显示正常（其实是来自未处理的包），容易误判为"没问题"。

## 5. 调用方式

```bash
# ── 静态校验 ──
pnpm i18n:check                                    # 仓库根：一次校验全部三个词条包
pnpm --filter @mindx/ui-components run i18n:check  # 只校验单个包
cd apps/mindx && pnpm i18n:check                   # 进入包目录单独跑
cd apps/mindx && pnpm i18n:check --quiet           # 只输出问题，不打印通过项

# ── 伪翻译 ──
pnpm i18n:pseudo                     # 仓库根：三包同时生成伪翻译（默认改写 en-US）
pnpm i18n:pseudo -- --lang=zh-HK     # 改写指定语言
pnpm i18n:pseudo -- --expand         # 同时加长 ~40%，查布局溢出
pnpm i18n:pseudo -- --restore        # 验证完必须还原（三包一起还原）
cd apps/mindx && pnpm i18n:pseudo --restore   # 只处理单包
```

退出码：`i18n:check` 有问题时返回 `1`，可直接用于脚本判断。该退出码已被 CI 层的 `scripts/workflow/check-i18n-consistency.mjs` 消费（见第 6 节）。

## 6. 自动化现状与边界（四层闸门，已闭环）

i18n 拦截已从"纯手动"演进为四层协同，`pnpm i18n:check` 现已接入 CI 层做最终兜底：

| 层级          | 载体                                                                                                          | 覆盖内容                                                                                                                                                                                                                    |
| :------------ | :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 编码阶段    | `.codebuddy/rules/i18n-coverage-route.mdc`（alwaysApply）                                                     | 强制 AI 在 `apps/mindx/src/**`、`packages/ui-components/src/**`、`packages/import-kit/src/**` 下新增中文可见文案时先 `$t()` 包裹 + 登记当前支持的全部语言词条                                                               |
| ② Review 阶段 | `.codebuddy/agents/code-review-agent.md` 的 `i18n-coverage`                                                   | 审阅新增中文文案是否已处理                                                                                                                                                                                                  |
| ③ commit 阶段 | `.husky/pre-commit` 里的 `scripts/workflow/check-i18n-literals.mjs`                                           | 只检查 **staged diff** 中新增的中文字符串字面量是否被 `$t()` 包裹；**不检查**词条文件本身是否完整/一致/有无固化风险、也不做跨包冲突比对。识别与④相同的 `i18n-check-ignore` / `i18n-check-ignore-file` 豁免标记（见 4.4 节） |
| ④ CI 阶段     | `.cnb.yml`「MindX PR checks」job 调 `scripts/workflow/check-i18n-consistency.mjs`（内部跑 `pnpm i18n:check`） | 对三个词条包做**全量终态**一致性校验（重复 key、空值、插值不一致、语言固化、跨包同名 key 冲突等 ③ 抓不到的问题），失败硬阻断 PR 合并                                                                                        |

关键边界说明：

- **③ 与 ④ 覆盖面互补、不重叠**：③（`check-i18n-literals.mjs`）只看 staged diff 的裸中文字面量，抓不到词条文件的完整性/一致性问题；④（`check-i18n-consistency.mjs`）做全量终态校验，专补这块。
- **③ 与 ④ 共用同一套逐行/整文件豁免标记**：`i18n-check-ignore` / `i18n-check-ignore-file`（见 4.4 节）在两处校验脚本里定义完全一致（要求 `:` 后非空理由），同一条注释可同时满足本地 pre-commit 与 CI 全量扫描，无需分别标注。
- **④ 是终态全量校验，不看 diff**：它校验的是"合并后三个词条包的最终状态是否干净"，与本次 PR 改了哪些文件无关。因此**别人遗留的脏词条会连带被拦**，无法靠"不是本次改的"规避。
- **`[skip-i18n]` 是展期不是销账**：④ 失败时，若本 PR 任一 commit body 含一行 `[skip-i18n]: <说明>`，CI 会把失败降级为 ⚠️ 醒目告警放行（不静默通过，reviewer 在流水线日志可见）。但它**不修复问题、不写白名单**——只要问题未真正修掉，下一个改动这三个包的 PR 跑 `i18n:check` 仍会重新报同样的错，届时要么修掉、要么再写一次 `[skip-i18n]`。

### 6.1 `[skip-i18n]` 使用约定

`[skip-i18n]` 是**紧急豁免出口**，不是常规后门。它与 typecheck/lint/test 门禁的本质差异在于：后者 CI 失败只能修、没有豁免标记；唯独 i18n 给了显式出口——原因是词条问题可能是**上一轮遗留**，而 ④ 是全量终态校验，会把"不是本次造成的脏词条"连带拦下，此时要求"顺手还清陈年旧账"未必合理。

因此只在以下两类场景使用，其余一律修复：

| 场景                                                                          | 是否允许 | 说明                                                        |
| :---------------------------------------------------------------------------- | :------- | :---------------------------------------------------------- |
| `i18n:check` 报的是**历史遗留**词条问题，本次 PR 确实没引入、也没义务顺手还债 | ✅ 允许  | 典型场景：改了业务代码但未触碰词条文件，被连带拦住          |
| **紧急 hotfix** 需先上线，词条问题承诺后续单独 PR 修复                        | ✅ 允许  | 需在 `:` 后说明 hotfix 原因与修复计划                       |
| 本次 PR **自己新增**的中文文案没走 `$t()` 就试图豁免                          | ❌ 禁止  | 这是编码阶段（①/②/③）就应拦住的"自己的债"，用豁免掩过属滥用 |

两条防滥用约束（已由脚本实现，勿改）：

1. **必须写理由**：豁免标记强制要求 `:` 后跟非空说明（正则 `/^\s*\[skip-i18n\]\s*:\s*\S+/m`），纯 `[skip-i18n]:` 不算合法豁免；
2. **不静默通过**：豁免后 CI 打 ⚠️ 醒目告警放行，reviewer 在流水线日志可见，形成社会性约束。

- **未接入 `.husky/pre-push`**：本地 push 会跳过全部本地检查（含 typecheck/lint/test），完整校验统一由 CNB PR 流水线兜底，因此 `i18n:check` 只加在 CI 层（④）才有实际拦截效果。
- 补全词条后仍建议手动跑一次 `pnpm i18n:check` 自检，尽早发现问题，不必等到 CI 才暴露。

## 7. 新增第四个词条包时的接入清单

1. 该包下补齐 `src/i18n/index.ts` + `src/locales/<语言>/<ns>.json`（为当前支持的每种语言各建一个语言目录，集合以其它已接入词条包为准；结构参考 `.codebuddy/skills/i18n-expert/SKILL.md` "新 package / app 国际化初始化"一节）。
2. 在 `tools/script/i18n-shared.mjs` 的 `LOCALE_PACKAGE_REGISTRY` 追加一条 `{ name, dir, nsFile }`——否则该包不会被纳入跨包同名 key 冲突检测。
3. 在该包 `package.json` 的 `scripts` 里加：
   ```json
   "i18n:check": "node <相对路径>/tools/script/i18n-check.mjs",
   "i18n:pseudo": "node <相对路径>/tools/script/i18n-pseudo.mjs"
   ```
   相对路径层数按该包相对仓库根的实际深度确定（`apps/<pkg>` / `packages/<pkg>` 均为 `../../`）。
4. 跑一次 `pnpm i18n:check` 确认新包能被正确解析（看日志里的 `[i18n:check] 包: <name>` 是否符合预期）。
