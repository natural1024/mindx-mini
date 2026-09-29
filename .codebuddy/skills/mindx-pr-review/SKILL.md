---
name: mindx-pr-review
description: 对 target=main 的 MindX PR 做只读 AI 评审，按仓库契约和关联 SDK 边界输出可定位的必改建议与结构化结果。
---

# MindX PR Review

本 skill 供 CNB 的非 work-mode NPC 评审 target=`main` 的 MindX PR。它必须像 `mr-review` 一样，把完整总评发布到 PR 普通评论区，并在一个 comment 类型 review 中把能稳定定位的 blocker 发布成 CNB diff 行级评论。Review body 保留同一份总评，确保行级评论所属 Review 也有可读上下文。

`必改` 只是给人工 reviewer 的建议，不会 Approve、request changes 或直接阻止合并。人工 Approve、必需状态检查、无冲突全部满足后，仍由仓库现有 `pull_request.mergeable -> git:auto-merge` 合入。

## 权限边界

1. 不得修改仓库文件或 git 状态，不得 install、build、test、lint、typecheck、push、approve、request_changes、merge。
2. 可以写的本地文件只有 `/tmp/mindx-pr-review-body.md`；不得把评审产物写进仓库。Review 与普通评论必须复用该文件，因而携带完全相同的 head meta。
3. 唯一允许的平台写操作是：缺少行级 Review 时调用一次 `cnb pulls post-pull-review --event comment`，缺少普通总评时调用一次 `cnb pulls post-pull-comment`。已有其一时只补另一个，已有两者时不写；不得调用其他写 API。
4. 正常评审必须同时存在于 PR 普通评论区和 comment 类型 Review，不能只把正文留在 Review body、assistant 回复或流水线日志。任一发布失败时不得重试写操作或伪装成功；保留已成功的一半，下一次同 head 评审只补缺项，并在最终回执中明确失败。
5. 只评 collector 的 `context.expected_head_sha` 与 user prompt 共同指定的 head。历史债、其他 PR、同 issue 旧提交只能作背景，不能算本 PR blocker。

## 成本边界

不要读取 `.codebuddy/agents/code-review-agent.md`，也不要一开始完整读取多份通用规范。严格按以下顺序控制上下文：

流水线先运行 `scripts/collect-pr-context.py collect`，再启动 NPC。三个输入通过 Pipeline 级临时 data 卷 `/mindx-pr-review:data` 在任务容器间共享；缺失、为空或互相矛盾时立即停止，不得发布 review，流水线的 `failStages` 会另发普通失败提示：

- `/mindx-pr-review/context.json`：PR、完整 changed path 元数据、commits、普通评论、reviews、逐 review 行评，以及关联 Issue 正文和评论。完整路径从 `contents_url`/`blob_url` 严格解析；`files` 已删除 API 返回的 `patch`/`diff` 字段。
- `/mindx-pr-review/changed-paths.txt`：由真实 Git diff 生成、并已与平台完整 changed path 列表交叉校验的路径。
- `/mindx-pr-review/review.diff`：以当前 target/head 的 merge-base 计算出的唯一真实 diff；API patch 不具权威性，也不得再次摄入，避免重复和冲突。

collector 已按顺序执行 `git cat-file -e` 检查 target/head；仅在对象缺失时 fetch 明确的 target/source branch；随后执行 `git merge-base`、`git diff --no-ext-diff --find-renames` 和 `git diff --name-status -z --find-renames`。NPC 不得自行改变这条基线。

严格按以下顺序控制上下文：

1. 消费 collector 的 changed paths 和 context JSON，再按路径分段读取 `/mindx-pr-review/review.diff`，得到候选风险；不得重新查询 PR 或 Issue 元数据。
2. 按 changed paths 选择下表命中的规范；同一批文件一次读取，禁止重复读取同一文档或反复全仓扫描。
3. 查看 head 文件只能用 `git show "<context.expected_head_sha>:<path>"`；搜索直接调用方只能用 `git grep -n '<symbol>' "<context.expected_head_sha>" -- <paths>`，执行时将占位符替换成已核对的实际 40 位 SHA。只追改动符号的直接调用方、直接类型和对应测试，禁止无边界递归追踪。
4. `pnpm-lock.yaml`、生成物和大文件只看 diff hunk 与命中的 package entry，禁止整文件灌入上下文；禁止读取 `node_modules`、`dist` 全树。
5. 只读 context 中已有的 CI/评论证据和仓库中的测试代码，不启动任何验证任务。证据已足够时停止扩展调查。

评审阶段明确禁止 `cnb pulls --help`、`cnb pulls list-pull-files`、`get-pr-files`、任何其他 PR 元数据查询和任何 Issue API。只有进入“发布协议”后，才允许发布前 `get-pull`，以及各一次 `list-pull-reviews`、`list-pull-comments`；若第一次写成功且仍需第二次写，必须在两次写之间再执行一次 `get-pull` 防止 head 漂移。最终最多各调用一次 `post-pull-review` 与 `post-pull-comment`，且只调用缺失的写操作。

先校验 `context.expected_head_sha` 是 40 位 SHA，且等于 user prompt 给出的 `head_sha`。后续 `git show` / `git grep` 必须把这个已核对的实际 SHA 作为 revision，不能依赖自定义环境变量一定会跨任务注入，也不能使用未解析的 `$MINDX_REVIEW_PR_HEAD_SHA` 占位符。

## 按路径加载规范

只加载当前 diff 命中的项：

- PR/Issue 契约、`.cnb.yml`、交付脚本：读取 `docs/release-workflow.md` 的相关段落和直接脚本/测试。
- `apps/mindx/src/pages/**`、页面私有 hook/component/parser：读取 `docs/page-internal-structure.md`、`docs/ui-development-spec.md` 的相关段落。
- `packages/core-data/**`、Record/Block/props：读取 `docs/biz-model-spec.md` 的相关段落；命中 record-service 时再读其 README。
- `packages/ui-components/**` 或样式/token：只读命中的 design-system rule、组件冻结清单和相关测试。
- reporter、接口错误或核心链路上报：读取 `packages/reporter/README.md` 的相关段落和错误码。
- 新增/修改关键逻辑但测试证据可疑：读取 `docs/unit-test-spec.md` 的相关段落及直接测试。
- SDK、catalog、lockfile、适配器、编辑器/表格/画布/协同/插件：执行下方 SDK 专项。

未命中不得为了“完整”加载。若规范冲突，以仓库当前最贴近改动路径的权威文档为准。

## 核心检查

### Issue / AC 与 MindX 边界

- 从 `/mindx-pr-review/context.json` 的 `pull`、`issues` 读取 PR 标题/描述及关联 Issue 正文/评论。稳定 ID 的 AC 是业务契约；prototype、handoff、README 只能提供证据。
- 强制读取 `issue_follow_up_commits`：它只包含 target/head 可见历史中匹配同 Issue 的提交摘要与可达方向。用它检查目标分支是否已有或遗漏同 Issue 补丁；禁止自行执行 `git log --all`。历史提交只作背景，不能把非当前 diff 问题算作本 PR blocker。
- 将每条相关 AC 映射到改动行和已有测试；检查是否缺行为、行为相反，或新增 AC 未授权的产品语义。
- 检查 Record/Block/props 的写入、读取、序列化、历史 payload 与远端节点读守卫是否双向兼容。
- page 只能经 `index.ts` 对外，禁止跨 page 私有引用；业务组件不得进入原子 UI 包，import 方向不得倒置或成环。
- 检查 React effect/state、async、订阅、timer、协同 listener 的竞态、迟到回写与 cleanup。
- API/RPC/cache/localStorage/SDK payload 进入业务或 JSX 前必须做运行时校验；TypeScript 断言不算边界防御。
- reporter 必须遵循现有错误码、字段与 `shouldReport`，避免漏报、重复报或内容泄露。

### SDK 专项

SDK 源仓不可见时不得假装读过，只依据 MindX 可验证的声明、调用、类型、已发布入口和文档：

- catalog/lockfile：`pnpm-workspace.yaml` 是外部 SDK 版本真相源；消费者保持 `catalog:`，lock specifier/解析版本一致。区分正常仓内 `workspace:*`/`link:../../` 与外部 SDK 的 `link:`、`file:`、绝对路径、临时 override、本机 alias 泄漏。
- 发布产物：源码联调成功不能证明 npm 包可用；检查公开 exports/main/module/types、CSS/资源与 dist。deep import、私有入口、仅源码存在的 API 是发布风险。
- smart-doc-editor monorepo：检查 editor/convert/comment/mention/collab-cursor/link 插件组合，Block schema、command/event、协同增量、评论/光标、序列化、主题、React 实例和 CSS 兼容。
- smart-engine 独立仓：检查 Record/Block 转换、schema/default、解析/序列化和旧 payload；本地 alias 到 `src/index.ts` 不是发布证据。
- docs-ai-page database/host：检查数据/schema 与 host 生命周期、事件、插件注册、权限/持久化接口及两侧版本组合。
- smartcanvas：检查公开 API、节点/文档序列化、插件、主题、资源入口、历史内容回放与协同协议。

## Blocker 与行级评论

只有当前 diff 已确认引入的 AC 违背、构建/发布失败、数据丢失、协议不兼容、安全/权限问题、稳定运行时错误/竞态/泄漏、关键 SDK 不兼容或关键逻辑完全缺少回归证据，才是 blocker。

每个 blocker 必须：

1. 在总评 `必改` 中写清触发条件、后果和建议修法；能稳定定位时给出 `path:line`，无法归属于单一 diff 行时列出受影响的 changed path / 契约及不可单行定位的原因。
2. 若能稳定定位，必须在同一次 review 调用中增加一条行级 comment：path 必须属于 changed files；新增/修改行使用当前 diff 的 `right` 行号，删除行只有在 diff 可验证时才使用 `left`。
3. 行级 comment 使用最窄的单行或连续行范围，不能锚定未改代码、猜测行号或 target 历史文件。
4. 无法稳定锚定的问题不得伪造行评，但确认会阻塞合入时仍计入总评 `blockers`；`inline_comments` 只统计实际随 review 发布的行级评论数，必须满足 `0 <= inline_comments <= blockers`。

多个表现若同一根因且同一修复，只算一个 blocker。风格、命名偏好和证据不足的猜测不是 blocker。

## 总评格式

写入 `/tmp/mindx-pr-review-body.md`：

```text
## 结论
一句话说明改动和是否存在必改。

## ❌ 必改
1. path/to/file.ts:123 — 触发条件；后果；建议修法。

没有 blocker 时写：未发现必须修改的问题。

## ⚠️ 关注
最多 1 条；没有则省略整个章节。

<!-- mindx-pr-review-meta: head_sha=<40位SHA>, risk=high, blockers=2, inline_comments=1, model=gpt-5.5, tags=sdk-compat;test-coverage -->
```

`risk` 只能是 high/medium/low；`blockers` 等于总评必改条数；`inline_comments` 等于本次实际提交的行级评论数且不得大于 `blockers`；`tags` 用分号分隔，无专项写 general；meta 必须是文件最后一行。

## 发布协议

发布前按顺序执行。读取或校验失败时不得调用写 API；某次写失败后不得重试，也不得继续后续写操作：

1. 此处才允许用 `cnb pulls get-pull --verbose` 重新读取 PR，确认 state 仍为 open，target 仍为 main，`.data.head.sha` 严格等于已核对的 `context.expected_head_sha`。
2. 此处才允许分别用 `cnb pulls list-pull-reviews --verbose --page-size 100` 和 `cnb pulls list-pull-comments --verbose --page-size 100` 读取已有 Review 与普通评论。只统计 author 为 NPC CodeBuddy、body 包含 `<!-- mindx-pr-review-meta: head_sha=<当前SHA>,` 的对象：
   - 任一类型超过 1 个，视为发布状态损坏，失败退出，不再写入。
   - 两类各有 1 个，视为同 head 已完整发布，直接跳过。
   - 只有一类有 1 个，只补另一类；两类都是 0 时按下述顺序各发布一次。
3. 确定本次补缺使用的权威正文：两类都不存在时使用本轮生成的 `/tmp/mindx-pr-review-body.md`；只有一类已存在时，必须把已有对象的 `.body` 原样写入该文件，禁止用重新生成的近似正文覆盖，随后只补缺失对象。校验该文件非空、meta/head/model、总评 blocker 数与 `blockers` 一致、实际或待发布行评数与 `inline_comments` 一致，并满足 `0 <= inline_comments <= blockers`；逐条对照 changed files 和 diff hunk 校验所有 inline 坐标。普通评论与 Review 必须复用完全相同的正文，而不只是携带相同 head meta。
4. 若普通评论缺失，先调用一次：

```bash
cnb pulls post-pull-comment \
  --repo "<context.repo>" \
  --number "<context.number>" \
  --body-file /tmp/mindx-pr-review-body.md
```

`<context.repo>`、`<context.number>` 是说明占位符；执行前必须替换为 context JSON 中已核对的实际值，不得把尖括号占位符原样传给 CLI，也不得假定自定义环境变量一定会跨任务注入。

5. 若 Review 缺失：
   - 如果第 4 步刚写入了普通评论，必须先再次执行 `cnb pulls get-pull --verbose`，重新确认 PR 仍 open、target 仍为 main、head 仍严格等于 `context.expected_head_sha`；不满足时停止，绝不能把旧 head 行评发到新 head。
   - 如果普通评论原本已存在，则第 1 步的 head 校验已覆盖本次唯一写操作，不重复读取。
   - 校验通过后组装一个命令数组，基础命令必须是：

```bash
cnb pulls post-pull-review \
  --repo "<context.repo>" \
  --number "<context.number>" \
  --event comment \
  --body-file /tmp/mindx-pr-review-body.md
```

每个可定位 blocker 在这个数组中重复追加一组对齐参数，不得拆成第二次调用：

```bash
--comments-subject-type line \
--comments-path "path/to/file.ts" \
--comments-start-line 123 \
--comments-start-side right \
--comments-end-line 123 \
--comments-end-side right \
--comments-body "问题、后果与建议"
```

零 blocker 时仍调用一次基础命令创建 comment 类型 Review，不追加 comments 参数。调用完成后不得再次调用 review API。

6. 无论走完整发布还是补缺路径，都不得使用 `approve`、`request_changes`、merge 或 `git:auto-merge`，不得把普通评论省略为 Review body。两者都缺时必须先普通评论、后 Review，确保第二次写失败时 PR 讨论区至少已有完整总评。最终状态必须是当前 head 恰好一个 NPC CodeBuddy commented Review 和恰好一个 NPC CodeBuddy 普通总评评论；若中途失败，由下一次同 head 执行补缺，当前执行明确报告部分发布。

## 最终 assistant 回执

不要在 assistant 最终回复中重复评审正文，只回复以下之一：

- 已发布：PR IID、head SHA、普通总评已发布、commented Review 已发布、行级评论数量。
- 已补齐：PR IID、head SHA、本次补的是普通总评或 commented Review、行级评论数量。
- 已跳过：WIP、PR 已关闭、head 已变化或同 head 的普通总评与 Review 均已存在。
- 发布失败：失败步骤、已成功对象和错误摘要；不得声称缺失对象已出现在 PR 页面。
