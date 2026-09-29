---
name: cmd-publish
description: >
  生产分支提交、推送、创建/更新 CNB PR，并补齐 Refs、AC-contract、Target-label 与 Issue PR 证据评论；prototype 分支仅在冻结交付时提交并推送，分享阶段永不提交。
  当用户说"提交代码"、"开发完成"、"申请合并"、"/publish"时触发此 skill。
  即使用户只是简单地要求 commit 或 push 代码，也应使用此 skill 而非直接执行 git 命令。
---

# Command: Publish（统一出口管线）

本 skill 是代码提交的唯一出口，但**不再承载发布前质量检查**。

质量检查统一放在 git hooks / CI 中执行：

- `commit-msg`：commitlint、issue ref、角色与 `[no-issue]` 规则
- `pre-commit`：lint-staged、UI 组件边界、路由、reporter 依赖、i18n staged 检查
- `pre-push`：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、冲突标记残留扫描
- CNB PR CI：prototype PR guard、PR description、Issue 状态机、常规质量检查（typecheck/lint/test）与 i18n 一致性门禁（`pnpm i18n:check`，硬阻断，紧急场景可用 `[skip-i18n]: <说明>` 豁免）

> **硬约束**：本 skill 内禁止主动执行 `pnpm install` / `pnpm typecheck` / `pnpm lint` / `pnpm test` / i18n 扫描 / 主干同步检查 / 自动 rebase。
> 如果 commit 或 push 被 hook 阻断，按 hook 输出修复后重试；如果用户主动要求解决冲突，交由 `conflict-resolver` skill 处理。

## Route 0 · 分支出口分流（最高优先级）

在 Phase 1 的 CNB PR 探活之前执行 `git branch --show-current`。

### `prototype/<issue-id>-<slug>` → `prototype`

prototype 是可追溯的设计参考，不是待合并代码。分享阶段由 `prototype-deploy` 直接从 dirty worktree 构建、校验、打包并覆盖 Issue 对应的唯一 Page，**不调用本 route，也不 commit/push**。只有明确“冻结/交付研发”时，本 route 才把最近一次成功分享的 source tree 固定为 commit 并普通 push。

```text
[MindXRoute] route=cmd-publish/prototype status=SELECTED issue=#<issue-id>
```

严格禁止：创建或更新 PR、合入 main、tag、force push、rebase、将 prototype 用作生产分支基点。`prototype-handoff` 只接受已分享且 AC/source tree 未漂移的冻结 checkpoint。

Prototype route 的最小步骤：

1. 只接受来自 `prototype-handoff` 的冻结请求；普通“分享/部署”立即返回 `prototype-deploy`，不得产生任何 Git mutation。
2. 读取 Issue 并要求 `open`、唯一 `原型中`、结构化 `## 验收标准`，且 AC digest 等于最近分享记录。
3. 通过宿主 `checkpointPrototype` 以同一个幂等键暂存当前 worktree；暂存后的 `git write-tree` 必须等于最近分享 package 的 `sourceTreeSha`，否则返回 `RESHARE_REQUIRED`，不得 commit、push 或写 Issue。
4. tree 一致时幂等 commit：若 HEAD tree 已相同则复用 HEAD，否则按 `#<issue-id>` 创建一次 commit；随后普通 `git push origin <branch>`。返回的 `commitSha`、`treeSha`、`remoteSha` 必须证明远端 commit 与分享 tree 一致。
5. 输出 branch 与 commit SHA，明确说明“已冻结并推送供研发参考；未创建 PR、未合并”。

完成第 4 步立即返回；prototype route 不进入下文的 CNB PR 探活、PR 创建、Issue PR 评论或主干冲突检查。

### `feature|bugfix/<issue-id>-<slug>` → `production`

只有分支严格匹配 `^(feature|bugfix)/([1-9]\d*)-[a-z0-9]+(-[a-z0-9]+)*$`，且开放 Issue ID 与分支一致、状态恰好为 `开发中`，才选择 production。输出：

```text
[MindXRoute] route=cmd-publish/production status=SELECTED issue=#<issue-id>
```

### 明确的工程分支 → `infrastructure`

纯工程任务只接受已存在且命名合规的 `chore|docs|refactor|style|test|build|ci|perf/<slug>` 分支，并且必须先 `git fetch origin main`，再执行 `BASE_REF=origin/main HEAD_REF=HEAD node scripts/workflow/infrastructure-route.mjs` 校验累计变更。该共享分类器是唯一判定入口：它按改动性质放行明确文档、流水线、工具/治理资产与严格命名的 test/spec，而不因文件位于 `packages/**` 或 `apps/mindx/**` 就一刀切。只有累计 diff 全部通过时才选择 `infrastructure`，PR 使用 `AC-contract: none` 与 `Target-label: none`；任一业务/运行时、未知或非法路径都会 fail closed，要求绑定 Issue 并从最新 main 改走 production 分支。分支名或 commit type 不能豁免。

### 其它分支 → 硬停止

`main`、`hotfix/**`、无 Issue 的 feature/bugfix、任意未知分支都不得在 publish 阶段“顺手修名”或从当前 `HEAD` 原地造分支。尤其在 dirty `main` 上必须保留现场并停止：需求/bug 路由到 `implement-issue` 的 fresh-main 流程；工程任务先由用户确认安全迁移方式并从最新 `origin/main` 建独立工程分支。

禁止 `--force-naming`，禁止把 commit message 里的数字反向当作分支 Issue。产品/设计师若不在 prototype 分支，停止并路由 `prototype-workflow`。

## 流程总览

```
Phase 1: CNB CLI 健康检测 / 降级分流
    │
Phase 2: 轻量上下文快照与已存在分支契约验证
    │
Phase 3: Fast Publish
    ├─ Step 1: 提交代码
    ├─ Step 2: 推送分支
    ├─ Step 3: CNB PR 创建/更新 + 远端复验 + Refs + AC-contract + Target-label
    ├─ Step 4: 明确冲突检测（仅明确冲突才进入 conflict-resolver）
    ├─ Step 5: Issue PR 证据评论（不改 Issue AC）
    └─ Step 6: 终局闭环提示
```

---

## Phase 1: CNB CLI 健康检测 + 分流处理

### 1.1 CNB CLI 健康检测

执行 `cnb status` 探活，记录 `CNB_CLI_AVAILABLE` 状态。

> 细节见 [../\_shared/mcp-degradation.md](../_shared/mcp-degradation.md) §1。

`cnb status` 通过后，还必须做一次 PR 读权限探活：

```bash
cnb pulls list-pulls --repo x-team/mindx --state open --page-size 1 --verbose
```

- 退出码 `0`：记录 `CNB_PR_API_AVAILABLE=true`，允许进入 PR 创建/更新。
- 退出码非 `0`：视同 PR 远端能力不可用；不得创建/更新 PR，不得输出 PR 成功链接，按 §1.2 降级。

### 1.2 CNB CLI 不可用 → 角色分流

- **产品经理/设计师**：阻断 publish，终止管线。因为 PR / Refs / Target-label 需要 CNB CLI 保证。
- **开发者**：本地 commit / push 可继续；PR 创建/更新与 Issue PR 证据评论暂停，提示执行 `cnb login --woa` 后重试。

---

## Phase 2: 轻量上下文快照

运行轻量命令收集上下文：

```bash
BRANCH=$(git branch --show-current)
ISSUE_ID=$(echo "$BRANCH" | sed -nE 's#^(feature|bugfix)/([1-9][0-9]*)-.*#\2#p')
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
DIRTY=$(git status --porcelain)
echo "{\"branch\":\"$BRANCH\",\"issue_id\":\"$ISSUE_ID\",\"head_sha\":\"$HEAD_SHA\",\"dirty\":$(if [ -n "$DIRTY" ]; then echo true; else echo false; fi)}"
```

把 Route 0 已锁定的结论实际赋值为 `ROUTE=production` 或 `ROUTE=infrastructure` 后再进入 Phase 3；不得让 `ROUTE` 为空，也不得根据 PR 标题反推 route。

设置标题绑定上下文 `EXPECTED_ISSUE_ID`：production 必须等于分支 `ISSUE_ID`；infrastructure 只有在本轮 IssueBinding 已显式绑定并校验真实 Issue 时才设置为该 ID，否则保持空。禁止从 PR title 或 commit subject 反推它。

固定路由：

```text
pr_target = main
source_branch = main
```

### 分支准入

Route 0 已完成最终分流，本阶段不得建分支或修改分支名：

- `production`：重新读取 Issue，要求 opened、状态是 `待研发` / `开发中` / `待发布` 之一（关闭 / `原型中` / `已发布` 拒）、Issue ID 等于分支 ID；先尝试用 `scripts/workflow/issue-contract.mjs#canonicalizeIssueAcceptanceCriteria` 解析 `## 验收标准`，成功则 `AC_CONTRACT_DIGEST=sha256:<64-hex>`；结构化解析失败（存量 Issue、手写 AC 等）则退回 `scripts/workflow/issue-contract.mjs#legacyIssueBodyDigest` 拿到 `AC_CONTRACT_DIGEST=legacy:sha256:<64-hex>`。两种都算合法，只需在 PR body 里如实写入 digest。任何一种都拿不到（比如 Issue API 不可达）时立即停止，不提交、不 push。
- `infrastructure`：确认 diff 与会话意图都是纯工程改动，并以 `infrastructure-route.mjs` 对累计 diff 的实际结果为准；严格 test/spec 可位于 `apps/mindx`，但相邻运行时代码或业务数据模型变化仍必须改走真实 Issue + `implement-issue`。
- 两种 route 都要求分支不是从 prototype SHA 创建，历史中没有 prototype merge/整段 cherry-pick，且仓库内不存在待提交的 `prototype.config.json`、`apps/mindx/src/prototype/**` 或 prototype Rspack 配置。
- 本 skill 不自动 stash、不从 dirty main 搬运改动、不创建“临时可合并分支”。

---

## Phase 3: Fast Publish

### Step 1: 提交代码

1. `git add .`
2. production 的每个 commit 必须生成 `<type>: <subject> #<branch-issue-id>`；infrastructure 才可按 IssueBinding 规则使用 `[no-issue]`
3. commit 前输出 IssueBinding 声明：

   ```text
   [IssueBinding] 角色=<role>，commit_type=<type>，issue=#<id>|[no-issue]，依据=<...>
   ```

4. 执行：

   ```bash
   git commit -m "<message>"
   ```

5. 进入 Step 2 前必须完成最新 commit subject 的独立校验；只有它合法时才允许 push。commit subject 描述本次提交，不承担概括整个 PR 的职责。

若 `commit-msg` / `pre-commit` 阻断，按 hook 输出修复后重新执行 Step 1。**不得在本 skill 中重复实现 hook 里的检查逻辑。**

### Step 2: 推送分支

每次进入或重新进入 Step 2（包括 `conflict-resolver` 返回 Step 2）时，第一条动作都必须重新读取当前 HEAD subject，并调用真实 route-aware validator；禁止复用 Step 1 或冲突处理前缓存的 `HEAD_SUBJECT`：

```bash
HEAD_SUBJECT="$(git log -1 --pretty=%s)"
node --input-type=module -e 'const { assertFinalPrTitleForRoute } = await import("./scripts/workflow/upsert-cnb-pr.mjs"); assertFinalPrTitleForRoute(process.argv[1], { route: process.argv[2], expectedIssueId: process.argv[3] || undefined, head: process.argv[4] });' "$HEAD_SUBJECT" "$ROUTE" "$EXPECTED_ISSUE_ID" "$BRANCH"
```

校验通过后才执行：

```bash
git push origin <当前分支>
```

若 push 被 `pre-push` 阻断，按 hook 输出修复后重新执行 Step 2。
本 skill 不主动 rebase，不主动 `--force-with-lease`；只有 `conflict-resolver` 成功返回且明确要求更新远端时，才允许使用 `git push --force-with-lease origin <当前分支>`。

---

## Step 3: CNB PR 创建/更新 + 远端复验

> CNB CLI 或 PR 读权限探活不可用时跳过整个 Step 3，提示 `cnb login --woa` 后重试。

### 3.1 PR 标题

PR title 与 commit subject 是两个独立契约：commit subject 描述一次增量，PR title 概括当前分支相对 `main` 的全部改动。新建 PR 时，调用方结合 Issue 与累计 diff 生成整体标题 `PR_TITLE_CANDIDATE`；不得直接复制最新 commit subject，除非它恰好准确概括累计改动。

```bash
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
# 根据 Issue 与上述累计变更生成 PR_TITLE_CANDIDATE
```

更新已有 open PR 时，先从 §3.2 的远端结果读取 `CURRENT_PR_TITLE`：已有合法、非临时且 Issue 绑定正确的标题默认保留。只有标题是 placeholder/临时词、格式不合法、Issue 不匹配，或用户显式要求改名时，才允许生成并写入新的 `PR_TITLE_CANDIDATE`。

格式契约：

- production：`<type>: <subject> #<branch-issue-id>`；允许 conventional commit 的可选 scope（例如 `fix(workflow): ... #864`），但尾部 Issue ID 必须与分支一致。
- infrastructure：本轮 IssueBinding 绑定真实 Issue 时，必须传 `--expected-issue-id <real-issue-id>` 并以相同 `#<real-issue-id>` 结尾；无 Issue 时不得传该参数，只接受 `[no-issue]`。
- 两种 route 的 `<subject>` 都必须是有意义的累计改动摘要。Issue title 提供业务范围，累计 diff 提供实际改动范围，两者共同参与新标题生成。

**临时词黑名单**（PR title 命中任一即不可创建或保留）：

```
^\s*(test|tmp|wip|fixup|squash|update|fix bug|fix typo|chore: trigger.*|ci: trigger.*|debug|临时|测试|调试)\s*(#\d+|\[no-issue\])?\s*$
```

只要新建路径的 `PR_TITLE_CANDIDATE` 为空、命中临时词黑名单、不是有意义的 conventional 标题，或 production 的 `#<issue-id>` 与分支不一致，就停止 PR 创建并修正候选标题。已有 PR 的 `CURRENT_PR_TITLE` 命中这些条件时不得保留，必须使用同一规则生成并校验替代标题。最新 commit subject 仍由 Step 2 独立校验，PR 标题不能掩盖无效 commit。

### 3.2 查询当前分支 open PR

必须先查询当前分支是否已有 open PR，禁止凭记忆、URL 规律或旧对话猜测 PR 编号：

```bash
cnb pulls list-pulls --repo x-team/mindx --state open --page-size 100 --verbose
```

从 `--verbose` 原始响应中按以下条件过滤：

```text
state/status 为 open/opened
source/head 分支 等于 当前分支
target/base 分支 等于 main
head_repo/source_repo 为空或等于 x-team/mindx
```

- 精确匹配 0 个 → 走创建 PR。
- 精确匹配 1 个 → 记录 `pr_iid` 与远端 `CURRENT_PR_TITLE`，走更新 PR；若列表响应缺少完整、非空白标题，再用 `get-pull --verbose` 补读，仍拿不到非空白标题则 fail closed，禁止把空标题当作“非法标题可自动替换”。
- 匹配多个 → 停止 Step 3，向用户报告歧义 PR 编号列表，禁止自行选择。
- 查询失败或无法解析 → 停止 Step 3，最终只能报告「代码已 push，但 PR 查询/创建未完成」。

### 3.3 description 自检

调用 PR 包装器前必须自检：

```text
create:      `PR_TITLE_CANDIDATE` 已按 route / source branch / Issue 绑定校验
update:      `CURRENT_PR_TITLE` 合法则默认保留；仅在不合法或用户显式改名时校验并使用 `PR_TITLE_CANDIDATE`
production:  exactly one `Refs #<branch-issue-id>` + one `AC-contract: <AC_CONTRACT_DIGEST>` + one `Target-label: 待发布`
infra:       无 Issue 时无 Refs、标题为 `[no-issue]`；绑定真实 Issue 时唯一 Refs 与 `--expected-issue-id`、标题 `#ID` 一致；另有 `AC-contract: none` + `Target-label: none`
```

description 参数必须使用真实换行符，禁止传字面量 `\n` / `\\n`。

### 3.4 创建或更新 CNB PR

调用方式必须加 `--verbose`，以便解析 CNB 返回的真实 PR 编号与 URL；禁止使用会被顶层 CLI 解释为版本参数的短选项 `-v`：

- **不存在**：创建 PR
  - source：当前分支
  - target：`main`
  - title：调用方基于 Issue + `origin/main...HEAD` 累计 diff 生成并校验的 `PR_TITLE_CANDIDATE`
  - production description：依次包含 `Refs #<issue_id>`、`AC-contract: <AC_CONTRACT_DIGEST>`（`sha256:...` 或 `legacy:sha256:...`）、`Target-label: 待发布`
  - infrastructure description：包含 `AC-contract: none`、`Target-label: none`；仅有真实关联 Issue 时可额外保留唯一一行 `Refs #<id>`
- **已存在**：更新 PR
  - `CURRENT_PR_TITLE` 已通过 route-aware 校验时，不向 `patch-pull` 传 `--title`，默认保留已有标题
  - 仅当 `CURRENT_PR_TITLE` 是 placeholder/临时词、格式不合法、Issue 不匹配，或用户显式要求改名时，才传入按累计改动生成的 `PR_TITLE_CANDIDATE`
  - description 保留用户已有内容，但必须修正为本 route 的唯一 `Refs` / `AC-contract` / `Target-label` 契约
  - 不自动改变人工设置的 WIP 状态

先把最终 description 写入临时文件，再统一通过仓库包装器调用。production 必须传 route 与分支 Issue ID；infrastructure 必须传 route，绑定真实 Issue 时还必须把已校验的 ID 作为 `--expected-issue-id` 传入：

```bash
# 创建：必须传累计改动标题
node scripts/workflow/upsert-cnb-pr.mjs --repo x-team/mindx --base main --head <branch> --route production --expected-issue-id <issue_id> --title "<pr-title-candidate>" --body-file <description-file>
node scripts/workflow/upsert-cnb-pr.mjs --repo x-team/mindx --base main --head <branch> --route infrastructure --title "<pr-title-candidate>" --body-file <description-file>
node scripts/workflow/upsert-cnb-pr.mjs --repo x-team/mindx --base main --head <branch> --route infrastructure --expected-issue-id <real-issue-id> --title "<pr-title-candidate>" --body-file <description-file>

# 更新且保留合法原标题：不得传 --title
node scripts/workflow/upsert-cnb-pr.mjs --repo x-team/mindx --base main --head <branch> --route production --expected-issue-id <issue_id> --number <pr_iid> --existing-title "<current-pr-title>" --body-file <description-file>

# 标题不合法时自动替换；用户显式改名时额外传 --update-title true
node scripts/workflow/upsert-cnb-pr.mjs --repo x-team/mindx --base main --head <branch> --route production --expected-issue-id <issue_id> --number <pr_iid> --existing-title "<current-pr-title>" --title "<pr-title-candidate>" [--update-title true] --body-file <description-file>
```

Step 2 只负责 HEAD commit subject 门禁。upsert wrapper 独立处理 PR title：创建路径校验候选标题；更新路径要求非空白 `--existing-title`，空白或缺失时 fail closed，合法时省略 `patch-pull --title`，不合法或 `--update-title true` 时才校验并传入候选标题。两条路径都会在任何 CNB 调用前通过 `pr-title.mjs` 的 placeholder helper，再执行 conventional title、route、source branch 与 expected Issue 强校验；infrastructure 绑定真实 Issue 时也必须传 `--expected-issue-id`，未绑定时只接受 `[no-issue]`。创建路径只允许一次 `post-pull`，并在第一次调用里同时传入最终 title/body；禁止“先用 test 创建再 patch 改名”。若命令退出码非 `0`，立即停止 Step 3；不得继续写 Issue 评论、不得进入「PR 已创建」终局提示。

### 3.5 创建/更新后的强制远端复验

`post-pull` / `patch-pull` 成功返回后，必须完成本节复验；复验未通过时，不得声称 PR 创建/更新成功。

1. 解析 `pr_iid`：
   - 优先从 `post-pull` / `patch-pull --verbose` 响应中读取 `iid` / `number` / `pull_request_iid` 等数字字段。
   - 若返回中无法解析，重新执行 §3.2 的 `list-pulls --verbose`，按当前分支 + `main` 精确过滤。
   - 仍无法得到唯一 `pr_iid` → 停止 Step 3，最终报告「PR 创建命令已执行，但未能验证远端 PR」。
2. 查询 PR 详情：

   ```bash
   cnb pulls get-pull --repo x-team/mindx --number <pr_iid> --verbose
   ```

3. 校验 PR 详情。必须全部满足：

   ```text
   PR 存在，且 state/status 为 open/opened
   source/head 分支 等于 当前分支
   target/base 分支 等于 main
   title 等于本次预期标题：创建/替换时为 `PR_TITLE_CANDIDATE`，保留时为 `CURRENT_PR_TITLE`
   production description/body 的唯一 Refs 与 source branch Issue 相同，AC-contract 等于刚从 Issue 复算的 digest（sha256: 或 legacy:sha256:），Target-label 唯一且为 待发布
   infrastructure description/body 的 AC-contract 与 Target-label 均唯一且为 none，Refs 至多一条
   ```

   若详情里提供 head SHA / latest commit SHA，还必须等于刚 push 的本地 `HEAD`；字段缺失时不因 SHA 缺失阻断，但要在最终提示中说明未校验 head SHA。

4. 解析 PR 链接：
   - 优先使用 `get-pull --verbose` 返回的 `web_url`。
   - 其次使用 `html_url`。
   - 只有在 `get-pull` 已确认 PR 存在且 `pr_iid` 唯一时，才允许兜底拼接：`https://cnb.woa.com/x-team/mindx/-/pulls/<pr_iid>`。

> **成功门禁**：只有 §3.5 全部通过后，才允许设置 `PR_VERIFIED=true`，后续 Issue PR 证据评论和 Step 6 成功提示都必须依赖 `PR_VERIFIED=true`。

> **禁止伪造**：禁止输出未经 `get-pull` 复验的 PR 链接；禁止把「创建命令已执行」描述成「PR 已创建成功」；禁止在拿不到 `pr_iid` 时根据时间、分支名或 URL 规律猜测 PR。

### 3.6 Target-label 自评

| 自评条件                                         | Target-label |
| :----------------------------------------------- | :----------- |
| production route，唯一 `Refs #<branch_issue_id>` | `待发布`     |
| infrastructure route                             | `none`       |

禁止写 `原型中` / `待研发` / `开发中` / `待二次加工` / `已发布`。PR 创建/更新只验证契约，不直接推进 Issue；production PR merge 后才由流水线执行 `开发中 → 待发布`。该流水线必须把初次读取的 Issue version/ETag 作为标签写操作的 `If-Match` CAS，冲突时失败关闭、禁止无条件重试；写后重新获取并复验 open 状态、AC digest、唯一 `待发布` 与全部非状态标签，只有复验通过后才写合并证据备注。

---

## Step 4: 明确冲突检测

本 skill 只在**明确检查到真实冲突**时自动进入冲突处理；否则不做主干同步、不做 rebase、不做 stash。

### 4.1 本地 dry-run 检测（轻量、无工作区改动）

在 commit 完成后、push 前或 push 后均可执行：

```bash
git fetch origin main --quiet
git merge-tree --write-tree HEAD origin/main >/tmp/cmd-publish-merge-tree.log 2>&1
```

判定：

- 退出码 `0`：没有明确本地冲突，继续。
- 退出码非 `0` 且输出包含 `CONFLICT` / `<<<<<<<` / `Auto-merging` 后失败信息：视为明确冲突，加载 `conflict-resolver`，传入 `base_branch=main`。
- 当前 git 不支持 `merge-tree --write-tree` 或命令异常无法判定：不阻断、不猜测，继续交给远端 PR/CI。

### 4.2 远端 PR merge_status 检测

PR 创建/更新且 §3.5 复验通过后，可查询 PR 状态，但必须同时满足以下条件才算“明确冲突”：

1. PR 为 open 状态；
2. PR source branch 等于当前分支；
3. PR target branch 等于 `main`；
4. PR head SHA 等于刚 push 的本地 `HEAD`；
5. `merge_status` / `detailed_merge_status` 明确为 `cannot_be_merged` / `merge_conflict` / `has_conflicts`，或 API 返回明确冲突文件。

满足全部条件 → 加载 `conflict-resolver`，传入 `base_branch=main`，解决后返回 Step 2 重新 push，再重跑 Step 3 / Step 4。

不满足全部条件 → 不进入冲突处理。若状态为 `checking` / `unchecked`，最多等待 2 秒重试 3 次；仍无明确结果则记入欠债 `verify_merge_status: pending`，继续后续步骤。

> 用户主动要求“解决冲突 / rebase / 同步主干”时，不走本节提示词，直接由 `conflict-resolver` skill 接管。

---

## Step 5: Issue PR 证据评论（不改 Issue AC）

> CNB CLI 不可用时跳过本步骤，提示 `cnb login --woa` 后重试。

> PR 未通过 §3.5 远端复验时，跳过整个 Step 5。不得给 Issue 写入未经验证的 PR 编号或链接。

### 5.1 Issue 评论同步

PR 通过 §3.5 远端复验后，给关联 issue 写入或更新一条标准评论：

```markdown
🔗 cmd-publish: PR #<iid> 已就绪

- PR: <web_url>
- 目标分支: main
- 标题: <verified PR title>
- AC-contract: <sha256:...|none>
- Target-label: <待发布|none>
```

幂等规则：

- 创建 PR 路径：直接创建评论
- 更新 PR 路径：按 `🔗 cmd-publish: PR #${pr_iid}` 精确匹配已有评论
  - 未找到 → 新建
  - 找到且内容一致 → 跳过
  - 找到但内容变化 → 更新原评论

### 5.2 Issue AC 保护

Issue description 中的结构化 AC 是唯一业务契约。`cmd-publish` 不读取本地 spec 来覆盖/追加 `## 📋 业务契约`，也不因 PR 内容自动改 AC。若实现过程中发现范围变化，回到产品确认并更新 Issue，再重新验证 PR；本步骤只保留 §5.1 的已验证 PR 证据评论。

---

## Step 6: 终局闭环提示

CNB CLI 正常且 `PR_VERIFIED=true`：

```text
✅ 代码已推送到分支: <当前分支>
✅ PR 已远端验证: #<pr_iid> <PR 链接>（目标: main）
✅ Issue 已同步: <Issue 链接>
```

CNB CLI 不可用：

```text
✅ 代码已推送到分支: <当前分支>
⏸️ PR 创建/更新: 暂停，执行 `cnb login --woa` 后重试
⏸️ Issue PR 证据评论: 暂停，执行 `cnb login --woa` 后重试
```

CNB CLI 可用但 PR 创建/查询/复验失败：

```text
✅ 代码已推送到分支: <当前分支>
❌ PR 创建/更新未完成或未通过远端复验: <失败原因>
⏸️ Issue PR 证据评论: 已暂停，避免写入未验证的 PR 信息
```
