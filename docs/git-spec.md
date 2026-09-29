# Git 规范（commit + 分支）

> **定位**：本文件是 **git 操作的格式真相源**——涵盖 commit message 格式与**分支命名规范**（含 commit type ↔ 分支 type 映射表）。
> **与 `release-workflow.md` 的分工**：
>
> - **本文件**：管「格式」——commit subject 怎么写、分支名怎么取、type 词表怎么映射。
> - [`release-workflow.md`](./release-workflow.md)：管「语义/流程」——issue 绑定、五态状态机、prototype handoff 与生产 PR。是项目级"宪法"，语义冲突以它为准。
>
> 两者交叉引用，AI 在 commit / 切分支前都应读本文件确认格式。

---

## 一、Commit Message 格式

```
<type>: <subject> <issue-ref>
```

- `<type>`：见下方 commit type 词表
- `<subject>`：简明中文描述，首字母小写，结尾不加句号，整行 ≤ 100 字符
- `<issue-ref>`：subject **末尾必带** `#<issueid>` 或 `[no-issue]`（强制，由 commitlint + husky + CI 三重校验）

### 1.1 Commit type 词表

| Type       | 说明                                   | 示例                                                                  |
| ---------- | -------------------------------------- | --------------------------------------------------------------------- |
| `feat`     | 增加新功能                             | `feat: 新增本地文件页面 #117`                                         |
| `fix`      | 修复 bug                               | `fix: 修复头像上传失败 #119`                                          |
| `docs`     | 只改文档                               | `docs: 更新 README 安装说明 [no-issue]`                               |
| `style`    | 不影响逻辑的格式改动（空格/缩进/分号） | `style: 整理 README 格式 [no-issue]`                                  |
| `refactor` | 重构（非新功能、非修复）               | `refactor: 重构 workflow 校验脚本 [no-issue]`                         |
| `perf`     | 性能优化                               | `perf: 优化 workflow 校验脚本 [no-issue]`                             |
| `test`     | 测试相关                               | `test: 补充 hook.test.ts [no-issue]`                                  |
| `build`    | 构建工具 / 外部依赖（rspack / npm 等） | `build: 调整根 package.json [no-issue]`                               |
| `ci`       | CI 配置                                | `ci: 调整 .cnb 流水线 [no-issue]`                                     |
| `chore`    | 其它杂项（脚手架 / 配置等）            | `chore: 更新 packages/ui-components/.business-frozen.json [no-issue]` |
| `revert`   | 回滚                                   | `revert: 回滚登录功能 #119`                                           |

### 1.2 issue 引用末尾规则（与 release-workflow §1/§2 一致）

| 形式                           | 含义                            |
| ------------------------------ | ------------------------------- |
| `<type>: <subject> #<issueid>` | 关联一个**真实存在**的CNB issue |
| `<type>: <subject> [no-issue]` | 显式声明无 issue 关联           |

> **角色 × type 矩阵（语义真相源在 [`release-workflow.md`](./release-workflow.md) §2）**：
>
> - 产品/设计师 → **任意 type 必须** `#<issueid>`，禁用 `[no-issue]`
> - 开发者 + `feat`/`fix` → **必须** `#<issueid>`，禁用 `[no-issue]`
> - 开发者 + `chore`/`docs`/`refactor`/`style`/`test`/`build`/`ci`/`perf` → 二选一
> - 开发者 + `revert` → **必须** `#<issueid>`，禁用 `[no-issue]`
> - `#<issueid>` 必须真实存在，`#0` / `#000` 已废弃

### 1.3 示例

```
✅ feat: 新增列表缓存功能 #117
✅ fix: 修复结算时积分计算错误 #119
✅ chore: 更新 packages/ui-components/.business-frozen.json [no-issue]
✅ docs: 更新 API 接口文档 [no-issue]
✅ revert: 回滚登录功能 #119

❌ feat新增功能              # 缺少空格
❌ Feat: 新增功能 #1         # type 应小写
❌ feat: 新增功能。 #1       # subject 不应有句号
❌ feat: 新页面             # 末尾既无 #id 也无 [no-issue]
❌ feat: 新页面 [no-issue]   # feat 禁用 [no-issue]（属需求开发）
❌ refactor: 重构认证模块 [no-issue] # runtime 改动未命中允许类别
❌ revert: 回滚登录功能 [no-issue]   # revert 必须绑定真实 Issue
```

---

## 二、分支命名规范

```
<branch-type>/<issueid>-<description>      # 业务分支（关联 issue）
<branch-type>/<description>                # 工程分支（[no-issue] 类任务，无 issue）
```

| 段              | 取值                                                       | 示例               |
| --------------- | ---------------------------------------------------------- | ------------------ |
| `<branch-type>` | 分支 type **全称**（见 §2.1 词表），**禁止用 commit 缩写** | `feature`          |
| `<issueid>`     | CNB issue 数字 ID（无 `#` 前缀）                           | `117`              |
| `<description>` | 英文 kebab-case slug，AI 抽提自 issue title 的核心业务名词 | `local-files-page` |

**完整示例**：

```
feature/117-local-files-page
bugfix/119-avatar-upload-crash
prototype/123-agent-memory-panel    # 一次性产品原型，永不建 PR/merge
chore/upgrade-smart-doc            # 工程分支可无 issueid
docs/governance-cleanup
```

### 2.1 ⚠️ 分支 type ≠ commit type（核心防错）

分支 type 用**全称**，commit type 用**缩写**，两者词表部分重叠但**不完全一致**，最常见的错误就是把 commit 的 `feat`/`fix` 直接套到分支上。

**commit type → 分支 type 映射表（必须严格遵守）**：

| commit type | 分支 type  | 易错点                           |
| :---------- | :--------- | :------------------------------- |
| `feat`      | `feature`  | ⛔ 禁止 `feat/`，必须 `feature/` |
| `fix`       | `bugfix`   | ⛔ 禁止 `fix/`，必须 `bugfix/`   |
| `chore`     | `chore`    | 同名                             |
| `docs`      | `docs`     | 同名                             |
| `refactor`  | `refactor` | 同名                             |
| `style`     | `style`    | 同名                             |
| `perf`      | `perf`     | 同名                             |
| `test`      | `test`     | 同名                             |
| `build`     | `build`    | 同名                             |
| `ci`        | `ci`       | 同名                             |
| —（发布流） | `hotfix`   | 发布分支专用，见 §2.3            |

**分支 type 白名单（全称）**：`prototype` | `feature` | `bugfix` | `chore` | `docs` | `refactor` | `style` | `perf` | `test` | `build` | `ci` | `hotfix`

> `chore|docs|refactor|style|perf|test|build|ci` 只是命名白名单，不自动获得无 Issue 豁免。trusted CI 以 `merge-base..PR head` 的累计 diff 为准，按改动性质仅放行：分类器显式根配置；`.agents/**`、`.cnb/**`、`.codebuddy/**`、`.github/**`、`.husky/**`、`.vibe/**`、`docs/**`、`scripts/**`、`tools/**`；任意位置的 `.md`；`packages/*/.business-frozen.json`；以及 basename 严格匹配 `*.test.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` / `*.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` 的工程验证代码。
>
> 目录本身不是结论：PR #1850 的 `packages/ui-components/README.md`、`packages/ui-elements/README.md` 与 `packages/ui-components/.business-frozen.json` 属于允许示例，但这不放行整个 `packages/**`、任意 JSON/隐藏文件、宽泛 `test/` 目录或近似测试名。累计 diff 一旦在 `apps/mindx/**`、`packages/**/src/**`、根 `src/**` 或其他位置混入未命中明确文档/严格测试类别的业务或运行时代码、未知或非法路径，就失去无 Issue 豁免并 fail closed。
>
> 被分类器拒绝的分支必须绑定真实 Issue，并采用 `feature|bugfix` 分支名与生产 PR 契约。

> 💡 记忆口诀：**功能 = feature 不是 feat，修复 = bugfix 不是 fix**，其余同名。

### 2.2 Prototype 分支

```text
prototype/<issueid>-<description>
```

- 从最新 `origin/main` 创建；产品可直接改 `apps/mindx`。
- commit 必须绑定与分支一致的 `#<issueid>`，禁用 `[no-issue]`。
- 允许 push 与静态预览，禁止 PR、merge、作为生产分支基点或整分支 cherry-pick。
- handoff 通过后研发另从最新 `origin/main` 创建普通 `feature|bugfix/<issueid>-<description>`。

### 2.3 发布分支（机器生成，勿手动建）

```
hotfix/<YYYYMMDD>_<HHmm>_mindx
例：hotfix/20260622_1930_mindx
```

由发布流水线 / changelog skill 生成，开发者不手动创建。

### 2.4 豁免分支

`main` 为受保护分支，不参与上述命名校验。

---

## 三、被引用方

- `.codebuddy/skills/start-feature/SKILL.md`（建 issue + 切分支时引用映射表）
- `.codebuddy/skills/cmd-publish/SKILL.md`（feature 分支准入断言）
- `.codebuddy/rules/issue-binding-route.mdc`（commit 闸门）
- [`docs/release-workflow.md`](./release-workflow.md) §1/§2/§4（issue 绑定语义真相源）

> **变更原则**：本文件管「格式」，`release-workflow.md` 管「语义/流程」。如二者就 issue 绑定语义冲突，以 `release-workflow.md` 为准。
