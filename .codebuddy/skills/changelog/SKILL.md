---
name: changelog
description: >
  发布后处理管线：切到当天最新 hotfix 发布分支、安装对应版本 SDK，补齐当天所有 hotfix 发布区间的增量 commit，
  智能总结生成 CHANGELOG.md（含从 SDK 自身 CHANGELOG 抽取的版本区间产品向变更、从 mindx-kit 提取资料库 Skills 变更），
  并把关联的 <待发布> issue 推到 <已发布> + 关闭。生成结果留在本地，由用户自行提交。
  当用户说"生成 changelog"、"更新 changelog"、"发布后处理"、"/changelog"，
  或发布流水线跑完后通知 AI 收尾时触发此 skill。
  仅开发者可执行（角色判定权威源 `.vibe/developer-allowlist.json`），非开发者直接忽略。
---

# Command: Changelog（发布后处理 + 智能变更日志）

本 skill 是发布流的收尾出口。它用 AI 做**智能总结**（读 issue 正文产出产品向一句话、对无 issue 的 commit 去噪提炼、读 SDK 自身 CHANGELOG 抽取版本区间变更、读 mindx-kit 当日 skill markdown diff 提炼资料库 Skills 变更、跨条目去重合并），而非机械拼接 `[title](url)`。

> ⚠️ **触发时机**：发布流水线跑完（hotfix 分支已 push 到远端 + 部署到生产）之后，由开发者手动通知 AI 执行。本 skill 不检测发布流是否完成。

> 📌 **本 skill 不提交代码**：生成的 `CHANGELOG.md` 改动**留在本地工作区**，不自动 commit / push / 建 PR / 合并，由用户 review 后自行提交。但 issue 状态机推进（`待发布 → 已发布` + 关闭）仍由本 skill 通过 CNB CLI/API 直接完成（与 git 提交无关）。

---

## 0. 权限门禁（不可跳过）

执行任何步骤前，先判定角色：

1. 运行 `git config user.name`，与 `.vibe/developer-allowlist.json` 的 `developers[].username` 比对
2. **命中 → 开发者 → 继续**
3. **未命中 → 非开发者 → 立即终止**，输出：
   > 本 skill 仅开发者可执行。你的角色是产品经理/设计师，发布后处理请联系研发同学执行。

---

## 1. 闸门声明

本 skill **不再自动 commit / push / PR / merge**，因此默认只触发 1 个闸门：

- **DevWorkflow**：本 skill 会写 `CHANGELOG.md`。执行写入前输出
  `[DevWorkflow] 分档=L2，理由=发布后处理（仅生成 CHANGELOG.md，不提交代码）`
- **IssueBinding**：本 skill 不执行 `git commit`，**不触发**。issue 状态更新走 CNB CLI/API，与 commit 无关。
- **ConflictResolver**：`git checkout <已存在的远程 hotfix 分支>` 属普通切分支，不改写历史，**不触发**。仅当切分支 / install 过程意外引发 rebase/merge 冲突时才加载 `conflict-resolver` skill。

---

## 2. 执行流程

### Phase 0 · 切到当天最新 hotfix 发布分支

发布分支命名规范：`hotfix/<YYYYMMDD>_<HHmm>_mindx`

```bash
# 0.1 同步远端
git fetch origin --prune

# 0.2 工作区检查：若有未提交改动，提示用户先 commit/stash 后终止
git status --porcelain   # 非空 → 提示并终止（避免 checkout 丢失本地改动）

# 0.3 按"当天日期"匹配所有 hotfix 分支：hotfix/YYYYMMDD_HHmm_mindx
git for-each-ref --sort=refname --format='%(refname:short)' 'refs/remotes/origin/hotfix/*' \
  | sed 's#^origin/##' \
  | grep -E "^hotfix/$(date +%Y%m%d)_[0-9]{4}_mindx$"
```

- 命中 → 按时间正序记为 `TODAY_HOTFIXES`；取最后一条（最新）记为 `CURR_HOTFIX`，执行 `git checkout "$CURR_HOTFIX"`（已存在的远程分支会自动建跟踪本地分支）
- **找不到当天 hotfix 分支 → 反馈用户并退出**：
  > 未找到当天（YYYYMMDD）的发布分支 `hotfix/YYYYMMDD_HHmm_mindx`，请确认发布流水线是否已跑完、分支是否已推到远端。
- 从 `CURR_HOTFIX` 名解析发布日期 → `BASE_DATE=YYYY-MM-DD`，作为 CHANGELOG 段落锚点 `## YYYY-MM-DD`
- 派生 `KIT_DATE = BASE_DATE - 1`（前一天），作为 mindx-kit commit 提取窗口。原因：发布流水线通常在 T 日打包 T-1 日的 mindx-kit 改动，T 日当天新写的 mindx-kit commit 尚未随发布上线，应归入下一次发布

> ⚠️ CNB 健康检测：先执行 `cnb status` 探活。不可用或未登录 → 终止并提示用户执行 `cnb login --woa` 后重试（本 skill 强依赖 CNB 读 issue / 改 label）。

### Phase 0.5 · 安装对应版本 SDK（关键，决定 Phase 5 能否读到正确 CHANGELOG）

切到当天最新 hotfix 分支后，本地 `node_modules` 仍是切换前的版本，**必须重装**让 SDK 版本与当天最新发布对齐：

```bash
pnpm install        # 按当天最新 hotfix 分支的 lockfile 安装对应版本 SDK
pnpm prune          # 可选：清理历史残留版本，避免 .pnpm 下多版本干扰读取
```

- install 失败 → 反馈用户并终止（无法保证读到正确版本的 SDK CHANGELOG）

### Phase 1 · 构造当天待补齐的发布区间（用于 diff）

```bash
# 按 refname 正序列出所有 origin/hotfix/*_mindx 分支（等价于按 YYYYMMDD_HHmm 时间正序）
git for-each-ref --sort=refname --format='%(refname:short)' 'refs/remotes/origin/hotfix/*' \
  | sed 's#^origin/##' \
  | grep -E '^hotfix/[0-9]{8}_[0-9]{4}_mindx$'
```

- 从结果中取出当天所有分支，按时间正序得到 `TODAY_HOTFIXES=[H1,H2,...,Hn]`
- 找到 `H1` 的**上一条**（更旧的一条）→ `BASE_HOTFIX`
- 不足 2 条（找不到 `BASE_HOTFIX`）→ 终止并提示（至少需要当天第一条 hotfix 之前的一条发布分支，才能 diff 增量 commit 与 SDK 版本变化）
- 构造待补齐区间 `RELEASE_WINDOWS`：
  ```
  BASE_HOTFIX..H1
  H1..H2
  ...
  H(n-1)..Hn
  ```
- 即使当天前几次发布后忘记执行本 skill，也会在当天后续任意一次执行时重新扫描所有 `RELEASE_WINDOWS`，再通过 CHANGELOG 合并去重与 issue 状态过滤保证幂等。

### Phase 2 · 提取增量 commit（issueid 三层兜底恢复）

> ⚠️ **绝对不能只读 `%s`（subject）**。必须同时读 **subject + body**，并对 squash/merge commit 做 PR 回溯。
>
> **为什么**：Squash 合并会把整条 feature 分支压成一个 commit，其
> **subject = PR 标题、body = PR description 原文**（注意：**不是**所有原始 commit message 的拼接）。
> 如果 PR 标题是人工在 web 界面手写、漏了 issueid，subject 就没有 issueid；
> 而原分支各 commit 的 `#<id>` 此时**只可能残留在 body / PR 描述**里，甚至可能一个都不剩。
> 历史事故：PR #375 squash 后 subject=`feat: 支持文档跨空间移动`（无 id），`#227` 仅残留在 body，
> 只读 subject 直接整片丢失该 issue。

```bash
# 对 RELEASE_WINDOWS 的每个区间分别执行；用 \x1f 分隔字段、\x1e 分隔记录，安全捕获多行 body（含 squash 合并脚注）
git log $FROM_HOTFIX..$TO_HOTFIX --no-merges \
  --pretty=format:'%H%x1f%s%x1f%b%x1e'
```

遍历 `RELEASE_WINDOWS` 中**每个区间的每条** commit，按以下三层顺序收集 issueid，**全部并入 `related_issueids` 并按 issueid 去重**：

> 所有裸 `#<issueid>` 都按 `x-team/mindx` 仓库 issue 读取。若该 id 实际来自其它仓库（如 genie），在 mindx 读取不到时直接跳过并记录原因，不做跨仓兜底。

1. **subject 末尾**（原规则，保留）：匹配 `#([1-9]\d*)\s*$`
2. **全文兜底扫描**：对 `subject + "\n" + body` 全局匹配 `#([1-9]\d*)`，抽出所有出现的 issueid
   - 不必担心误命中：Phase 3 会逐个调 CNB 校验 `state==opened && labels 含 待发布`，
     AI 摘要里偶然出现的数字会被自然过滤掉
3. **squash / merge commit 的 PR 权威回溯**（最稳，专治 subject 被手写标题顶掉）：
   若 body 含 CNB PR 合并脚注或可解析的 PR 链接，说明这是一次 PR 合并：
   - 解析出 `<iid>`，通过 `cnb pulls get-pull --repo x-team/mindx --number <iid>` 或 CNB API 读取该 PR 的 `title` + `description`，
     再全局扫一遍 `#([1-9]\d*)` 补齐 subject 丢掉的 issueid

分组规则：

- 上述任一层命中 issueid 的 commit → 计入 `related_issueids`
- subject 末尾 `[no-issue]` **且**全文 + PR 回溯都扫不到任何 `#<id>` 的，或无任何引用的旧 commit
  → `no_issue_commits`（保留 commit hash + subject + 所属发布区间，进入 Phase 4 提炼；同一 hash 只保留一次）

### Phase 3 · 读 issue 并智能总结（带 issueid 的 commit）→「资料库」分类

遍历 `related_issueids`，对每个 id 调 `cnb issues get-issue --repo x-team/mindx --number <id>` 或 CNB API：

- **筛选条件**：`state == opened` **且** labels 含 `待发布` → 计入 `release_issueids`
- 不满足（已发布 / 原型中 / 待研发 / 开发中 / 不存在）→ 跳过 + 记录原因（见 Phase 9 报告）
- 对计入的 issue：读 `title` + `description`，**智能总结成一句产品向描述**，记入「资料库」分类的 `changelogs`
- **MindX issue 链接硬规则**：`### 资料库` 中所有 MindX 自身 issue 链接必须使用 CNB 模板生成，不得从 issue body、历史 CHANGELOG、迁移自工蜂尾注或旧 `git.woa.com/tencent-doc-wuhan/mindx/issues/<id>` 链接反推：
  ```
  MINDX_ISSUE_URL = https://cnb.woa.com/x-team/mindx/-/issues/<issueid>
  ```
- 「资料库」issue 条目格式：
  ```
  - <一句话产品向总结> ([#<issueid>](https://cnb.woa.com/x-team/mindx/-/issues/<issueid>))
  ```

### Phase 4 · 提炼无 issue 的 commit →「资料库」分类

遍历 `no_issue_commits`，按以下规则筛选（宁缺毋滥）：

1. 只看 type 为 `feat` / `fix` / `refactor` / `perf` 的 commit
2. 判断 subject 是否含**业务 / 功能 / bug 修复 / 性能优化**语义，有则保留并提炼成产品向一句话
3. **丢弃**：工具 / 测试 / 文档 / 配置 / 流程 / 流水线 / 依赖升级（SDK 升级走 Phase 5）/ 信息过简或无意义的 commit
4. fix 类提炼后归入「资料库」的 `bugfix` 子分组，其余归入「资料库」主列表

### Phase 5 · SDK 升级检测 + 从 SDK CHANGELOG 抽取版本区间变更（核心改造）

仅追踪以下 4 个 SDK，并按固定中文标题输出：

| npm 包名                         | CHANGELOG 段标题（H3） |
| :------------------------------- | :--------------------- |
| `@tencent/smart-doc-editor`      | **文档编辑器 SDK**     |
| `@tencent/docs-ai-page-database` | **表格 SDK**           |
| `@tencent/docs-ai-page-host`     | **AI Page SDK**        |
| `@tencent/smart-engine`          | **智能引擎 SDK**       |

#### 5.1 计算版本区间 `(oldVer, newVer]`

```bash
# 旧版本：从 BASE_HOTFIX 的 catalog 取，剥掉 ^ / ~ 前缀
git show $BASE_HOTFIX:pnpm-workspace.yaml
```

- **oldVer**：`BASE_HOTFIX` 的 catalog 中各 SDK 的版本（去掉 `^` / `~`）
- **newVer**：从**当天最新 hotfix 已 install 的真实包**取（最准），多路径兜底读取包的 `package.json` 的 `version` 字段（见 5.2）
- `oldVer == newVer` → 该 SDK 本次无升级，**不输出**对应 H3
- `oldVer != newVer` → 该 SDK 在当天任意一次发布中升级，进入 5.3 抽取 CHANGELOG

> 多次发布同日合并：SDK 分类按当天总区间输出一次，不按 `RELEASE_WINDOWS` 拆多段。例如当天先后从 `2.94.1 → 2.95.0 → 2.96.1`，最终只输出 `- 从 2.94.1 升级到 2.96.1`，CHANGELOG 抽取区间为 `(2.94.1, 2.96.1]`。

#### 5.2 多路径兜底定位 SDK 包目录

按以下顺序逐一尝试，命中即用（不同 SDK 安装位置不同，实测 `smart-engine` 在仓库根，其余三个在 `apps/mindx`）：

```
1. apps/mindx/node_modules/@tencent/<pkg>
2. node_modules/@tencent/<pkg>
3. node_modules/.pnpm/@tencent+<pkg>@*/node_modules/@tencent/<pkg>   # glob，取版本匹配 newVer 的那个
```

从命中目录读 `package.json` 拿真实 `newVer`，读 `CHANGELOG.md`（可能不存在）。

#### 5.3 抽取 `(oldVer, newVer]` 区间的 CHANGELOG 并产品向改写

SDK 自身 CHANGELOG 真实结构（以 smart-doc-editor 为例）：

```markdown
## 2.80.0 (2026-06-18)

### ✨ Features

- 支持表格内图片边缘点击插入空行 (#61) ([3d752af](https://git.woa.com/.../commit/3d752af...))

### 🐛 Bug Fixes

- 修复删除混合列表后撤销导致服务端提交失败的问题 (#49) ([f805c85](https://.../commit/...))
- 修复移动端预览态切换时框选态不消失 (--bug=159474730) ([13aead8](https://.../commit/...))

### ♻️ Refactoring

- ...
```

抽取规则：

1. **区间过滤**：用 **semver 比较**，取所有 `## X.Y.Z (...)` 版本块中满足 `oldVer < X.Y.Z <= newVer` 的块
   （CHANGELOG 顶部声明"未列出的版本仅同步版本号、无功能变更"，故版本号可能跳跃，必须用 semver 比较而非连续假设）
2. **产品向改写**（与「资料库」同一标准）：
   - 行文以**产品功能 / 解决的问题**为维度，普通用户能看懂，去掉技术术语
   - **丢弃纯技术内容**：重构（`♻️ Refactoring`）、内部实现细节、构建/依赖/类型/测试相关条目
   - `✨ Features` 提炼后进主列表，`🐛 Bug Fixes` 提炼后进该 SDK 的 `bugfix` 子分组
3. **链接 / 尾注处理**（用户确认：无效信息丢弃）：
   - `([hash](commit链接))` 是 commit 外链 → **丢弃**
   - `(#61)` / `(--bug=159474730)` / `(mindx#200)` 是纯文本尾注 → **丢弃**
   - **仅当**条目中出现真正的 **issue markdown 链接** `[文案](.../issues/123)` 才保留
   - 净结果：SDK 条目通常是**纯描述正文**，不带任何尾注
4. **首行固定**：该 SDK 的 H3 下，第一行永远是版本区间：
   ```
   - 从 <oldVer> 升级到 <newVer>
   ```

#### 5.4 读取失败降级

若 SDK 的 `CHANGELOG.md` **不存在 / 读取失败 / 区间内无有效条目**（实测 `docs-ai-page-database`、`docs-ai-page-host`、`smart-engine` 当前都无 CHANGELOG.md）：

- 该 SDK 的 H3 下**只输出一行版本号**：
  ```
  - 从 <oldVer> 升级到 <newVer>
  ```

### Phase 6 · mindx-kit 资料库 Skills 变更提取

mindx-kit 仓库地址：`https://git.woa.com/tencent-doc-wuhan/mindx-kit`

定位关系：

- `mindx` 是资料库项目本体
- `mindx-kit` 提供给 AI Agent 使用的 Skills，让 Agent 知道如何向 MindX 添加 / 更新文档、与用户协作等

mindx-kit 当前没有自己的 `CHANGELOG.md`，因此按 `KIT_DATE`（即 `BASE_DATE - 1`）提取该仓库对应日期的 commit，并结合 commit message / body / markdown diff 做 AI 智能总结。

> ⚠️ **为什么是 BASE_DATE - 1**：发布流水线在 T 日发布的是 T-1 日的 mindx-kit 改动（T 日当天新写的 kit commit 尚未随发布上线）。若错取 `BASE_DATE`，会漏掉真正随本次发布上线的 kit 改动，把它挂到下一次 changelog 又造成日期语义混乱。

#### 6.1 准备 mindx-kit 仓库

优先复用本地临时 clone；不存在则 clone：

```bash
MINDX_KIT_REPO_URL="https://git.woa.com/tencent-doc-wuhan/mindx-kit"
MINDX_KIT_DIR="/tmp/mindx-kit-changelog"

# 若已存在：git -C "$MINDX_KIT_DIR" fetch origin --prune
# 若不存在：git clone "$MINDX_KIT_REPO_URL" "$MINDX_KIT_DIR"

MINDX_KIT_REF=$(git -C "$MINDX_KIT_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's#^origin/##')
MINDX_KIT_REF=${MINDX_KIT_REF:-main}
```

- 网络 / 权限 / clone / fetch 失败 → 不阻塞 MindX changelog 主流程，但 Phase 9 必须报告 `资料库 Skills 跳过：mindx-kit 仓库不可访问`
- 默认读取 `origin/HEAD` 指向的分支；若读取不到则兜底 `origin/main`

#### 6.2 提取 `KIT_DATE`（= `BASE_DATE - 1`）当天 commits

```bash
# KIT_DATE = BASE_DATE 前一天，例如 BASE_DATE=2026-07-02 → KIT_DATE=2026-07-01
git -C "$MINDX_KIT_DIR" log "origin/$MINDX_KIT_REF" \
  --since="$KIT_DATE 00:00:00 +0800" \
  --until="$KIT_DATE 23:59:59 +0800" \
  --no-merges \
  --pretty=format:'%H%x1f%s%x1f%b%x1e'
```

对每个 commit 继续读取：

```bash
# 变更文件概览
git -C "$MINDX_KIT_DIR" show --stat --name-only --format= $COMMIT

# 重点读取 markdown diff（skill 内容通常是 .md）
git -C "$MINDX_KIT_DIR" show --format= --unified=80 $COMMIT -- '*.md'
```

#### 6.3 智能总结规则

输入信息：

- commit hash / subject / body
- `git show --stat --name-only` 文件概览
- markdown diff，重点关注 skill 的说明、命令、参数、约束、示例、Agent 行为变化

输出分类：固定写入 `### 资料库 Skills`（位于当天段落最底部，所有 SDK 分类之后）。

总结标准：

1. 只保留 Agent / 用户可感知的 Skill 能力变化：新增能力、已有能力行为调整、参数 / 命令变化、协作流程变化、重要安全 / 约束变化
2. `feat` / 行为增强 / 文档能力新增 → 进主列表，写成产品向一句话
3. `fix` / 修复 Agent 使用 Skills 的问题 → 进 `bugfix` 子分组
4. 丢弃纯工程内容：测试、构建、格式化、依赖、CI、无行为变化的重构、仅内部措辞微调
5. 不输出 commit hash；除非 commit body / diff 中存在真正可读的 issue markdown 链接，否则不保留尾注链接
6. 当天无 commits 或无有效产品向条目 → 不输出 `### 资料库 Skills`

#### 6.4 幂等与去重

- 同一 commit hash 只处理一次
- 写入侧按生成文案二次去重
- 同一天补跑时，`资料库 Skills` 合并到同一 `## <BASE_DATE>` 段，不重复追加

### Phase 7 · 整合写入 CHANGELOG.md

按下方「§3 CHANGELOG 内容规范」整合，写入 `CHANGELOG.md`：

- 段落锚点：发布当天日期 `## YYYY-MM-DD`（**H2**）
- 分类小节（**H3**）：`### 资料库` + 各升级 SDK 的中文标题 + `### 资料库 Skills`
- 「资料库」**总是输出**（即便只有 bugfix）；某 SDK 无升级则**不输出**其 H3
- 「资料库 Skills」仅在 mindx-kit 当天有有效产品向条目时输出，且固定放在当天段落最底部
- 当天若已存在同名 `## YYYY-MM-DD` 段（同日多次发布或补跑）→ **合并到同一段**并按分类去重，不新建段
- 去重优先级：带 issue 条目按 issue 链接 / `#<issueid>` 去重；无 issue commit 按 commit hash 去重后再按生成文案去重；SDK 分类按 H3 标题合并且版本首行使用当天总区间；资料库 Skills 按 mindx-kit commit hash + 生成文案去重
- 新段插入到 header / `<!-- AUTO-GENERATED-SECTIONS-BELOW -->` marker 之后、最近一段之前（倒序，新的在上）

### Phase 8 · 关闭已发布 issue（通过 CNB，与 git 提交无关）

遍历 `release_issueids`，对每个 issue 通过 `cnb issues put-issue-labels` + `cnb issues update-issue` 或 CNB API 更新：

- `labels`: 差量更新——保留所有**非状态** label，把状态 label 替换为 `已发布`
  ```
  newLabels = oldLabels.filter(l => !["原型中","待研发","开发中","待发布","已发布"].includes(l)).concat("已发布")
  ```
- `state_event`: `close`
- 使用 CNB issue number（URL 中 `/issues/<number>` 的编号）

> 本步骤不依赖 git commit / PR，直接执行（用户已确认采用此策略）。

### Phase 9 · 汇总报告（不提交代码，留在本地）

输出：

- ✅ 当前所在分支：`CURR_HOTFIX`（当天最新 hotfix，已切换 + 已 `pnpm install`）
- ✅ 本次扫描的发布区间：`RELEASE_WINDOWS`
- ✅ 写入 CHANGELOG 的分类与条目数（资料库 / 各 SDK / 资料库 Skills / bugfix 统计）
- ✅ mindx-kit 提取结果：commit 数、有效条目数；如跳过则列明原因
- ✅ 推到 `<已发布>` + closed 的 issue 列表
- ⏭ 跳过的 issue（已发布 / 原型中 / 待研发 / 开发中 / 不存在）及原因
- 📌 **提示用户**：
  > CHANGELOG.md 已在本地分支 `<CURR_HOTFIX>` 更新完成，未自动提交。请 review 后自行 `git add CHANGELOG.md && git commit && git push`（或按你的发布流程处理）。

> ⛔ 本 skill **不执行** `git add` / `git commit` / `git push` / 建 PR / 合并。

---

## 3. CHANGELOG 内容规范

```markdown
## YYYY-MM-DD

### 资料库

- <issue 内容的一句话产品向总结> ([#<issueid>](issue_link))
- <无 issue commit 提炼的功能描述>
- bugfix：
  - 修复 xxxx 问题
  - 修复 yyyy 问题

### 文档编辑器 SDK

- 从 2.79.0 升级到 2.80.0
- <从 SDK CHANGELOG 抽取并产品向改写的功能描述>
- bugfix：
  - 修复 xxxx 问题

### 表格 SDK

- 从 0.7.3 升级到 0.7.4

### AI Page SDK

- 从 0.6.2 升级到 0.6.3

### 智能引擎 SDK

- 从 3.2.0 升级到 3.3.0

### 资料库 Skills

- 新增 xxx 功能
- bugfix：
  - 修复 xxxx 问题
```

**核心要求**：

1. 标题层级固定：日期 = **H2 `##`**，分类（资料库 / 各 SDK）= **H3 `###`**
2. 行文以**产品功能 / 解决的问题**为维度，让普通人都能看懂，不要纯技术术语
3. 「资料库」= MindX 自身变更（issue 总结 + 无 issue commit 提炼 + bugfix）
4. SDK 分类 = 4 个固定包；首行固定 `- 从 a 升级到 b`，其下为从该 SDK CHANGELOG 抽取的产品向变更
5. 无升级的 SDK 不输出其 H3；CHANGELOG 读取失败的 SDK 只保留首行版本号
6. SDK 条目丢弃 commit 外链与 `(#nn)`/`(--bug=)`/`(mindx#nn)` 等无效尾注，仅保留真正的 issue markdown 链接
7. `### 资料库 Skills` 来源于 mindx-kit 仓库 `KIT_DATE`（`BASE_DATE - 1`）当天 commit + markdown diff，位于当天段落最底部；无有效条目则不输出
8. 同一天多次发布或补跑 → 合并到同一段；最终整体去重、合并、排序

---

## 4. 幂等保证

- 同一天重复跑：重新扫描当天所有 `RELEASE_WINDOWS`；issue 已是 `<已发布>` → 跳过；CHANGELOG 同名段按分类去重，不重复写
- 当天漏跑前一次 hotfix：后续补跑会从 `BASE_HOTFIX..当天第一条` 开始补齐所有区间，避免遗漏
- 不同 hotfix 引用同一 issue：第二次发现 `<已发布>` 直接跳过；写入侧按 `#<issueid>` 去重
- 无 issue commit：同一 hash 只处理一次；写入侧按生成文案二次去重
- SDK 区间无变化（`oldVer == newVer`）→ 不输出该 SDK H3；同日多次升级合并为当天总区间
- mindx-kit：同一 commit hash 只处理一次；`资料库 Skills` 写入侧按生成文案二次去重
- 重复执行不产生重复段；多次发布同日合并到同一 `## YYYY-MM-DD` 段

---

## 5. 流程要点（相比旧版本）

| 维度        | 说明                                                                                                                                                                    |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源分支      | 不再用默认主干直接生成 changelog，而是 `git fetch` 后切到当天最新 `hotfix/...` 发布分支                                                                                 |
| 漏跑补齐    | 不再只 diff 最新 hotfix 与上一条 hotfix，而是扫描当天所有发布区间                                                                                                       |
| 依赖安装    | 切到当天最新 hotfix 后 `pnpm install`（+ 可选 `pnpm prune`），保证 SDK 版本对齐                                                                                         |
| 内容生成    | AI 智能总结产品向描述（issue / 无 issue commit / SDK CHANGELOG 抽取）                                                                                                   |
| SDK 升级    | 不止版本号——读 SDK 自身 CHANGELOG，抽取当天总 `(old, new]` 区间产品向变更                                                                                               |
| Skills 变更 | 读取 mindx-kit 的 `KIT_DATE`（=`BASE_DATE - 1`）当天 commit message / body / markdown diff，生成资料库 Skills 分类。避免把 T 日当天尚未上线的 kit commit 错算进本次发布 |
| 标题层级    | 日期 H2 + 资料库/SDK 分类 H3                                                                                                                                            |
| 提交行为    | **不自动 commit/push/PR/merge**，改动留本地由用户提交                                                                                                                   |
| issue 状态  | 仍通过 CNB 推 `待发布 → 已发布` + close（与 git 无关）                                                                                                                  |

> 存量 CHANGELOG 段维持原格式（旧的「## 日期 + 平铺列表」），不回溯改造；渲染器同时兼容新旧两种结构。
