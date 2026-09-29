---
name: prototype-workflow
description: 当产品经理或设计师说“开始原型”“继续原型”“暂停原型”或要求修改产品原型时使用。原型在独立 worktree 中运行，产品无需管理 Git、依赖或端口。
---

# 轻量原型工作流

把产品的话映射为八个动作：**开始、分享、暂停、继续、升级、冻结、丢弃草稿、放弃 Issue 原型**。原型是快速探索用的可执行设计证据，永远不是待合并代码。

## 开始

- 给出 Issue：只接受 open、唯一`需求池`或`原型中`的 Issue；开始前补齐结构化 AC，并确保唯一状态为`原型中`。
- 没有 Issue：创建纯本地 `draft:<draftId>`，不创建、读取或校验 Issue。
- 始终从最新 `main` 创建受管 `prototype/<issue>-<slug>` 或 `prototype/draft-<id>-<slug>` worktree；不切换、reset、clean、install 或删除主工作区。
- Workbench 依次记录 `preparing → worktree_ready → starting → active`；失败记录 `prepare_failed`。AI 只报告当前阶段，不在后台恢复或重试。
- 默认打开带 WorkBuddy Shell 的 `#/space/shell`；`#/space/home` 可直达裸 MindX 页面。

## 容量与并发

draft 与 Issue-bound 原型共享 `ACTIVE_LIMIT=3`。只有正在启动的 `starting` 和已启动的 `active` 占运行槽；准备 worktree 和依赖不占槽。并发准备完成后若运行槽已满，保留 `worktree_ready`，不启动第四个服务；释放槽位后说“继续”即可启动。

同一个 prototype 的启动、停止、冻结、放弃或丢弃等副作用由短期进程锁串行；冻结在该锁内再使用全局状态锁，分享与冻结的状态/交接写入由全局状态锁串行。锁只在能够确认旧进程已经死亡时回收；live 或无法确认的 owner 一律返回 busy。释放锁时必须核对 owner token，避免旧调用误删新锁。

## 运行时

- `createWorktree` 只创建 worktree。`preparePrototypeRuntime` 在该 worktree 中用参数数组执行 `pnpm install --frozen-lockfile`，不得拼接 shell 或改用非 frozen 安装。
- Workbench 只保存 `lockfileSha256`、精确 `installArgv` 和 `mainWorkspaceUnchanged: true`。默认 inspector 只检查 `pnpm-lock.yaml`、真实目录 `node_modules` 与非空普通文件 `node_modules/.modules.yaml`。
- 同一 lockfile hash 且本地检查有效时，继续操作复用现有依赖；缺失或 hash 变化时重新安装一次。失败后保留 worktree，等待产品显式“继续”，不做特殊错误重试或后台修复。
- `startPrototype` 以 `pnpm prototype:dev` 启动，只有进程存活、loopback URL、HTML 和入口资产均可访问才进入 `active`。
- `probePrototype` 只返回 `ready`、`stopped` 或 `unknown`。继续时 `ready` 直接恢复为 active，`stopped` 才允许重新启动；`unknown` 停手并提示重试或人工检查，绝不猜测服务状态。
- 启动抛错或 readiness 证据无效时，先 best-effort 停止并用 `probePrototype` 复验。只有明确 `stopped` 才记录 `prepare_failed`、释放端口和运行槽；无法确认停止时返回 `RUNTIME_STATUS_UNKNOWN`，保持 `starting` 及原 `devPort` / runtime evidence，继续占用运行槽，避免端口复用或遗留服务突破容量上限。
- 对保留为 `starting` 的记录，下一次显式继续先 probe：`ready` 恢复为 `active`，`stopped` 才重新启动，`unknown` 继续停手。

产品不需要人工安装、清理全局 store、软链主工作区 `node_modules` 或关闭安全机制。

## 暂停、继续与修改

- 暂停和继续都是本地操作，不读取 Issue；暂停只停服务，保留 worktree、草稿与 Page，并释放端口和运行槽。
- 修改只发生在该 prototype 的 worktree，并直接作用于 `apps/mindx`；不得转向其它 app 建立平行原型。
- Issue-bound 原型的行为或范围变化，必须在下次分享或冻结前更新 Issue 正文与结构化 AC；draft 可先自由探索。

## 分享、升级与冻结

- active 或 paused 都可以分享。执行 `share-prepare → WorkBuddy 内置资料库 skill → share-complete/share-reject`；分享从当前 dirty worktree 生成并验证 ZIP，不 commit/push，不建 PR。
- draft 分享不访问 Issue；Issue-bound 分享重新读取 Issue 与 AC。再次分享复用 `pageId` / `nodeBlockId`，覆盖同一 Page。
- draft 必须先 promote 到 open、唯一`原型中`且含结构化 AC 的 Issue，保留 worktree、迁移 runtime identity，并重新分享，之后才能冻结。
- active 或 paused 的 Issue-bound 原型都可以冻结。冻结重新校验 Issue、当前 tree、最近分享回执与 checkpoint；通过后才幂等 commit、普通 push、写回交接并转为`待研发`。永不建 PR、打 tag 或合并。

## 结束

- `丢弃草稿 <draftId>`：只处理 local draft，不访问或关闭 Issue。先确认是受管 worktree；若服务仍在运行则停止并复验，只有确认 stopped 才删除 worktree。删除失败保留本地状态供重试；有其它操作占锁时不产生副作用。
- `放弃 #ID`：只处理 Issue-bound 原型；条件关闭 Issue 后再清理受管 worktree。任一步无法确认时保留状态，等待重试或人工检查。

分享和冻结可以从 paused 执行，产品不必为了交付重新启动页面。研发始终从最新 `main` 独立实现，以 Issue 为契约、以 Page 和 prototype 分支为参考，不 merge 或整分支 cherry-pick 原型代码。
