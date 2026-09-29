---
name: conflict-resolver
description: 当分支需要同步、检查或解决冲突，或准备执行 git rebase、merge、cherry-pick、ours/theirs 选择、reset hard 或强制推送时使用。
---

# Command: Conflict Resolver (分支同步与冲突解决管线)

本 skill 是「分支同步 + 冲突解决」**唯一允许的执行路径**。提供从 `git fetch` 到 `rebase` 成功、构建通过的端到端闭环，并在无法自动决策时安全挂起。

## 触发条件

- 用户要求同步主干、rebase、merge、解决/检查冲突或执行 `/resolve-conflicts`。
- CNB / git 报告 `cannot_be_merged`、`merge_conflict`、`has_conflicts` 或 `Unmerged paths`。
- AI 即将执行 rebase、merge、cherry-pick、ours/theirs 选边、reset hard 或 force push。
- `cmd-publish` 的主干同步检查调用本 skill。

## 🔴 硬约束（不可绕过）

> 以下情况 **AI 必须先加载本 skill，禁止直接裸命令操作**：
>
> 1. ⛔ 禁止在未加载本 skill 的情况下执行 `git rebase <任意分支>`
> 2. ⛔ 禁止在未加载本 skill 的情况下批量使用 `git checkout --theirs` / `--ours`
> 3. ⛔ 禁止在 rebase / merge 过程中或 push 前跳过冲突标记扫描（Phase 5.0）
> 4. ⛔ 禁止用 `--no-verify` 跳过 pre-commit hook 来推送可能含冲突标记的代码
> 5. ⛔ 即使 AI 在 5 分钟前刚说过"需要研发帮忙"，看到用户贴图也不得自我翻盘——必须先重新问用户"是否授权我尝试自动 rebase"
>
> **违规自检**：如果你已经跑了 `git rebase` 或 `git checkout --theirs` 而没有加载本 skill，**立即停止后续 push**，加载本 skill，按 Phase 5.0 补做残留扫描和验证闭环。

## 核心原则

0. **prototype 不参与历史操作**：它是可丢弃 worktree，不能成为或接受任何 merge / rebase / cherry-pick 来源。
1. **零悬空状态**：任何中途失败都必须 `git rebase --abort` 回到原始分支状态，不允许留 detached HEAD / unmerged paths 给下游环节。
2. **增量追加可自动、互斥修改须人工**：不对同一位置的语义冲突做主观判断。
3. **rebase 而非 merge**：保持 feature 分支提交历史线性。
4. **验证必过才算完成**：`pnpm install` + `pnpm build` 通过 + 冲突标记零残留，才返回 success。
5. **目标分支动态化**：base 分支不固定 main——按 PR `target_branch` 或路由配置选择（main / feature/xxx 等）。

## Phase -1: prototype 历史隔离（先于授权 / fetch / 快捷路径）

这是最高优先级硬停。**用户授权、`cmd-publish` 内部调用、无冲突、behind=0、ahead=0 和 pure fast-forward 都不能豁免。**

只用只读信息完成以下解析，期间禁止 `git fetch` 和任何历史操作：

1. 读取当前 `BRANCH`。
2. 枚举本次 merge / rebase / cherry-pick 的全部 source ref；将 `refs/heads/`、`refs/remotes/origin/`、`origin/` 前缀归一化。已知来自 prototype 的 commit SHA 仍按 prototype source 处理，禁止把分支名换成 SHA 绕过。
3. 解析权威目标：有 PR 时只认 PR `target_branch`；无 PR 时依次使用 `.vibe/active-route.target_branch`、`.vibe/branch-routes.json` 的匹配路由和 `main`。显式 `base_branch` 只作为请求值，必须等于权威目标。

命中任一项立即返回 `status=failed`，且不得进入 Phase 0：

- 当前分支匹配 `prototype/**`。
- 解析出的 `BASE` 或 source ref 匹配 `prototype/**`。
- 任何 merge / rebase / cherry-pick 的 source ref 匹配 `prototype/**`。
- 当前生产分支请求同步的不是其合法的非 prototype target。

拒绝时说明：prototype worktree 只允许普通 commit/push checkpoint，不能 rebase、merge、cherry-pick 或 force push；分享走 `prototype-deploy`，冻结走 `prototype-handoff`，研发实现走 `implement-issue` 从最新 `main` 新建生产分支。不得先 fetch “看看”、不得尝试 `merge --ff-only`，也不得在生产分支 cherry-pick prototype ref/SHA。

## Phase 0: 确认用户授权（仅当 AI 自主触发时）

如果本次加载是由 CNB/git 的冲突信号或 AI 即将执行历史操作而自主触发（非用户主动说“解决冲突”，也非 `cmd-publish` 内部调用），**必须先向用户确认**：

```
检测到 <分支名> 与 <目标分支> 有冲突需要解决。

可选方案：
[A] 我（AI）尝试自动 rebase（仅处理 import/export/路由表/lockfile 类的"增量追加"冲突，互斥冲突会挂起给你决策）
[B] 你在 CNB Web 界面手动解决
[C] 联系研发协助

请选择 A / B / C。
```

收到 `A` 明确授权后才进入 Phase 1，否则**禁止跑任何 `git rebase` / `git merge` / `git checkout --theirs`**。

## Phase 1: 前置快照 + 已封存目标分支

运行以下 Shell 脚本，收集上下文：

```bash
BRANCH=$(git branch --show-current)
# 工作区必须干净才能安全 rebase（未提交改动会干扰判断）
DIRTY=$(git status --porcelain | head -1)
```

`BASE` 必须直接使用 Phase -1 已验证并封存的合法非 prototype target；授权后不得重新解析、替换或降级为调用方任意传入的 ref。

得到 `BASE` 后：

```bash
git fetch origin "$BASE" --quiet
BEHIND=$(git log --oneline HEAD..origin/"$BASE" | wc -l | tr -d ' ')
AHEAD=$(git log --oneline origin/"$BASE"..HEAD | wc -l | tr -d ' ')

echo "{\"branch\": \"$BRANCH\", \"base\": \"$BASE\", \"dirty\": \"$DIRTY\", \"behind\": $BEHIND, \"ahead\": $AHEAD}"
```

解析为 `sync_ctx` 对象。

**分支保护**：

- 如果 `sync_ctx.branch === sync_ctx.base`，立即终止并告知"当前已在目标分支，无需同步"。
- 如果 `sync_ctx.branch` 为 `main` 等受保护分支，立即终止并告知"受保护分支不允许在本机 rebase"。

## Phase 2: 快捷路径判定

只有 Phase -1 已通过，且当前分支与 `BASE` 都再次确认不是 `prototype/**`，才可按以下顺序短路返回。不得把 prototype 分支或 prototype source ref 送入 fast-forward 路径：

1. **已最新**：若 `sync_ctx.behind == 0`，直接返回 success，无需 rebase。
2. **纯 fast-forward**：若 `sync_ctx.ahead == 0`（分支无独有提交），执行 `git merge --ff-only origin/$BASE`，返回 success。
3. **需 rebase**：否则进入 Phase 3。

## Phase 3: 工作区准备

若 `sync_ctx.dirty` 非空：

1. 明确告知用户："检测到未提交改动，已自动 stash 后再执行 rebase。"
2. 执行：`git stash push -u -m "conflict-resolver: pre-rebase auto-stash"`。
3. 记录 `auto_stashed=true` 供 Phase 5 恢复使用。

## Phase 4: 执行 rebase 与冲突分类

### 4.1 发起 rebase

执行 `git rebase origin/$BASE`。

- 若退出码为 0：无冲突，跳转 Phase 5。
- 若退出码非 0：进入 4.2 冲突分类。

> ⚠️ **`--ours / --theirs` 语义陷阱**：在 `git rebase` 期间，`--ours` 指**目标分支（被 rebase 到的那个，即 upstream）**，`--theirs` 指**我们正在重放的 commit（本地原 feature 改动）**。这与 `git merge` 时的语义相反——**禁止凭直觉判断**，每次使用前都必须脑内验证一次方向。

### 4.2 冲突文件分类

运行 `git diff --name-only --diff-filter=U` 获取 Unmerged 文件列表。对每个文件按以下规则分类：

**A 类 — 可自动合并的"增量追加"型冲突**：仅包含以下模式之一的冲突段才算 A 类：

- **导出/导入清单追加**：冲突区块两侧都是 `import` / `export` 语句，无重叠符号名。
  - 示例：一边加 `export { AgentCardPC }`，另一边加 `export { ToastPC }`。
- **路由表追加**：冲突区块两侧都是 `<Route path="..." />` 类型结构，`path` 不重复。
- **锁文件类**：`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock`。

**处理 A 类**：

- 对导出/导入/路由表追加：读取文件，用 `replace_in_file` 将 `<<<<<<< ... ======= ... >>>>>>>` 冲突块替换为"两边内容的并集"（去重后拼接，保留主干侧在前）。
- 对 lockfile：`git checkout --theirs <file>` 采用主干版本，然后 Phase 5 通过 `pnpm install` 重新同步；**不**手工合并 lockfile。

完成后对每个 A 类文件运行 `grep -n '<<<<<<<\|=======\|>>>>>>>' <file>` 确认无残留冲突标记，再 `git add <file>`。

**B 类 — 需用户决策的"互斥修改"型冲突**：除 A 类外的所有冲突（同一函数实现两边不同、同一配置值两边不同、业务逻辑互相覆盖等）。

**处理 B 类**：不得自行决策。立即进入 Phase 6（挂起）。

### 4.3 收尾判定

所有文件都 A 类处理完 → 执行 `GIT_EDITOR=true git rebase --continue`，然后跳转 Phase 5。

## Phase 5: 验证与闭环

### 5.0 冲突标记残留扫描（强制 · 不可跳过）

> ⛔ 这是 rebase 流程的**最后一道安全闸门**，事故复盘验证："跑了 git rebase --continue 不代表没有冲突标记残留"——特别是当多个 commit 被顺序重放、或之前用了 `--theirs` / `--ours` 强制选边时，git 可能在中间环节产生"假装解决了"的状态。

```bash
# 全仓扫描冲突标记，不限文件类型（避免漏检 less/json/md 等）
LEFTOVER=$(grep -rln "^<<<<<<<\|^=======$\|^>>>>>>>" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.less" --include="*.css" --include="*.json" --include="*.md" \
  --include="*.yaml" --include="*.yml" \
  . 2>/dev/null | grep -v "node_modules\|.git/" || true)
```

判定：

- `LEFTOVER` 为空 → 进入 5.1
- `LEFTOVER` 非空 → **立即停止流程**，输出残留文件列表，要求人工处理（**严禁** 跳过此扫描直接 push）：

```
⛔ rebase 后检测到冲突标记残留，禁止推送。

残留文件：
  - <file1>
  - <file2>

请逐文件打开 → 决定保留哪一边 → 删除 <<<<<<< ======= >>>>>>> 标记行 → 重新进入 Phase 5.0。
```

### 5.1 恢复 stash

若 `auto_stashed=true`，执行 `git stash pop`。

- 若 stash pop 再次产生冲突（常见于 lockfile），优先采用主干的锁定版本：`git checkout HEAD -- pnpm-lock.yaml` 并 `git stash drop`。
- stash pop 后**再跑一次 5.0 残留扫描**。

### 5.2 依赖同步

执行 `pnpm install`。

### 5.3 构建验证

执行 `pnpm build`。

- 失败则向用户报告具体错误并停止；**不**回滚 rebase（rebase 本身成功，只是构建坏了，需要人工介入修代码）。

### 5.4 类型检查

执行 `pnpm typecheck`（如项目有该脚本）。

- TS 编译通过 ≠ 没有运行时未定义引用，必须跑 typecheck 才能发现遗留的 `is not defined`。

### 5.5 输出成功清单

```
✅ 分支同步完成：当前分支已基于 origin/<BASE> 最新 (<N> 个新提交) 重放
✅ 冲突自动解决：<M> 个文件（A 类增量合并）
✅ 残留扫描：0 处冲突标记
✅ 验证通过：pnpm install + pnpm build + pnpm typecheck
```

### 5.6 push 闸门

- ⚠️ **本 skill 不负责执行 push**，将控制权交还调用方（cmd-publish 或主会话）。
- 若调用方在 push 时使用 `--no-verify` / `--force`（非 `--force-with-lease`），视为违反 git safety protocol。

## Phase 6: 互斥冲突挂起策略

触发条件：Phase 4.2 出现 B 类冲突。

1. 立即执行 `git rebase --abort`，回到 rebase 前状态。
2. 若 Phase 3 曾 stash，执行 `git stash pop` 恢复工作区。
3. 向用户输出**结构化报告**（不要泛泛描述，要给足决策信息）：

```
⚠️ 检测到互斥型冲突，无法自动合并，已回滚到 rebase 前状态。

主干在以下提交中修改了与你相同的位置：
  - <commit hash> <commit message> by <author>

冲突文件清单（B 类）：
  1. <file>
     - 主干改动：<摘要>
     - 本地改动：<摘要>
     - 冲突性质：<同一函数/同一配置/同一声明>

建议决策路径：
  [A] 以主干为准，放弃本地改动
  [B] 以本地为准，继续覆盖主干
  [C] 两边融合，我提供融合方案后你确认
  [D] 联系主干作者 @<author> 协商

等待用户回复后再继续。
```

4. 标记本次 skill 运行为 `status=suspended`，调用方（cmd-publish）应据此暂停后续步骤。

## 调用者契约

本 skill 的返回状态有三种，调用方必须识别：

| status      | 含义                                                  | 后续动作                       |
| :---------- | :---------------------------------------------------- | :----------------------------- |
| `success`   | 已同步主干且构建通过                                  | 继续下游流程                   |
| `suspended` | B 类冲突已挂起，等用户决策                            | 暂停当前管线，等待用户重新触发 |
| `failed`    | rebase 过程中发生非冲突类异常（网络、权限等），已回滚 | 报告错误并停止                 |
