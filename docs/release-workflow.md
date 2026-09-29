# MindX 产研交付与发布流程

> 本文是 Issue、原型、生产 PR 与发布状态的语义真相源。产品原型的详细用法见 [`prototype-workflow.md`](./prototype-workflow.md)。

## 1. 核心契约

1. **Issue 是研发实现的业务契约。**产品先建的想法进入`需求池`；也可以先用无 Issue 的 local draft 草稿探索，准备交付时再 promote 到`原型中` Issue。进入 Issue-bound 原型或研发前，以及每次范围变化后，都必须补齐结构化 AC。
2. **原型是可执行设计证据。**AI 分享存在未提交改动的 worktree 时，只构建 package 并委托 WorkBuddy 资料库发布；冻结时才提交并推送分支供研发参考。它不建 PR，也不是待合并代码。
3. **生产代码由研发从最新 `main` 独立实现。**研发可参考原型 Page，但不能 merge、整分支 cherry-pick 或携带原型运行时代码。

## 2. Issue、需求池与五态状态

除状态外，Issue 的治理维度保持分离：每个 Issue 必须且只能有一个 `type:*`；Epic 与 Sprint 使用任务集的文本属性，分别表示跨 Sprint 的长期目标和周度时间盒；Release 表示实际部署批次，不能替代 Epic、Sprint 或状态。

产品可以先创建 #123 再开始原型，此时 AI 直接复用并校验该 Issue。也可以不提供 Issue，直接说“开始一个 XX 原型”；没有 Issue 时进入 local draft 草稿，不创建 Issue，也不读取或校验 Issue，使用 `draft:<draftId>` 作为本地身份。草稿准备交付时必须 promote 到真实 Issue，Issue 需要 open、唯一`原型中`并补齐稳定验收项：

```markdown
## 验收标准

- [ ] AC-1: <可观察、可判定的行为>
- [ ] AC-2: <输入/操作/预期结果>
```

`需求池`是需求入口，不计入五态交付主线。它承载刚提出、尚未澄清或未承诺研发的想法，不能因创建而直接视为开发开始。

```text
需求池 ──需求已澄清──> 待研发
   │
   └──需要产品原型──> 原型中 ──prototype-handoff PASS──> 待研发

待研发 → 开发中 → 待发布 → 已发布 + closed
```

五态为`原型中`、`待研发`、`开发中`、`待发布`、`已发布`：

- 原型中：产品探索与分享；只允许原型流程进入。
- 待研发：需求或冻结原型已具备研发输入，等待或已明确研发接手。
- 开发中：研发已在正式生产分支实现。
- 待发布：实现与验收均已完成，等待随部署批次上线。
- 已发布：部署已完成；必须同时关闭 Issue。

验收不再占用独立状态。产品、QA 或提单人在 AC、评论和正式 PR、构建、发布证据中记录验收结论；验收未完成或不通过时，Issue 保持在`开发中`。

负责人表示当前阶段的行动主体，任何治理状态均不得为空：

| 阶段                   | 负责人                          |
| :--------------------- | :------------------------------ |
| 需求池、原型中         | 创建人                          |
| 待研发                 | 指定研发；未指定时为 `leoricxu` |
| 开发中、待发布、已发布 | 对应研发                        |

从`需求池`或`原型中`进入`待研发`时完成研发接手；之后研发负责人持续到发布归档。任一交付 Issue 同一时刻只能有一个状态标签。

## 3. 产品原型路径

产品只说八个动作：**开始、分享、暂停、继续、升级、冻结、丢弃草稿、放弃 Issue 原型**。

| 动作        | AI 的结果                                                                                                                                                                                |
| :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开始        | 已给出 Issue 时直接复用并校验；没有 Issue 时建立 `draft:<draftId>` 本地草稿。随后在最新 `main` 的独立受管 worktree 准备并启动原型。                                                      |
| 分享        | active 或 paused 都可从当前 dirty worktree build、verify、package 出 ≤200 文件 ZIP，经 `share-prepare → WorkBuddy 内置资料库 skill → share-complete/share-reject` 分享；不 commit/push。 |
| 暂停 / 继续 | 停服务或在同一 worktree 检查后重启；草稿和 Page 保留，且不读取 Issue。                                                                                                                   |
| 升级        | draft 用 promote 绑定 open、唯一`原型中`且含结构化 AC 的 Issue，保留 worktree，迁移 runtime identity，并重新分享。                                                                       |
| 冻结        | draft 不可直接冻结；active 或 paused 的 Issue-bound 原型校验 tree 后才 commit/push，再把最小 Page/package 回执、checkpoint 与交接写回 Issue并转为`待研发`。                              |
| 丢弃草稿    | 只清理 local draft 的受管 worktree，不访问或关闭 Issue；无法确认停止或删除失败时保留状态。                                                                                               |
| 放弃        | 仅适用于 Issue-bound 原型：条件关闭 Issue 并清理自己的 worktree。                                                                                                                        |

已有`需求池` Issue 开始原型前，先补齐 AC，并将状态切换为唯一`原型中`；不能同时保留两个状态。

`draft` 草稿与 issue-bound Issue 原型共用 `ACTIVE_LIMIT=3` 三个运行槽；只有 `starting` 与 `active` 占槽。准备可并发创建受管 worktree，启动前必须在锁内重新检查容量；满额时保留 `worktree_ready`，不 spawn 第四个 service。暂停会释放端口与运行槽。

原型工作永远不触碰主工作区：不得切换、reset、clean、install 或删除主工作区。依赖只在受管 worktree 用 frozen lockfile 准备。评审链接使用资料库 Publisher 返回的正式 HTTPS `publish_url`；裸页面仍可访问 `#/space/home`。

## 4. 研发实现路径

研发运行 `implement-issue`：

1. 读取当前 Issue AC 和可选的 Page 交接说明。
2. `git fetch origin main`，从 `origin/main` 建 `feature|bugfix/<issue-id>-<slug>`。
3. 确认 Issue 已由`待研发`推进到`开发中`，接入真实 Record、真实业务接口与生产协同。
4. 以 Issue 为准，选择性参考 Page；原型代码可以重写或丢弃。

生产分支禁止包含 prototype merge commit / 整区间 cherry-pick、`prototype.config.json`、`apps/mindx/src/prototype/**`，以及 prototype fixture、mock interceptor 或静态专用入口。

## 5. 生产 PR 与 Issue 状态

生产 PR description 最少包含：

```markdown
Refs #<issue-id>
AC-contract: sha256:<current-issue-ac-digest>
Target-label: 待发布
```

纯工程化且无需状态推进时可以使用 `AC-contract: none` 与 `Target-label: none`，但不能只凭分支名或 commit type 豁免。可信 CI 以 `merge-base..PR head` 的累计 diff 为准，并按**改动性质**而不是 `packages/**` 等顶层目录分类。明确允许的类别只有：

- 分类器显式列出的仓库根工程配置；
- `.agents/**`、`.cnb/**`、`.codebuddy/**`、`.github/**`、`.husky/**`、`.vibe/**`、`docs/**`、`scripts/**`、`tools/**` 工程目录；
- 任意位置的 `.md` 文档；
- 精确位于 `packages/*/.business-frozen.json` 的工程治理元数据；
- basename 严格匹配 `*.test.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` 或 `*.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}`、不进入生产产物的工程验证代码。

例如 PR #1850 的 `packages/ui-components/README.md`、`packages/ui-elements/README.md` 与 `packages/ui-components/.business-frozen.json` 按性质属于文档/工程治理资产，可以走无 Issue 路由。该规则不放行整个 `packages/**`、任意 JSON/隐藏文件、宽泛 `test/` 目录、近似测试名或其他未知路径；`packages/**/src/**`、`apps/mindx/**` 与根 `src/**` 中除上述明确文档/严格测试类别外的业务或运行时代码不获豁免。累计 diff 只要混入任一业务、运行时、未知或非法路径，就 fail closed。

被分类器拒绝的 PR 必须绑定真实 Issue，改走 `feature|bugfix/<issue-id>-<slug>`、真实 AC digest 与 `Target-label: 待发布`。

路径合规只决定能否走无 Issue 路由，不能替代非空 PR description。PR #1850 即使累计 diff 全部命中上述允许类别，description 仍至少必须包含：

```markdown
AC-contract: none
Target-label: none
```

- PR create/update 阶段校验引用、当前 Issue AC digest、目标状态与 Issue 当前状态，不提前修改 label。
- 只有 production PR merged 事件才把`开发中`推进到`待发布`。
- source 为 `prototype/**` 的 PR 必须由首个 CI guard 立即失败。
- 所有 PR 的唯一合法 target 是受保护的 `main`。
- 发布完成后执行 `changelog`：`待发布 → 已发布 + closed`。

## 6. Commit 与 Issue 绑定

```text
<type>: <subject> #<issue-id>
<type>: <subject> [no-issue]
```

- 原型分享不走 `cmd-publish`：直接从 dirty worktree 构建 package 并委托资料库 Publisher，不 commit/push。`cmd-publish` prototype route 只在冻结时固定最近分享 tree；永不创建 PR 或合并。
- 开发者 `feat` / `fix` 必须带真实 Issue。
- 开发者纯工程 `chore/docs/refactor/style/test/build/ci/perf` 只有累计改动全部命中上述显式工程资产类别，才可按规则使用 `[no-issue]`；mixed diff 中任一业务/运行时或未知路径都会取消豁免。
- `revert` 必须绑定真实 Issue，不得使用 `[no-issue]`。
- 禁止 `#0`、`#000`、编造 Issue 与 `--no-verify` 绕过。

## 7. 权威入口

| 场景                                  | Skill / Rule                                            |
| :------------------------------------ | :------------------------------------------------------ |
| 产品开始、暂停、继续原型              | `prototype-workflow`                                    |
| 产品分享原型                          | `prototype-deploy`                                      |
| 产品冻结原型                          | `prototype-handoff`                                     |
| 研发实现                              | `implement-issue`                                       |
| 原型 checkpoint（commit/push，无 PR） | `cmd-publish` prototype route                           |
| 生产提交与 PR                         | `cmd-publish` production route                          |
| 原型不可合并性                        | `prototype-route.mdc` + `check-prototype-pr-policy.mjs` |
