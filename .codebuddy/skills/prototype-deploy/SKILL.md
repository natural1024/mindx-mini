---
name: prototype-deploy
description: 当产品负责人说“分享”“部署原型”“部署 demo”或“发布原型”时使用。它在本地把当前原型构建成 zip 包并上传到同一个资料库 Page；不提交代码、不创建 PR、不合并。
---

# 分享原型

产品说“分享 #123”或“分享草稿 <draftId>”就够了。**分享与提交代码完全解耦**：分享只做「Workbench 准备 package → WorkBuddy 内置资料库 skill 发布 → Workbench 回填结果」，**不需要产品先提交代码**。提交/推送代码只在产品真正要交付研发、即「冻结」时才发生（见 `prototype-handoff`）。

产品不管理 Git、终端或环境变量；AI 按下面的三段式边界编排：

## 分享步骤（顺序不可颠倒）

1. **Workbench `share-prepare`**：按 `--issue 123` 或 `--draft <draftId>` 读取本地清单，确认目标是受管且处于 active 或 paused 的 worktree。Issue-bound 原型还必须复验 Issue open、唯一状态为`原型中`且正文有结构化 AC；不一致就提示人工处理，不构建、不上传。draft 草稿没有 Issue，不调用 Issue API。paused 可直接分享，不必为交付重新启动服务。
2. **本地构建 + 打包**（不提交、不 push）：`share-prepare` 在该 worktree 直接运行
   ```bash
   pnpm prototype:build
   pnpm prototype:verify
   pnpm prototype:package
   ```
   只接受根目录含 `index.html`、总文件数不超过 200 的 ZIP 与 manifest。
   manifest schema v2 必须包含当前 dirty worktree 的 `sourceTreeSha` 与 `artifactSha256`；构建前后、package 完成后 source tree 都必须一致，漂移时删除本次 package 并失败。package 不检查 clean worktree、commit 或 remote tip。
3. **获取当次发布凭据**：每次分享都必须先调用既有 `connect_open_platform`，获取当次新 token；完成后才允许调用资料库发布能力。token 只通过 stdin / 内存传递；严禁把 token 写入仓库、任何状态、回执、日志或命令行参数，也不得复用历史 token。
4. **委托 WorkBuddy 资料库发布**：由 WorkBuddy AI/skill 层调用内置资料库 skill 的 `page/import_html.py` 或未来等价发布能力，把 `share-prepare` 返回的已验证 ZIP 发布到 `deploymentKey` 对应的 Page。
   - 首次分享创建 Page；再次分享必须把 request 中既有的 `pageId` / `nodeBlockId` 交给 Publisher，并以 `--node-block-id` 或等价参数覆盖同一节点。既有 page/node 锚点必须原样返回，禁止把新 Page 当作覆盖成功。
   - Node/Workbench 不查找、不加载、不执行内置 skill，也不硬编码其安装路径或版本。Publisher 与 lifecycle host adapter 是分离边界；不得修改 WorkBuddy 或在仓库补造资料库客户端。
   - 若返回 `code=10034`，立即丢弃当前 token，重新调用 `connect_open_platform` 一次，并仅重放同一 package、同一 page/node 锚点的发布动作一次。第二次仍返回 `code=10034` 时，以 `AUTHENTICATION_BLOCKED` 结束；严禁循环 connect 或重放。
   - 只有返回非空的 `publish_url`，且满足正式 HTTPS、非 localhost/loopback 的发布链接契约，才可进入成功回填；detail `url` 或 Page 详情 URL 不得冒充分享链接。
   - Issue-bound 原型在回填前，以 `share-prepare` 固定的 Issue version/ETag CAS 覆盖正文唯一 `## 原型发布` 区块并重新读取复验；draft 草稿跳过 Issue 写入。
5. **Workbench `share-complete` / `share-reject`**：
   - 发布与 Issue-bound 写回均成功时，把 `pageId`、`nodeBlockId`、`publish_url` 和原 request 的 package identity 交给 `share-complete`。只有全部匹配，Workbench 才记录成功 publication。
   - 发布失败、发布能力不可用、`publish_url` 为空或非法、锚点或 package 不匹配、Issue CAS 失败时，都调用 `share-reject` 并返回结构化原因。能力缺失用 `EXTERNAL_PUBLISH_CAPABILITY_MISSING`；链接缺失或非法用 `SHARE_INCOMPLETE`。`share-reject` 不得写入成功 publication 或 Issue 发布证据，也不得覆盖上一次成功回执。

资料库导入是一步发布：不承诺隔离上传、逐文件拉回验真或失败后原子回退。当前可核对保证是已验证 package identity、稳定 page/node 锚点、正式发布链接与 fail-closed 结果，不能把更强语义写进回执。

## 上传失败：如实反馈，绝不降级（硬约束）

资料库 Page 上传是分享的唯一交付通道。若内置发布能力、凭据缺失，或上传接口失败：

- **立即停止**，向产品如实说明「资料库 Page 上传失败 / 上传能力不可用」，并给出可核对的结构化原因（如 `EXTERNAL_PUBLISH_CAPABILITY_MISSING`、`AUTHENTICATION_BLOCKED`、`SHARE_INCOMPLETE` 或接口报错码）。
- 将 repo 外阻塞交由能力所有者处理；不要求产品手工修环境、运行命令或修改 WorkBuddy，也不自行想办法“先让产品看到东西”。
- **严禁降级到任何替代平台**（CloudStudio、EdgeOne、临时静态托管、本地端口链接等）冒充资料库 Page 分享。zip 已在本地构建成功也不例外——没有资料库 Page 链接就是分享未完成。
- 已完成的本地 zip 路径可以告诉产品作为存档，但必须写明「这不是资料库分享链接，分享尚未完成」。

## 边界

- 分享**不提交业务代码、不 push、不创建 PR、不合入 main**。仓库不保存资料库上传客户端、凭据或 Page ID。
- 产品可随时再次说“分享 #123”或“分享草稿 <draftId>”，按稳定 page/node 锚点覆盖同一 Page；没有浏览或回退老版本的语义。
- 只有说“冻结 #123”时才进入 `prototype-handoff`：那时才提交/推送 prototype 分支代码供研发参考，并做 AC 对齐与本地清理。
