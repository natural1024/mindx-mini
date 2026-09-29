# MindX host events and timelines

本目录必须与当前代码同改，不按版本复制历史目录。查询前仍应搜索事件定义和直接测试确认现场。

## 身份和传输

| 项                  | 当前值/来源                                                    |
| ------------------- | -------------------------------------------------------------- |
| `tags.logNamespace` | `mindx`                                                        |
| `tags.sdkName`      | `@mindx/app-mindx`                                             |
| root module         | `app`，child 后形成 `app.<module>`                             |
| `tags.nodeId`       | `WorkspaceSession.activeNodeId`，adapter 按每条 entry 动态补充 |
| `tags.uid`          | 启动时可为空，登录后更新为当前账号                             |
| target              | 每次从 `apps/mindx/src/routers/index.tsx` 读取，不在本目录固定 |

## 关键事件

| module                  | event                                          | code/级别                                      | 含义                                                                                                         |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app.request`           | `api.request_failed`                           | `API_REQUEST_FAILED`                           | 已开启 shouldReport 的安全 API 模板请求失败                                                                  |
| `app.workbuddy-host`    | `workbuddy_host.guest_sdk_init_failed`         | `WORKBUDDY_GUEST_SDK_INIT_FAILED`              | 标准 iframe Guest SDK 初始化失败；不依赖账号初始化监控，Aegis 未就绪时暂存，就绪后发送一次，不携带原始 Error |
| `app.record-service`    | `record.initial_load_failed`                   | `RECORD_INITIAL_LOAD_FAILED`                   | 邀请权限消费或 spaces bootstrap 失败                                                                         |
| `app.record-service`    | `record.background_request_failed`             | `RECORD_BACKGROUND_REQUEST_FAILED`             | 非阻塞后台请求失败                                                                                           |
| `app.record-service`    | `record.open_load_failed`                      | `RECORD_OPEN_LOAD_FAILED`                      | `/open` 普通失败，不含结构化访问异常                                                                         |
| `app.workspace-session` | `workspace_session.request_failed`             | `WORKSPACE_SESSION_REQUEST_FAILED`             | Session 编排的请求失败                                                                                       |
| `app.workspace-session` | `workspace_session.lifecycle_failed`           | `WORKSPACE_SESSION_LIFECYCLE_FAILED`           | Session 初始化或离开失败                                                                                     |
| `app.workspace-session` | `workspace_session.collab_join_failed`         | `WORKSPACE_SESSION_COLLAB_JOIN_FAILED`         | Session 加入协同房间失败                                                                                     |
| `app.workspace-tree`    | `workspace_tree.initial_expand_failed`         | `WORKSPACE_TREE_INITIAL_EXPAND_FAILED`         | 首屏目录展开失败                                                                                             |
| `app.workspace-tree`    | `workspace_tree.initial_loading_stuck`         | `WORKSPACE_TREE_INITIAL_LOADING_STUCK`         | 首屏加载未收敛                                                                                               |
| `app.workspace-tree`    | `workspace_tree.cross_space_move_failed`       | `WORKSPACE_TREE_CROSS_SPACE_MOVE_FAILED`       | 跨空间后端移动任务终态失败，不依赖也不上报后端 message                                                       |
| `app.workspace-tree`    | `workspace_tree.cross_space_local_move_failed` | `WORKSPACE_TREE_CROSS_SPACE_LOCAL_MOVE_FAILED` | 跨空间乐观本地移动失败，流程继续 poll 对齐                                                                   |
| `app.smart-engine`      | `smart_engine.data_api_failed`                 | `SMART_ENGINE_DATA_API_FAILED`                 | allowlist dataApi 操作失败                                                                                   |
| `app.smart-engine`      | `smart_engine.submitted_failed`                | `SMART_ENGINE_SUBMITTED_FAILED`                | 提交失败且无配对 fatal                                                                                       |
| `app.smart-engine`      | `smart_engine.fatal_error`                     | `SMART_ENGINE_FATAL_ERROR`                     | 命令队列不可恢复失败                                                                                         |
| `app.smart-engine`      | `collab.connected`                             | info                                           | 协同首次连接                                                                                                 |
| `app.smart-engine`      | `collab.disconnected`                          | `COLLAB_DISCONNECTED`                          | 协同断开                                                                                                     |
| `app.smart-engine`      | `collab.reconnected`                           | info                                           | 协同重连                                                                                                     |
| `app.host.smart-doc`    | `paste.limit_exceeded`                         | `PASTE_LIMIT_EXCEEDED`                         | 宿主粘贴限制命中                                                                                             |
| `app.upload`            | `attachment.put_failed`                        | `API_REQUEST_FAILED`                           | 上传业务失败                                                                                                 |
| `app.upload`            | `attachment.put_network_error`                 | `API_REQUEST_FAILED`                           | 上传网络失败                                                                                                 |
| `app.upload`            | `attachment.put_timeout`                       | `API_REQUEST_FAILED`                           | 上传超时                                                                                                     |

### 跨空间移动关键 attributes

| event                                          | attribute     | 稳定值/枚举           |
| ---------------------------------------------- | ------------- | --------------------- |
| `workspace_tree.cross_space_move_failed`       | `reason`      | `backend_task_failed` |
| `workspace_tree.cross_space_local_move_failed` | `operation`   | `apply_local_move`    |
| `workspace_tree.cross_space_local_move_failed` | `failureKind` | `request` / `unknown` |

两条 event 都不携带原始 `Error`、后端 message 或节点/空间标识。

### Record 初始化关键 attributes

| event                                  | attribute      | 稳定值/枚举                                                                         | 含义                                     |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `record.initial_load_failed`           | `stage`        | `joinPermission` / `loadSpaces`                                                     | 邀请权限消费失败 / spaces bootstrap 失败 |
| `record.open_load_failed`              | `stage`        | `open`                                                                              | `/open` 普通失败                         |
| `record.background_request_failed`     | `operation`    | `fetchUnreadNotificationCount`                                                      | 未读通知后台请求失败                     |
| `workspace_session.request_failed`     | `operation`    | `consumeShareCode` / `fetchUnreadNotificationCount` / `openByRoute` / `loadRecords` | Session 请求阶段                         |
| `workspace_session.request_failed`     | `recovery`     | `service_busy_page`                                                                 | `openByRoute` 失败后进入统一恢复页       |
| `workspace_session.request_failed`     | `businessCode` | 后端业务码                                                                          | `loadRecords` 失败分类                   |
| `workspace_session.lifecycle_failed`   | `operation`    | `init` / `leave`                                                                    | Session 生命周期阶段                     |
| `workspace_session.collab_join_failed` | `reason`       | `permission_denied` / `unknown`                                                     | join 失败分类                            |
| `workspace_session.collab_join_failed` | `businessCode` | 后端业务码                                                                          | join 失败业务码                          |

`loadSpaces` 只请求并处理 spaces、初始化 SmartEngine 与加载空间根节点。文档 `/open`
失败不使用 `record.initial_load_failed`：非 12607 / 11510 / 56172 的普通失败记录
`record.open_load_failed`；该业务终态可与请求层 `api.request_failed` 同时出现。三类结构化
访问异常由 `WorkspaceSession.openByRoute → ensureOpenContext` 归一化到访问异常链路。

## 时间线

### 打开文档

```text
record.initial_load_failed（joinPermission / loadSpaces 失败时）
→ api.request_failed（/open 请求失败时可选；请求层事实）
→ record.open_load_failed（非 12607 / 11510 / 56172 的普通失败；业务终态）
→ workspace_session.request_failed（openByRoute 未收敛并展示统一恢复页）
  或 WorkspaceSession 结构化访问异常（12607 / 11510 / 56172）
→ workspace_tree.initial_expand_failed / initial_loading_stuck（只在失败或卡住时）
→ 内容 SDK 的 created/loaded/ready
→ smart-engine collab.connected
```

`api.request_failed` 与 `record.open_load_failed` 可以同时出现，分别表示请求失败与 open
业务终态，不按条数判重。不存在 host “打开成功” canonical event；不能因上述错误为空就
断言文档打开成功。

### 编辑和提交

```text
内容 SDK 的 content_changed / 本地操作
→ smart-engine submitted_failed 或 fatal_error（只在失败时）
→ collab.disconnected / reconnected（连接变化）
```

MindX 当前没有通用提交成功事件。SmartDoc、CSV、HTML 的本地事件能力不同，应交给各自领域目录解释。

### 跨空间移动

```text
workspace_tree.cross_space_local_move_failed（可选；乐观本地移动失败，不终止轮询）
→ workspace_tree.cross_space_move_failed（可选；后端任务进入 failed 终态）
→ 宿主强制刷新源与目标 parent 及 source-space subtree（当前无单独 canonical event）
```

两条失败 event 可以先后出现：前者是可恢复的本地乐观更新失败，后者是后端任务终态失败，不是同一事实的重复上报。

### 请求和业务失败

```text
app.request api.request_failed
→ 业务 module 的稳定失败 event（如果请求失败导致业务流程终止）
```

这是两个责任边界，不自动视为重复；只有二者表达同一处置事实时才应收敛。

## SmartDoc 渲染异常的宿主安全详情

PC/Mobile 的 `EditorRoot.runtime` 共用 `smartDocDiagnosticsAdapter` 的 block/editor/overlay
回调。SDK 仍是错误事实的唯一生产者；宿主不重新报告一条业务错误，不读取 record snapshot。
`onBlockError`、`onEditorError`、`onOverlayError` 各自固定使用对应通道暂存详情，
不依赖 typed info 的 `tags.channel`；tags 缺失、为空或读取抛错不影响其它可用安全详情的配对。
共享 logger 只在 bootstrap 的 `category-sdk/doc-editor.ts` 异步入口配置，React 挂载、卸载、
StrictMode 和多 Editor 实例不会配置或清除 reporter。

| module                  | event                   | code                    | channel          |
| ----------------------- | ----------------------- | ----------------------- | ---------------- |
| `editor.render.block`   | `render.block_failed`   | `BLOCK_RENDER_FAILED`   | `block-render`   |
| `editor.render.root`    | `render.editor_failed`  | `EDITOR_RENDER_FAILED`  | `editor`         |
| `editor.render.overlay` | `render.overlay_failed` | `OVERLAY_RENDER_FAILED` | `overlay-render` |

这些事件使用 `tags.logNamespace=smart-doc`、`tags.sdkName=@tencent/smart-doc-editor`。
`tags.sdkVersion` 来自 SDK，`tags.nodeId` 只取发送时的宿主 `WorkspaceSession.activeNodeId`，
不能从 SDK 的 blockId、URL、tags 或正文推导。原操作来源仍映射为 `tags.entrySource`，
与宿主 adapter 的 `tags.source=typed` 区分。

### 新增查询字段

| 字段                                                | 含义与边界                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `diagnosticSequence`                                | SDK 包级单调递增序号，用于 callback/mirror 一次性关联；不作为告警聚合维度                 |
| `diagnosticDetail=available`                        | 本次 generic mirror 成功合入经过治理的 typed callback 详情，不表示所有诊断字段齐全        |
| `errorName`                                         | 标准 Error/DOMException 白名单分类，如 `NotFoundError`、`TypeError`；未知名称降为 `Error` |
| `jsAssetLocations` / `reactAssetLocations`          | 至多 4 个 `contenthash:line:column`，按栈顺序以 `>` 分隔                                  |
| `jsFrameLocations` / `reactFrameLocations`          | 至多 4 个纯数值 `line:column`，无资产标识的坐标不能单独定位源码                           |
| `jsFramesOmitted` / `reactFramesOmitted`            | 未保留的位置候选数量；格式未知、动态 query/hash、超限或原始错误文本均可能造成省略         |
| `jsAssetsOmitted` / `reactAssetsOmitted`            | 未提取出受信静态资产标识的位置候选数量，不能按此计数推断新的错误事实                      |
| `diagnosticEntry0` 至 `diagnosticEntry3`            | 最后 4 项中验证通过的历史，保持顺序；每项为不超过 256 字符的枚举/计数摘要                 |
| `diagnosticEntryCount` / `diagnosticEntriesOmitted` | 已保留/未保留历史项数量；不代表完整操作次数                                               |

资产标识仅接受 `static.workbuddy.cn` 或 `download.codebuddy.cn` 的
`/web/library/js/`（可含 `federation/`）静态 bundle，提取构建约定的末尾 8/16 位 hex
contenthash；不发送任意函数名、组件名、文件名、路径、完整 URL 或错误消息。还原源码必须取得
与部署版本/hash 对应的构建产物及 source map。开发环境和未知 CDN 可能只有坐标或省略计数，
不能据此声称已经定位源码。

历史的 `seq`、`lastSequence`、`actionSequence` 提供顺序与动作关联；
`originSequence` / `originLastSequence` 提供 Undo/Redo 对应原操作区间。
`kind/action/outcome`、`source`、`selectionKind/anchorKind/focusKind/reason` 均为固定枚举；
`changeCount/opCount/omittedOpCount` 为计数。`op=type:field:count` 仅描述 op 类别、字段类别和
数量，最多检查 6 组，不携带原始 op 值或 path 动态键。长摘要按字段优先级省略后续字段，
因此缺少某字段不能证明该步骤没有发生。总 tags 仍受 32 个 primitive 字段预算限制，
SDK 身份和宿主 nodeId 优先。

### 顺序、版本与证据边界

```text
SDK 同步 typed callback（只暂存安全投影，至多 32 项）
→ SDK 同次 generic mirror（sequence、SDK 身份、event/code/module/channel 全部匹配）
→ 消费安全详情并调用既有 canonical reporter 一次
→ Aegis/Galileo 原传输链路
```

未消费详情在当前微任务结束时丢弃；无 callback、旧 SDK 无 sequence、未知诊断 schema、
匹配失败或详情过期时，generic 错误继续上报。详情不独立产生 canonical 错误，也不进入
SDK 的原始错误 buffer；治理过程不持有 Error/info、正文、ops、HTML、凭据或 blockId。

当前 MindX 已将 catalog 中的 11 个 SmartDoc 配套包统一升级至正式版 `2.137.2`，
该版本包含 `diagnosticSequence/diagnostics` 扩展，宿主安全详情接线使用正式发布制品。
其中 overlay callback 提供关联序号与错误详情，但不携带 `diagnostics` 操作历史；
宿主只在 SDK 提供摘要时附加历史，不能将 overlay 历史缺失判断为宿主丢失数据。
兼容逻辑仍允许缺少扩展字段的旧 SDK 正常发送 generic 错误。依赖升级不代表宿主已部署，
本轮仍未验证真实 Aegis/Galileo 摄入，不能据此宣称线上已拥有新增字段。

`content_changed` 的旧行为会省略普通 title-only 输入，并非只在 Enter 时上报；其它结构变更
也可能产生事件。新版 SDK 的有界异常历史补充普通输入计数和操作摘要，仍不逐键远程上报。
历史是有限证据，不能恢复完整正文或精确重放全部 ops，也不能仅凭 Undo 日志断言视图已恢复。
