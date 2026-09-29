# 资料库 Extension 标准化改造执行方案

> 状态：执行中（大任务 A、B、C 已完成）
> 编写日期：2026-08-27
> 涉及仓库：`mindx`、`genie`
> MindX 基线分支：`feature/1747-workbuddy-library-plugin-architecture`
> MindX 基线提交：`24455b33 feat: 在新资料库 iframe 加载 WorkBuddy SDK #1747`
> Genie 基线分支：`feat/issue-95508-library-integration`
> Genie Extension 作者设计提交：`d873bbd6ffa feat(extensions): 扩展 extension 消费面 + POC 验证 [no-issue]`

## 1. 文档用途

本文是 MindX 资料库在 WorkBuddy 中完成 Extension 标准化改造的跨仓执行契约，供后续 AI 会话直接实施。后续执行者不应重新讨论本文已经冻结的产品与架构决策；只有发现当前代码与本文事实明显不一致、继续执行会破坏旧客户端 SpaceSdk，或者需要新增权限/接口时，才暂停并向用户报告。

本文覆盖：

- 完整背景与现状；
- 已冻结的兼容边界；
- 最终路由、Sidebar、Federation、iframe 和 Deep Link 设计；
- MindX 与 Genie 的改动边界；
- 大任务与小任务拆分；
- 执行顺序、验收标准和发布顺序；
- 必须删除和必须保留的实现；
- 可供多个新会话顺序消费的交接方式。

## 2. 背景

MindX 资料库正在以 WorkBuddy builtin extension 的方式接入 Genie：

- Sidebar 主入口使用 Module Federation 加载 MindX remote；
- 会话右侧资料库产物预览仍使用 HTTPS iframe 展示 MindX 文档；
- Federation 与新预览 iframe 都应通过统一的 `wb.*` 能力与 WorkBuddy 通信；
- 老版本 WorkBuddy 客户端不具备 extension 能力，仍通过历史 `SpaceSdk` iframe 协议运行。

当前两个开发分支上已经完成过一轮未发布的资料库插件化改造，但该轮实现早于 Extension 作者的最新设计，包含若干资料库专用机制：

- Genie 使用固定 `/space/*` Host Surface 挂载 `library` extension；
- Sidebar 中存在资料库硬编码入口；
- 新资料库预览曾使用 `libraryHostApi=1` URL 标记；
- Genie 与 MindX 曾各维护一份资料库专用 postMessage wire protocol；
- MindX 新 iframe 曾通过 `IframeHostTransport` 调用父窗口 Bridge；
- 新链路内部路径仍使用 `/space/open`、`/space/storage`。

Extension 作者在 Genie 提交 `d873bbd6ffa` 中建立了新的通用消费方式：

- 通用路由 `/extension/:extensionId/*`；
- extension manifest 的 `ui.entry.placement: "sidebar"`；
- 通用 `ExtensionMount`；
- 标准 `ExtensionIframeHost`；
- iframe 内加载标准 `wb.js`，通过 MessagePort 获得 `window.wb`；
- extension 自主管理自身子路由和贡献面。

本次工作的目标是把当前未发布的资料库 Federation、Sidebar 和新预览 iframe 实现重构为上述标准设计。

## 3. 已冻结的决策

以下决策已经由用户确认，不再作为待讨论问题。

### 3.1 路由

- 使用 Extension 作者定义的单数规范：`/extension/:extensionId/*`。
- 资料库主页：`/extension/library`。
- 打开资料库资源：`/extension/library/open?...`。
- 打开资料库存储面板：`/extension/library/storage?...`。
- 不使用误写的 `/extensions/library`。
- 不再新增 `/library/*` 固定产品 Surface。
- 新客户端不保留 `/space` 到 `/extension/library` 的 redirect、alias 或兼容路由。

### 3.2 wb.js

MindX iframe 必须加载完整标准地址：

```text
https://www.workbuddy.cn/wb.js
```

不得继续使用 `./wb.js`。WorkBuddy Desktop 会精确拦截该 URL 并返回客户端内置的 Guest SDK；未来 Web 环境可由同一 URL 提供 CDN 资源。

### 3.3 CORS、Cookie 与鉴权

- 正式 library extension 使用现有 `fetch` 拉取 Federation manifest 已经验证通过。
- 本次不改 manifest 的 CORS、Cookie 或鉴权方案。
- 不把正式 library loader 改成 POC 中带临时 SIT Cookie 的实现。
- 不引入硬编码 Cookie、Token 或环境专用认证补丁。

### 3.4 builtin 身份

- `library` 是 builtin extension。
- Sidebar Federation 和右侧资料库预览 iframe 都应以可信的 `library` builtin 身份运行。
- builtin 身份必须由 Genie 宿主/registry 注入，不能由 iframe URL、query 或 iframe 页面自行声明。

### 3.5 兼容范围

本次只有一个兼容目标：**老版本客户端中的 SpaceSdk 必须继续工作。**

其余当前分支上的 Federation、新 iframe、`libraryHostApi`、固定 `/space` extension Surface 等均未发布：

- 不需要向前兼容；
- 不保留双实现；
- 不保留 redirect、旧标记或旧协议；
- 标准实现验证通过后必须删除被替代代码。

### 3.6 发布顺序

发布顺序固定为：

1. 先发布 MindX；
2. 再发布新版 WorkBuddy 客户端。

因此新版 MindX 必须同时满足：

- 在旧客户端 iframe 中继续走 SpaceSdk；
- 在新客户端标准 iframe 中走 `wb.js`/MessagePort；
- 在新客户端 Federation 主入口中直接使用当前窗口的 `wb.*`。

## 4. 范围与非范围

### 4.1 本次范围

- Genie Sidebar 资料库入口改为 manifest 驱动；
- 资料库改用通用 `/extension/library/*` 路由；
- Library Federation remote 消费 extension 相对子路由；
- 右侧资料库产物预览统一消费 `ExtensionMount`，由其选择标准 `ExtensionIframeHost`；
- MindX iframe 加载正式 wb.js 并等待标准 Guest SDK 就绪；
- 新旧 iframe 运行时通过真实握手区分；
- 新客户端内部资料库路径切到 `/extension/library/*`；
- 删除未发布的新链路旧实现；
- 保证旧客户端 SpaceSdk 继续运行；
- 补齐两仓单测、类型检查、构建与联调验证。

### 4.2 明确不在范围

- 不迁移 MindX 自身的 `/space` Web basename；
- 不迁移 `/space/federation/v1` manifest 服务地址；
- 不迁移 `/space/d/:id`、`/space/s/:id` 等 MindX 私有 HTTPS 地址；
- 不迁移 `/space/collab` 等后端或 WebSocket 地址；
- 不修改 manifest fetch 的认证方案；
- 不给 SpaceSdk 或 Genie `space-panel/**` 增加能力；
- 不新增资料库专用 `wb.*` 公共 namespace；
- 不复制 POC extension 的临时服务、Cookie 或演示资产；
- 不提交、push 或创建 PR，除非用户后续明确要求。

## 5. 术语与四种运行形态

| 运行形态                    | 宿主能力                                             | 资料库调用路径                                             | 是否保留                |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| 普通 MindX Web              | 无 WorkBuddy Host                                    | 普通 Web 行为                                              | 是                      |
| 新客户端 Sidebar Federation | 当前窗口已有宿主 `wb`                                | MindX → `workbuddyHost` 薄 Facade → 当前 `window.wb.*`     | 是，重构为标准入口      |
| 新客户端右侧资料库预览      | iframe 内加载 wb.js，`wbReady` 完成 MessagePort 握手 | MindX → 同一薄 Facade → 当前 iframe 的 Guest `window.wb.*` | 是，替换当前专用 Bridge |
| 老客户端 iframe             | SpaceSdk HostReady                                   | MindX → 既有 SpaceSdk → 老客户端宿主                       | 是，仅兼容、冻结        |

注意：右侧资料库预览仍然渲染 MindX HTTPS 文档。`detail-panel-wrapper` 在与 `wb-extension://` 相同的消费层校验完整 `https://www.workbuddy.cn/space[/...]` URL，匹配 library manifest 的 `artifactPreviews` contribution，并用标准 `ExtensionMount` 替换整个 BrowserPreview。Mount 从 manifest 取得静态 preview entry、显式选择内部 `ExtensionIframeHost`，以 `library` builtin 身份挂载；动态文档 URL 只通过 `contribution.data.artifact` 传递。iframe 内容不是再次运行 library Module Federation remote。

## 6. 最终总体架构

### 6.1 Sidebar 与主入口

```text
library extension.json
  ui.entry.placement = "sidebar"
          ↓
通用 extension menu selector
          ↓
通用 Sidebar extension item
          ↓ navigate
/extension/library/*
          ↓
ExtensionRouteView
          ↓
ExtensionMount(extensionId="library", contribution.kind="entry")
          ↓
library builtin Federation proxy
          ↓
MindX Federation remote ./Main
```

约束：

- Genie Sidebar 不再硬编码资料库按钮；
- Host Router 不再声明固定 `space/*` library Surface；
- Host Router 不包含 library 私有路由判断；
- 通用 Sidebar 对 `/extension/library/*` 都保持 active；
- 普通 extension 与 library 使用同一个导航生成规则；
- 接受通用 extension 当前的卸载语义，不给 library 单独保留 keepAlive/warmup 特例。

### 6.2 Extension 子路由传递

MindX 当前使用独立 `MemoryRouter`，大量内部导航依赖 `/space` basename。为避免把本次改造扩大成全量 MindX Router 重写，采用现有 `contribution.route` 契约传递 extension 相对子路由。

通用 Host 行为：

1. `ExtensionRouteView` 从 `/extension/:extensionId/*` 提取 `*` splat、query 和 hash；
2. 生成 extension 相对 route，例如：
   - `/extension/library` → `/`；
   - `/extension/library/open?nodeId=n1` → `/open?nodeId=n1`；
   - `/extension/library/storage?requestId=r1` → `/storage?requestId=r1`；
3. 通过已有 `contribution={{ kind: "entry", route }}` 传给 remote；
4. 该逻辑必须对所有 extension 通用，不得 hardcode `library`。

MindX remote 行为：

1. 接收 extension 相对 route；
2. 在 MindX Federation 边界内解析公开的 `open`、`storage`；
3. 转换为 MindX 私有路由；
4. 继续使用独立 `MemoryRouter` 驱动既有 `AppRoutes`。

映射表：

| Extension route                         | MindX Federation 私有 route                     |
| --------------------------------------- | ----------------------------------------------- |
| `/`                                     | `/space/home`                                   |
| `/open?nodeId=<id>`                     | `/space/d/<id>`                                 |
| `/open?spaceId=<id>`                    | `/space/s/<id>`                                 |
| `/open?...&discussionId=<id>#<blockId>` | `/space/d/<nodeId>?discussionId=<id>#<blockId>` |
| `/storage?requestId=<id>`               | `/space/home?workbuddyOpenStoragePanel=<id>`    |
| 非法或缺少必要参数                      | `/space/home`                                   |

这样 Host 保持通用，library 私有路由知识回到 MindX Federation 边界。

### 6.3 右侧资料库预览

```text
DetailPanelWrapper
      ↓ 精确命中 https://www.workbuddy.cn/space[/...]
library artifactPreviews contribution
  static url = /space/extension-preview
  data.artifact = 已验证的动态文档 URL
      ↓ 在消费边界固定选择 iframe；通用 Mount 不 hardcode /space
ExtensionMount
  extensionId = "library"
  contribution.kind = "artifactPreview"
      ↓ 从 manifest 选择静态 preview URL
ExtensionIframeHost
  extensionKind = registry 中的 builtin
  targetOrigin = manifest preview URL 的精确 origin
      ↓ onLoad
标准 attachIframe + MessageChannel
      ↓
MindX iframe 中的 https://www.workbuddy.cn/wb.js
      ↓
window.wb + window.wbReady
      ↓
/space/extension-preview 校验 data.artifact 并 replace 到真实文档路由
```

要求：

- 保留现有 MindX URL 白名单与精确 origin 校验；
- 使用标准 Host 的 sandbox 与布局默认值；若后续需要补 clipboard/fullscreen 等 Permissions Policy，单独从通用 Host 能力补齐，不在资料库消费点恢复业务 iframe；
- 动态文档 URL 只能进入 `contribution.data.artifact`，Mount 只能从 registry summary 与 manifest contribution 取得可信 extensionId、kind 和静态 preview URL；
- `/space` 的业务识别和 `container="iframe"` 选择只能位于 `detail-panel-wrapper` 消费边界，通用 `ExtensionMount` 不得 hardcode 资料库域名或路径；
- 标准 Host 必须接收可信 `extensionKind`，`library` 传 `builtin`；
- `ExtensionMount` 的 iframe 分支也应从可信 extension summary 传递 kind；
- 非 builtin 默认仍按 `platform` 处理，不能降低第三方 extension 权限边界；
- `localSdk` 直通只对 builtin 安全，当前 library 满足该条件。

### 6.4 MindX 标准 Host API

最终新链路不再保留任何资料库 Transport：

```text
Federation：宿主 window.wb
新 iframe：wb.js 在 iframe 自己的 window 上创建 Guest window.wb
                         ↓
        standard runtime + workbuddyHost 薄 Facade
```

MindX 业务优先调用类型化 `workbuddyHost`，但该 Facade 只直接委托当前窗口 `window.wb`；Federation 与标准 iframe 不再有载体分流。不得恢复 Direct/Iframe Transport、registry、动态 target/path 或资料库专用 wire。

原资料库专用 `IframeHostTransport`、`protocol.ts` 和 Genie 对应 host bridge/protocol 已在标准 Guest SDK 验证后删除。

### 6.5 新旧 iframe 的运行时判定

删除 `libraryHostApi=1` 后，不能用 URL、`preview=1`、客户端版本或单纯的 `window.wb` 是否存在来区分新旧 iframe。

原因：

- 新旧预览都可能带 `preview=1`；
- 发布过渡期间版本号不是可靠的能力证明；
- wb.js 会先创建 buffered `window.wb` Proxy，MessagePort 尚未接通时它也存在；
- `window.parent !== window` 只能判断 iframe，不能判断协议。

采用真实握手结果：

```text
可信 Federation 入口
  → standard

Desktop iframe
  ├─ 加载标准 wb.js，window.wbReady resolve
  │    → standard
  │
  └─ 既有 SpaceSdk 收到 SpaceSdkBridgeEvent.HostReady
       → legacy-space-iframe
```

建议建立一次性运行时状态：

```ts
type WorkBuddyRuntime = "standalone" | "standard" | "legacy-space-iframe";
```

实现约束：

- Desktop iframe 中并行启动 Guest SDK 和既有 SpaceSdk HostReady 探测；
- 使用“第一个成功握手”的结果，而不是任意一个 Promise 的首次失败；
- wb.js 加载失败或 `wbReady` reject 不能阻止 SpaceSdk 成功；
- SpaceSdk HostReady 是既有 sticky event，必须订阅现有事件，不新增 SpaceSdk 协议；
- 运行时一旦确定，在当前页面生命周期内锁定，不中途切换；
- `workbuddyHost` 只在已解析的 `standard` 且当前 `window.wb` 存在时可用，不能看到 buffered 对象就提前判定 ready；
- 老客户端不能因为等待 wb.js 默认 10 秒超时而延迟启动；SpaceSdk HostReady 成功后应立即继续；
- 新标准 Host 与旧 Host 最终各只挂一套协议；不为未发布的中间实现保留双 Host。

### 6.6 Deep Link 与内部路径

必须区分外部 Deep Link、WorkBuddy Shell Route 与 MindX 私有 Web URL。

| 类型                      | 最终值                                 | 是否变化                         |
| ------------------------- | -------------------------------------- | -------------------------------- |
| 外部资料库 Deep Link      | `workbuddy://library/open?...`         | 不变                             |
| 新客户端资料库主页        | `/extension/library`                   | 从未发布的 `/space` 改造         |
| 新客户端打开资源          | `/extension/library/open?...`          | 从未发布的 `/space/open` 改造    |
| 新客户端存储面板          | `/extension/library/storage?...`       | 从未发布的 `/space/storage` 改造 |
| MindX 文档 HTTPS URL      | `https://www.workbuddy.cn/space/d/...` | 不变                             |
| MindX Federation manifest | `/space/federation/v1`                 | 不变                             |

新客户端：

- Genie Deep Link resolver 将 `workbuddy://library/open` 落到 `/extension/library/open`；
- `wb.navigation.goto` 使用 `/extension/library/*`；
- library remote 自行将公开 extension route 转为 MindX 私有 route。

旧客户端：

- 继续消费相同的 `workbuddy://library/open`，由旧客户端自己的已发布代码解析；
- MindX 在 `legacy-space-iframe` 运行时继续使用既有 SpaceSdk `OpenInLibrary`、HTTPS `/space/d/...` 等老协议；
- 不把 `/extension/library/*` 传给 SpaceSdk `NavigateTo`；
- 不在新 Genie 中为旧 `/space` Shell Route 增加兼容 alias。

## 7. 保留与删除矩阵

### 7.1 必须保留

MindX：

- `apps/mindx/src/sdk/**`；
- 既有 `SpaceSdkBridgeEvent.HostReady`；
- 既有 `SpaceJsApiMethod.OpenInLibrary` 等老客户端调用；
- 老客户端所需的 SpaceSdk 业务调用分支；
- MindX `/space` Web basename；
- `/space/federation/v1`、`/space/d/*`、`/space/s/*`、`/space/collab`；
- 当前窗口 `window.wb` 的薄类型化 `workbuddyHost` Facade。

Genie：

- `packages/agent-ui/src/components/space-panel/**` 冻结旧链路；
- Extension 作者提交中的通用 route、menu、artifact preview 和 iframe host 基建；
- library builtin extension 与 Federation proxy；
- 外部 `workbuddy://library/open` 协议。

### 7.2 必须删除或替换

MindX：

- `libraryHostApi` query 解析与 `isMarkedWorkBuddyHostIframe`；
- `apps/mindx/src/workbuddy-host/iframe-transport.ts`；
- `apps/mindx/src/workbuddy-host/direct-transport.ts`、`transport-registry.ts` 与通用动态 target/path `transport.ts`；
- 新 iframe 专用 `apps/mindx/src/workbuddy-host/protocol.ts`；
- 对应的新协议单测与 marker 单测；
- `./wb.js` 相对地址；
- “wb.js 失败后继续走当前新 postMessage fallback”的日志和行为；
- 新链路 `/space/open`、`/space/storage` 路径生产逻辑；
- 只服务于未发布 marker/专用 Bridge 的业务判断。

Genie：

- 固定 `space/*` library extension route；
- `LibraryExtensionRouteView`；
- 仅为固定 library Surface 存在的 target/exclusion 逻辑；
- Sidebar 中资料库硬编码按钮及专用 active/warmup/keepAlive；
- 新预览的 `libraryHostApi=1` URL 装饰；
- `library-artifact-preview/host-bridge.ts`；
- `library-artifact-preview/protocol.ts`；
- 整个 `packages/agent-ui/src/components/library-iframe-wrapper/**`；
- 对应 wire protocol/marker 测试；
- 新客户端内部 `/space/open`、`/space/storage` 路由；
- 未发布旧实现的 redirect、alias 和兼容分支。

删除前必须用 `rg` 验证引用；不能因为文件名包含 `space` 就删除 MindX 私有 Web 路由或旧 SpaceSdk。

## 8. 大任务与小任务拆分

建议拆成三个实现会话和一个最终验证阶段。每个会话完成自己的测试后再进入下一阶段。

### 大任务 A：Sidebar 与通用 Extension Route

目标：资料库主入口完全由 extension manifest 和通用 `/extension/:extensionId/*` 驱动。

#### A1. 先补/改 Genie 路由测试

- 覆盖 `/extension/library` 命中 `ExtensionRouteView`；
- 覆盖 `/extension/library/open`、`/extension/library/storage` 的 catch-all；
- 覆盖 extension 相对 `contribution.route` 的 path/query/hash；
- 覆盖 Sidebar 在根路径和子路径均 active；
- 覆盖 library 不再被固定 Surface exclusion 排除；
- 断言新路由表不再注册 `space/*` library Surface。

#### A2. Manifest 驱动 Sidebar

- 在 library `extension.json` 增加 `ui.entry.placement: "sidebar"`；
- 让现有通用 extension menu hook 返回 library；
- 删除资料库硬编码 Sidebar block；
- 通用导航使用 `/extension/${entry.id}`；
- active 判断使用精确根路径或 `/${prefix}/` 边界匹配，避免 `library2` 误命中；
- 删除资料库专用 warmup/keepAlive 调用。

#### A3. 通用 ExtensionRouteView 传递相对子路由

- 从通用路由 splat 生成 `/`、`/open?...`、`/storage?...`；
- 通过现有 `contribution.route` 传给 remote；
- 不在 Host Router 中写 `library` 判断；
- 保证普通 extension 不受破坏；
- 更新 Extension Router 文档和测试，说明 shared Router 与 `contribution.route` 都是通用消费面，其中后者供拥有隔离内部 Router 的 remote 使用。

#### A4. MindX Federation 解析 Extension route

- 为 `/`、`/open`、`/storage` 编写纯函数解析器与测试；
- 复用稳定的 target 字段：`nodeId`、`spaceId`、`blockId`、`discussionId`、`requestId`；
- 将结果转换成 MindX 私有 `/space/*` route；
- `FederationRouteSync` 在 contribution route 更新时同步内部 `MemoryRouter`；
- 删除对 Genie 固定 `/space` contribution route 的依赖；
- 不全量重写 MindX 内部 Router，不修改普通 Web basename。

#### A5. 删除固定 Surface

- 删除 `LibraryExtensionRouteView`；
- 删除 `LIBRARY_EXTENSION_TARGET` 等只为固定 route 存在的定义；
- 清理 `getConsumedExtensionEntryIds()` 对 library 的排除；
- 删除固定 route 的 loading/i18n/测试；
- 用 `rg` 确认没有新客户端 Sidebar 或 Router 仍导航 `/space`。

#### A 阶段验收

- 点击 manifest 生成的资料库 Sidebar 进入 `/extension/library`；
- `/extension/library/open?...` 正确显示目标 MindX 文档；
- `/extension/library/storage?...` 正确触发存储面板；
- 子路由下 Sidebar 保持选中；
- Host Router 不包含 library 私有路径翻译；
- MindX 私有 `/space/*` 路由仍正常。

### 大任务 B：标准 iframe、builtin 身份与运行时分流

目标：右侧预览改用 Extension 作者的标准 iframe Host，并删除新链路专用 Bridge，同时保留老客户端 SpaceSdk。

#### B1. 修正标准 ExtensionIframeHost 的可信身份

- 扩展通用 Host props，使其可接收宿主可信的 extension kind；
- 默认值保持 `platform`，避免第三方扩展被提升权限；
- `ExtensionMount` iframe 分支从 registry summary 传入 `state.ext.kind`；
- 右侧资料库预览由 `ExtensionMount` 从 registry summary 取得 `builtin`，消费点不得自行伪造；
- subject 中的 `moduleId="library"`、`type="extension"`、`kind="builtin"` 与 permission registry 一致；
- 覆盖 builtin 全权限、platform 默认权限和不可由 iframe 篡改的测试；
- 若需 `allow` 属性，在通用 Host 增加可选 prop 并测试透传。

#### B2. 替换 Genie 右侧资料库预览

- 保留 URL 标准化和可信域/路径校验；
- 在 `detail-panel-wrapper` 与 `wb-extension://` 同层 hardcode 识别完整官方 origin + `/space` 路径，通用 Mount 内不增加资料库 URL hardcode；
- 在 library `extension.json` 声明 `artifactPreviews` contribution；消费点用 `contribution.data.artifact` 传动态文档 URL，Mount 只从 manifest 取得静态 preview entry；
- 用 ExtensionMount 替换整个 BrowserPreview，而不是 overlay 覆盖其内容区，确保地址栏/toolbar 不会挂载；
- 保留 DetailPanel 既有页签显隐/keep-alive 布局语义和标准 Host sandbox；
- 在 MindX 增加只负责校验 artifact 并跳转真实文档的 `/space/extension-preview` manifest entry；
- 不再添加 `libraryHostApi=1`；
- 不创建资料库专用 postMessage listener；
- iframe unmount/URL 切换时由标准 attachment dispose MessagePort；
- 删除整个 `library-iframe-wrapper`，消费点直接使用标准 Host；
- 覆盖 contribution 加载、URL 切换、非活动页签显隐、非法 URL、准确 targetOrigin 和页签关闭/卸载清理测试。

#### B3. MindX 加载标准 wb.js

- 把地址改成 `https://www.workbuddy.cn/wb.js`；
- loader 幂等，避免重复插入 script；
- script load 只表示代码加载，必须继续等待 `window.wbReady`；
- 类型边界声明 MindX 实际使用的最小 `window.wbReady`；
- 不直接访问 `window.parent.wb`；
- Federation 不重复加载 wb.js；
- 普通 Web 不加载 wb.js。

#### B4. 实现运行时握手解析

- 增加一次性 `WorkBuddyRuntime` 解析；
- Federation 与 Guest `wbReady` 都选择统一 `standard`；
- Desktop iframe 并行等待 Guest `wbReady` 与既有 SpaceSdk HostReady；
- 成功者锁定运行时；
- 单个候选失败不能提前判定整体失败；
- 老客户端 SpaceSdk 成功不能被 wb.js 网络失败或 10 秒默认超时拖延；
- `workbuddyHost` 在 `standard` 中直接调用当前窗口 `window.wb`，不构造 Transport；
- `legacy-space-iframe` 明确使用既有 SpaceSdk；
- 更新依赖 marker 的 UI、登录、主题、sidebar state 和面包屑判断。

#### B5. 删除新 iframe 专用协议

- 删除 MindX `IframeHostTransport` 和新 wire protocol；
- 删除 MindX `DirectHostTransport`、transport registry 和动态 target/path 抽象；
- 删除 Genie `host-bridge.ts` 和协议副本；
- 删除 `libraryHostApi` marker；
- 删除相应测试和 fallback；
- 保留 `SpaceSdk` 与 `space-panel/**`，不修改其协议表面。

#### B 阶段验收

- 新预览 iframe 的 `window.wbReady` 成功；
- `workbuddyHost` 能调用 navigation、ui、config、sharing、extensions 等已使用能力；
- builtin subject 正确；
- iframe URL 切换与卸载后无残留 port/subscription；
- 旧客户端加载新 MindX 后仍能通过 SpaceSdk HostReady 启动并完成既有操作；
- 代码中不存在 `libraryHostApi` 和新资料库专用 postMessage wire。

### 大任务 C：Deep Link 切换与最终清理

目标：新客户端的所有资料库入口统一到 `/extension/library/*`，同时保证旧 SpaceSdk 不收到新路径。

#### C1. Genie 新客户端路径

- `buildLibraryShellPath(home)` 返回 `/extension/library`；
- resource 返回 `/extension/library/open?...`；
- storage 返回 `/extension/library/storage?...`；
- Deep Link resolver 将 `workbuddy://library/open` 落到新路径；
- 删除新客户端 `/space/open`、`/space/storage`；
- 更新 navigation、route matcher、Sidebar、storage request 和测试；
- 外部 `workbuddy://library/open` 不变。

#### C2. MindX 新 Host 路径

- `buildWorkBuddyLibraryOpenPath` 返回 `/extension/library/open?...`；
- 只在 `standard` 运行时把该路径交给 `workbuddyHost.navigation.goto`；
- 面包屑、打开资料库、存储面板等新 Host 调用统一使用新路径；
- 更新测试。

#### C3. SpaceSdk 兼容隔离

- 审计所有 `navigateWorkBuddy(path)`、`buildWorkBuddyLibraryOpenPath()` 和 SpaceSdk fallback 调用点；
- 老 iframe 继续使用现有 `OpenInLibrary` HTTPS URL 或旧协议所要求的路径；
- 不让通用 fallback 把 `/extension/library` 发送给 SpaceSdk；
- 不新增 SpaceSdk method/event；
- 不重构 `apps/mindx/src/sdk/**`；
- 增加“新 MindX + 旧客户端运行时”的回归测试。

#### C4. 全仓残留扫描

至少检查：

```bash
rg 'libraryHostApi|isMarkedWorkBuddyHostIframe|IframeHostTransport'
rg 'createLibraryHostBridge|library-artifact-preview/protocol'
rg '/space/(open|storage)'
rg '/extensions/library'
rg '/extension/library'
rg 'SpaceSdk|SpaceJsApiMethod|SpaceSdkBridgeEvent'
```

解释结果：

- 前四组在新实现中不应有旧链路残留；
- `/extension/library` 应只出现在新客户端路径、测试和文档中；
- SpaceSdk 搜索必须仍有旧兼容实现，但不能出现本次新增协议；
- `/space` 的其他命中必须逐项判断，MindX 私有 Web/API 路径不能删除。

#### C 阶段验收

- 所有新客户端入口使用 `/extension/library/*`；
- 外部 Deep Link 仍为 `workbuddy://library/open`；
- 旧客户端 SpaceSdk 行为不变；
- 不存在未发布旧实现的 redirect、alias、marker 或 wire protocol；
- `/extensions/library` 零命中（文档中的反例除外）。

### 大任务 D：验证与发布准备

#### D1. MindX 验证

按实际脚本校准后至少执行：

```bash
pnpm --filter @mindx/app-mindx test -- test/workbuddy-host
pnpm --filter @mindx/app-mindx test -- src/federation/main.test.tsx
pnpm --filter @mindx/app-mindx test -- src/utils/workbuddy-library-deeplink.test.ts
pnpm --filter @mindx/app-mindx typecheck
pnpm --filter @mindx/app-mindx dist
pnpm --filter @mindx/app-mindx dist:federation:checked
```

还要执行所有因运行时分流、Workspace layout、登录、主题和 SpaceSdk 兼容而受影响的定向测试，并明确验证：

- `library-artifact-preview-route` 只接受精确 `https://www.workbuddy.cn/space[/...]` artifact，拒绝非法 origin、非 `/space` 路径和 preview entry 递归；跳转保留目标 query/hash；
- 普通 `dist` 包含 `/space/extension-preview` 路由；不能只用 Federation 构建代替标准 iframe Web 入口验证；
- `https://www.workbuddy.cn/wb.js` loader 幂等，script load 后继续等待当前窗口 `window.wbReady`，不读取 `window.parent.wb`；
- Federation 与标准 iframe 均锁定 `standard`，旧客户端 SpaceSdk HostReady 可快速锁定 `legacy-space-iframe`，单候选失败不提前判整体失败；
- `/extension/library/*` 只进入 `standard` Host，旧 SpaceSdk 继续使用既有 HTTPS `OpenInLibrary`/旧协议路径。

#### D2. Genie 验证

先执行 `nvm use`，再按实际 package scripts 校准：

```bash
pnpm --filter @genie/workbuddy-extensions-builtin test -- library-extension.spec.ts library-manifest-loader.spec.ts
pnpm --filter @genie/extension-library build
pnpm exec vitest run \
  packages/agent-ui/src/utils/space-url.spec.ts \
  packages/agent-ui/src/components/detail-panel-wrapper/library-preview-extension.spec.ts \
  packages/context-viewer-components/src/DetailPanel/browser-preview-override.spec.tsx \
  packages/workbuddy-extensions/src/renderer/extension-mount.spec.ts \
  packages/workbuddy-extensions/src/renderer/hosts/iframe-host.spec.ts \
  packages/workbuddy-extensions/src/runtime/iframe-attachment.spec.ts \
  packages/workbuddy-core/src/wb/boundary/transport/messageport.spec.ts
pnpm --filter @genie/context-viewer-components run compile
pnpm --filter @genie/agent-ui compile
pnpm --filter @genie/workbuddy-extensions-builtin typecheck
```

同时执行 Router、Sidebar/menu hook、Deep Link、library open/storage event 的定向测试，并明确验证：

- library 构建后的 `extension.json` 含 `artifactPreviews`，静态 URL 为 `https://www.workbuddy.cn/space/extension-preview`，动态文档 URL 只进入 `contribution.data.artifact`；
- `detail-panel-wrapper` 只在精确生产 origin + `/space` 路径命中，并用 `ExtensionMount` 替换整个 BrowserPreview；地址栏、toolbar 和底层 webview 不挂载；
- 通用 `ExtensionMount` 不含 `workbuddy.cn`、`/space` hardcode，也不接受动态加载 URL；从 manifest 选择 preview URL并从 registry summary 注入 builtin kind；
- `ExtensionIframeHost` 的 subject、permission、targetOrigin 与 attachment dispose 正确，URL/身份切换和关闭/卸载后旧 port/pending 调用被释放；
- Desktop 本地产物 `dist/wb.js` 存在，固定 `https://www.workbuddy.cn/wb.js` 请求被客户端协议层拦截并返回本地脚本；不得把公网 404 当作成功证据。

#### D3. 跨仓联调矩阵

| 场景                        | 必验行为                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 新 MindX + 旧客户端         | SpaceSdk HostReady 快速锁定、登录态、主题、面包屑 OpenInLibrary、既有 JSAPI；绝不收到 `/extension/library/*`                                   |
| 新 MindX + 新客户端 Sidebar | manifest 入口、`/extension/library`、首页、open/storage 子路由、active、卸载重进                                                               |
| 新 MindX + 新客户端右侧预览 | manifest preview entry、ExtensionMount 自动进入 iframe、无浏览器地址栏、wb.js 被本地拦截、wbReady、builtin subject、文档加载、主题、导航与分享 |
| 外部 Deep Link              | 外部 `workbuddy://library/open` 保持不变，新客户端解析为 `/extension/library/open`                                                             |
| 多文档/页签切换             | artifact URL 切换时 iframe/port 正确重建；关闭页签或 Host 卸载时 dispose；非活动页签沿用 DetailPanel 既有 keep-alive 显隐语义                  |
| 异常场景                    | 非法 origin/path 不进入 builtin Mount、wb.js 加载失败不阻断旧 HostReady、Host 未 attach、无效 artifact/target、SDK 调用失败                    |

#### D4. 边界与产物审计

- `libraryHostApi`、`IframeHostTransport`、`DirectHostTransport`、资料库专用 Bridge/wire protocol、`library-iframe-wrapper` 零生产引用；
- Genie 通用 `ExtensionMount` 对资料库域名和 `/space` 零认知；`/space/extension-preview` 只出现在 library manifest、MindX 路由、测试和文档；
- `git diff -- apps/mindx/src/sdk` 与 `git diff -- packages/agent-ui/src/components/space-panel` 为空，SpaceSdk/space-panel 协议表面没有新增或重构；
- `/space/open`、`/space/storage` 在新客户端生产路径零残留；MindX 私有 `/space/d/*`、`/space/s/*`、Web/API/Federation/WebSocket 路径保留；
- `/extension/library/*` 只用于新客户端 Shell/Deep Link，不传给旧 SpaceSdk；
- library builtin 构建产物包含最终 manifest contribution，Desktop 构建产物包含可被固定 URL 拦截返回的 `dist/wb.js`；
- 两仓执行 `git diff --check`，记录 branch、HEAD、staged/unstaged 与用户既有 dirty 状态。

#### D5. 发布顺序

1. 发布 MindX；
2. 用至少一个真实旧客户端验证新版 MindX 的 SpaceSdk 链路；
3. 发布新版 WorkBuddy 客户端；
4. 验证 Sidebar Federation、右侧预览和 Deep Link；
5. 观察错误日志后再扩大客户端发布范围。

MindX 先发布安全的必要条件：旧客户端运行时选择必须由 SpaceSdk HostReady 成功锁定，且任何新 `/extension/library` 路径都不能进入 SpaceSdk。

## 9. 重点文件清单

### 9.1 MindX

- `apps/mindx/src/template/index.tsx`
- `apps/mindx/src/template/app.tsx`
- `apps/mindx/src/federation/main.tsx`
- `apps/mindx/rspack.federation.config.mjs`
- `apps/mindx/src/workbuddy-host/load-workbuddy-guest-sdk.ts`
- `apps/mindx/src/workbuddy-host/runtime.ts`
- `apps/mindx/src/workbuddy-host/legacy-fallback.ts`
- `apps/mindx/src/workbuddy-host/host-api.ts`
- `apps/mindx/src/workbuddy-host/workbuddy-global.d.ts`
- `apps/mindx/src/utils/workbuddy-library-deeplink.ts`
- `apps/mindx/src/pages/workspace-page-layout/pc.tsx`
- `apps/mindx/src/hooks/use-wb-shell-state.ts`
- `apps/mindx/src/hooks/use-host-auth.ts`
- `apps/mindx/src/sdk/**`（冻结保留）
- `apps/mindx/test/workbuddy-host/**`
- `apps/mindx/src/federation/main.test.tsx`

### 9.2 Genie

- `packages/workbuddy-extensions-builtin/extensions/library/extension.json`
- `packages/workbuddy-extensions-builtin/extensions/library/distribution.json`
- `packages/workbuddy-extensions-builtin/extensions/library/src/remote-entry.ts`
- `packages/agent-ui/src/components/conversation-list/sidebar-navigation.tsx`
- `packages/agent-ui/src/router/extension-menu-hook.ts`
- `packages/agent-ui/src/router/extension-route-view.tsx`
- `packages/agent-ui/src/router/route-config.ts`
- `packages/agent-ui/src/router/route-matchers.ts`
- `packages/agent-ui/src/router/library-extension-route-view.tsx`（删除目标）
- `packages/agent-ui/src/router/extension-surface-targets.ts`（若无其他消费则删除）
- `packages/agent-ui/src/router/extension-mount.tsx`
- `packages/workbuddy-extensions/src/renderer/extension-mount.tsx`
- `packages/workbuddy-extensions/src/renderer/hosts/iframe-host.tsx`
- `packages/agent-ui/src/components/detail-panel-wrapper/index.tsx`
- `packages/agent-ui/src/utils/space-url.ts`
- `packages/agent-ui/src/navigation/library-target.ts`
- Deep Link resolver 相关文件
- `apps/workbuddy-desktop/src/main/window/wb-guest-protocol.ts`
- `packages/agent-ui/src/components/space-panel/**`（冻结保留）

执行时先用 `rg` 重新确认路径与引用，本文清单不是允许盲删的脚本。

## 10. 测试优先级

### P0：必须阻塞交付

- 新 MindX + 旧客户端 SpaceSdk；
- 新 iframe `wbReady` 握手；
- builtin subject 正确且不可由 iframe 篡改；
- `/extension/library/open` 资源定位；
- 新路径不进入 SpaceSdk；
- 非法 origin 拒绝；
- iframe dispose；
- 无 `libraryHostApi`、无旧新链路协议残留。

### P1：应完成

- Sidebar 子路由 active；
- extension disabled/not-found/error UI；
- storage request；
- discussion/block 定位；
- theme、locale、font size、fullscreen/sidebar state；
- 多文档切换；
- Federation remote route 更新不重载错误文档。

### P2：可在主链稳定后补充

- 诊断日志细化；
- 弱网下 wb.js 失败体验；
- 更完整的性能对比。

## 11. 风险与处理方式

### 11.1 buffered `window.wb` 误判

风险：wb.js 已创建 Proxy，但 MessagePort 未连接，运行时提前认定标准 Host 可用。
处理：只有 `wbReady` resolve 且当前窗口存在 `window.wb` 后才能标记 `standard`。

### 11.2 MindX 先发布导致旧客户端收到新路径

风险：旧 SpaceSdk 不认识 `/extension/library`。
处理：运行时分流后，新路径只进入标准 Host；旧分支继续 `OpenInLibrary`/HTTPS URL。

### 11.3 builtin 被错误标为 platform

风险：权限 registry 与请求 subject 不一致，部分 builtin-only 能力拒绝或审计错误。
处理：Host 从可信 summary/宿主常量注入 `kind="builtin"`，默认仍为 platform。

### 11.4 把 `/space` 全局替换

风险：破坏 MindX Web、manifest、API、WebSocket 和老 SpaceSdk。
处理：只替换 WorkBuddy 新客户端 Shell Route；逐个审核每个 `/space` 命中。

### 11.5 为了路由改造重写 MindX 全部导航

风险：大量 `navigate("/home")`、basename 和分享 URL 行为被扩大修改。
处理：通过通用 `contribution.route` 把 extension 相对路由交给 MindX Federation 边界，再映射到现有隔离 `MemoryRouter`。

### 11.6 新旧候选首次失败导致错误选型

风险：wb.js 网络错误先发生，运行时立即失败，SpaceSdk 尚未完成 HostReady。
处理：使用 first-success/`Promise.any` 等语义，单候选 reject 不结束整体解析。

### 11.7 一个会话修改范围过大

风险：跨四层基础设施，测试失败难定位，评审与回退边界过大。
处理：按 A、B、C 三个实现会话拆分，每个会话完成测试并更新本文状态。

## 12. 执行规则

每个新会话必须：

1. 完整阅读本文；
2. 使用 `library-federation-develpment` skill；
3. 修改代码前按两个仓库各自规则读取必需文档；
4. 若进入代码修改，执行 MindX `dev-workflow` 分档与 Agent 编排要求；
5. 分别检查两个仓库的 branch 与 dirty 状态；
6. 只处理第一个未完成的大任务，不跨越到下一任务制造半成品；
7. 先补关键测试，再改实现；
8. 不覆盖用户已有修改；
9. 完成后运行该阶段测试并记录结果；
10. 不 commit、push 或创建 PR，除非用户明确要求。

建议各会话在本文下方更新执行状态，但不要改写已冻结的架构决策。

## 13. 执行状态

- [x] 大任务 A：Sidebar 与通用 Extension Route
- [x] 大任务 B：标准 iframe、builtin 身份与运行时分流
- [x] 大任务 C：Deep Link 切换与最终清理
- [ ] 大任务 D：两仓验证与发布准备
  - [x] D1：MindX 自动化验证与两类生产构建
  - [x] D2：Genie 自动化验证、library/wb.js 产物与 Desktop 入包接线
  - [ ] D3：真实已登录新/旧客户端跨仓联调矩阵
  - [x] D4：边界、冻结目录、路径与构建产物审计
  - [ ] D5：按既定顺序发布及发布后观察

### 13.1 大任务 A 验证记录（2026-08-27）

- Genie 运行时：非交互环境未提供 `nvm`，改用现有 `fnm use` 切换到 `.nvmrc` 要求的 Node `22.23.1`（pnpm `11.20.0`）完成验证。
- Genie builtin library：`pnpm --filter @genie/workbuddy-extensions-builtin test -- library-extension.spec.ts` 通过（2 files / 52 tests）。
- Genie library build：`pnpm --filter @genie/extension-library build` 通过。
- Genie Router/Sidebar：`pnpm --filter @genie/agent-ui exec vitest run --config vitest.config.ts src/router` 通过（2 files / 68 tests）。
- Genie Industry 导航：定向运行 `industry-nav.spec.ts` 与 `schema-validation.spec.ts` 通过（2 files / 47 tests）。
- Genie extension menu selector：定向运行 `use-extension-menu-entries.spec.ts` 通过（2 tests）。
- Genie 类型检查：`pnpm --filter @genie/agent-ui compile` 通过。
- MindX Federation：`pnpm --filter @mindx/app-mindx test -- src/federation/main.test.tsx` 通过（34 tests）。
- MindX 类型检查：`pnpm --filter @mindx/app-mindx typecheck` 通过。
- MindX Federation checked build：`pnpm --filter @mindx/app-mindx dist:federation:checked` 通过（build / verify / stage 全部成功；仅保留既有 asset-size warning）。
- 边界审计：Genie 生产 Sidebar/Router 无固定 `/space` Extension Surface；`LibraryExtensionRouteView`、`LIBRARY_EXTENSION_TARGET`、专用 loading/badge/industry `builtin:space` 已清理；MindX `apps/mindx/src/sdk/**` 与 Genie `space-panel/**` 零 diff；MindX 私有 `/space` Web/API/Federation/WebSocket 路径保留。
- 架构守卫：命中本轮净删减/路径迁移的存量大文件阈值；已按 Genie 规则完成强制 Review 并 PASS，作为非阻断审计证据记录。
- 未执行真实客户端 smoke：当前可见 dev server 属于另一 worktree，不能代表本轮两个工作目录；自动化验证不受影响。

### 13.2 大任务 B 验证记录（2026-08-27）

- POC 对齐：复核作者 commit `d873bbd6ffa` 的 `artifactPreviews → ExtensionMount → container host` 实现后，library manifest 新增 `space/doc-ref` contribution，静态入口为 `https://www.workbuddy.cn/space/extension-preview`；动态文档 URL 只作为 `contribution.data.artifact` 传递。`/space` hardcode 与 `wb-extension://` 位于同一个 `detail-panel-wrapper` 消费层，通用 Mount 对 `workbuddy.cn`、`/space` 零认知。
- Genie 标准预览：定向 Vitest 合并命令通过（7 files / 37 tests），覆盖官方 URL 标准化、contribution 加载/匹配、非法 URL 回退、整个 BrowserPreview 替换（地址栏与 toolbar 不挂载）、Mount 选择 manifest preview URL、builtin kind 注入、精确 targetOrigin、URL/身份切换以及 attachment/MessagePort dispose。builtin extension 测试通过（2 files / 52 tests），并验证构建后的 library manifest 含 preview contribution；`library-iframe-wrapper` 整目录删除。
- Genie 类型与编译：`pnpm --filter @genie/context-viewer-components run compile`、`pnpm --filter @genie/agent-ui run compile`、`pnpm --filter @genie/workbuddy-extensions-builtin typecheck` 均通过；后者通过 project reference 同时覆盖 `workbuddy-extensions`。本轮实际 Node 为 `v24.18.0`、pnpm `11.20.0`；按用户约定不代替用户构建 Desktop `dist/wb.js`。
- MindX 标准 Host/runtime：合并定向测试通过（12 files / 81 tests），覆盖固定 `https://www.workbuddy.cn/wb.js`、script load 后继续等待当前窗口 `window.wbReady`、loader 幂等、`standard`/legacy first-success、单候选失败、SpaceSdk HostReady 快速胜出、首次成功锁定、薄 Facade 只调用当前窗口 `window.wb`，以及 manifest preview entry 对 artifact 的 origin/path/递归校验与真实文档路由跳转。
- MindX 类型与构建：`pnpm --filter @mindx/app-mindx typecheck`、`pnpm --filter @mindx/app-mindx dist`、`pnpm --filter @mindx/app-mindx dist:federation:checked` 全部通过；普通生产构建与 Federation build / verify / stage 仅输出既有 asset-size warning。
- builtin/权限证据：消费点不能传入 kind；`extensionKind="builtin"` 只取自 registry summary，动态 artifact query 和 iframe 消息均不能覆盖 subject。Host/permission 测试证明最终 subject 为 `moduleId=library`、`type=extension`、`kind=builtin` 并命中 builtin 全权限；未声明或第三方 kind 仍按 `platform` 收敛。targetOrigin 由 manifest preview URL 精确推导。
- 生命周期证据：切换 artifact 会改变最终 iframe URL/key 并重挂，标准 Host 在 URL/身份变化和 unmount 时 dispose 旧 attachment，晚到 load 不会重新 attach；MessagePort dispose 会释放 pending 调用。非活动 Browser tab 继续沿用 DetailPanel 原有 keep-alive/隐藏语义，关闭页签或组件卸载时才释放，不额外创建资料库 subscription/listener。
- 删除与残留审计：MindX `DirectHostTransport`、`IframeHostTransport`、transport registry、动态 target/path 与新 wire protocol 均删除；Genie `library-iframe-wrapper`、`host-bridge.ts`、协议副本及相关测试整目录删除。两仓生产代码对 `libraryHostApi`、专用 Bridge/wire 符号零命中。
- 冻结边界：`git diff -- apps/mindx/src/sdk` 与 `git diff -- packages/agent-ui/src/components/space-panel` 均为空；未新增、扩展或重构旧 SpaceSdk/`space-panel/**` 协议；未迁移 `buildLibraryShellPath`、Deep Link 或其他大任务 C 入口，未把 `/extension/library/*` 传给 SpaceSdk，MindX 私有 `/space` Web/API/Federation/WebSocket 路径未被全局替换或删除。
- Skill：已把 `library-federation-develpment` 的主契约、code map 和 Host API 参考更新为 `ExtensionMount → ExtensionIframeHost → 当前窗口 window.wb` 模型；通过 `uv run --with PyYAML` 执行 skill-creator `quick_validate.py`，输出 `Skill is valid!`。
- 质量审计：两仓 working-tree 与 index 的 `git diff --check` 均通过。Genie 架构守卫因触碰存量超大文件输出 `requiresReview=true`；主会话复核确认 `detail-panel-wrapper/index.tsx` 从基线 6024 行降至 6009 行、`vitest.config.ts` 从 1512 行降至 1511 行，命中的 `@genie/workbuddy-server/docs-shared` import 也在基线已存在，本轮未新增模块越界。新增 Genie 源码/测试共 153 行，新增 MindX 源码/测试共 63 行。Genie 根 `tsconfig.json` 仍是任务开始时未暂存的 9 行 project-reference 删除，已确认保持为 unstaged 且未被本任务编辑、覆盖或混入。
- 未执行项：未进行真实已登录 Desktop 新/旧客户端端到端 smoke，也未构建用户负责的 Desktop `dist/wb.js`；当前结论来自定向单元/组件/MessagePort 测试、类型检查、Agent UI 编译及 MindX 两种生产构建。真实客户端拦截 `wb.js` 并返回本地脚本、以及旧客户端实机 HostReady 联调保留到大任务 D。

### 13.3 大任务 C 验证记录（2026-08-27）

- TDD 红灯：先仅更新任务 C 关键断言；旧实现下 Genie 定向命令出现 10 个预期失败（3 files，60 tests 仍通过），MindX 定向命令出现 4 个预期失败（3 files，13 tests 仍通过），失败均准确指向旧 `/space/open`、`/space/storage`、`/space` Deep Link 落点或新路径被 SpaceSdk 接收。
- Genie Shell/Deep Link：`buildLibraryShellPath` 的 home/node/space 与 storage builder 已统一为 `/extension/library[/open|/storage]`；`workbuddy://library/open` 和 `workspace` 兼容 host 保持外部协议不变，解析后进入通用 Extension catch-all route。library open/storage window event、public `wb.navigation.goto`、Router matcher 与 Sidebar 子路由 active 共用新路径。
- MindX standard Host：`buildWorkBuddyLibraryOpenPath` 已改为 `/extension/library/open`；标准 iframe 面包屑仍只在 `standard` runtime 调用当前窗口 `workbuddyHost.navigation.goto`。旧 iframe 面包屑继续调用冻结的 `SpaceJsApiMethod.OpenInLibrary`，参数仍为完整 `https://.../space/d/...` URL。
- SpaceSdk 隔离：`navigateWorkBuddy` 在 `legacy-space-iframe` runtime 明确拒绝 `/extension/library` 根路径及其 slash/query/hash 边界，回归测试证明新路径既不进入 `SpaceJsApiMethod.NavigateTo`，也不误走 standard Host；既有 `/library/my-files`、JumpToConversation、ExpandSidebar 兼容行为保持不变。`git diff -- apps/mindx/src/sdk` 与 `git diff -- packages/agent-ui/src/components/space-panel` 均为空。
- Genie 定向验证：使用 `.nvmrc` 的 Node `22.23.1`（pnpm `11.20.0`）运行 `pnpm --filter @genie/agent-ui exec vitest run --config vitest.config.ts src/navigation/library-target.spec.ts src/navigation/use-library-open-event.spec.tsx src/router`，通过（4 files / 82 tests）；`pnpm --filter @genie/agent-ui run compile` 通过。
- MindX 定向验证：运行 `pnpm --filter @mindx/app-mindx test -- test/workbuddy-host src/utils/workbuddy-library-deeplink.test.ts test/pages/workspace-page-layout/pc.test.tsx src/federation/main.test.tsx`，通过（10 files / 93 tests）；`pnpm --filter @mindx/app-mindx typecheck` 通过。
- 残留扫描：排除冻结的 Genie `space-panel/**` 后，新客户端生产代码对 `/space/open`、`/space/storage` 零命中；`/extensions/library` 两仓生产代码零命中。`/extension/library` 仅位于 Genie Shell/Deep Link/API 示例、MindX standard Host builder、legacy 边界保护、测试和本文；`/space/extension-preview`、`/space/d/*`、`/space/s/*`、`/space/federation/v1` 及 MindX 私有 Web/API/WebSocket 路径保留。
- 范围控制：未修改 manifest preview contribution、URL 校验、wb.js loader、builtin subject、标准 Host 生命周期、MindX SpaceSdk 协议或 Genie `space-panel/**`；未构建 Desktop `dist/wb.js`，未执行真实客户端联调、完整发布矩阵或任何发布动作，这些仍属于未完成的大任务 D。

### 13.4 大任务 D 验证记录（2026-08-27）

- MindX 定向回归：`pnpm --filter @mindx/app-mindx test -- test/workbuddy-host src/federation/main.test.tsx src/utils/workbuddy-library-deeplink.test.ts test/pages/workspace-page-layout/pc.test.tsx test/pages/main-layout-page/pc.test.tsx test/hooks/use-host-auth.test.tsx test/hooks/use-wb-shell-state.test.tsx test/hooks/use-workbuddy-host-theme.test.tsx test/hooks/use-workbuddy-host-font-size.test.tsx test/hooks/use-main-layout.test.tsx` 最终通过（16 files / 254 tests）。首次扩展到 `main-layout-page` 时有 31 个用例因测试夹具未初始化 WorkBuddy runtime 而在断言前同源失败；补充 `standalone` runtime 的 setup/reset 后，该文件 31 tests 与整组均通过，未修改业务逻辑规避失败。
- MindX 类型与构建：`pnpm --filter @mindx/app-mindx typecheck`、`pnpm --filter @mindx/app-mindx dist`、`pnpm --filter @mindx/app-mindx dist:federation:checked` 全部通过；普通 dist 明确命中 `/space/extension-preview`、固定 `https://www.workbuddy.cn/wb.js` 和 `wbReady`，Federation build / verify / stage 生成 release `31db841fddde6582`，仅保留既有 asset-size warning。
- MindX 行为证据：上述测试覆盖 preview entry 的精确生产 origin、`/space` 路径、非法/递归目标与 query/hash 保留；固定 loader 幂等并继续等待当前窗口 `window.wbReady`；Federation/标准 iframe 锁定 `standard`，旧 SpaceSdk HostReady 可快速锁定 `legacy-space-iframe`，first-success 不被单候选失败提前终止；`/extension/library/*` 只进入 standard Host，legacy 面包屑继续使用完整 HTTPS `OpenInLibrary` URL。
- Genie Extension/预览验证：使用 `.nvmrc` 对应 Node `22.23.1` 运行任务 D 合并 Vitest 命令，通过（7 files / 37 tests）；builtin library/manifest loader 通过（2 files / 52 tests）；Router、Sidebar active、外部 Deep Link、library open/storage event 定向测试通过（3 files / 70 tests）。`pnpm --filter @genie/extension-library build`、`@genie/context-viewer-components compile`、`@genie/agent-ui compile`、`@genie/workbuddy-extensions-builtin typecheck` 均通过。
- Genie 预览边界：构建后的 `packages/workbuddy-extensions-builtin/dist/library/extension.json` 含 `space/doc-ref` 的 `artifactPreviews`，静态 URL 精确为 `https://www.workbuddy.cn/space/extension-preview`；动态文档 URL 只由 `contribution.data.artifact` 注入。测试继续证明 detail panel 仅识别精确生产 `/space` artifact，并由 `ExtensionMount → ExtensionIframeHost` 替换整个 BrowserPreview；通用 Mount 无资料库域名或 `/space` 生产 hardcode，builtin subject、permission、targetOrigin、URL/身份切换和 attachment/MessagePort dispose 均受覆盖。
- Desktop wb.js TDD 与修复：先新增打包契约断言，旧配置按预期红灯（缺少 `build:wb-bootstrap` script、prepackage 接线与 `extraResources`）。随后把 `@genie/workbuddy-core:build:wb-bootstrap` 接入 Desktop prepackage，并把 `packages/workbuddy-core/dist/guest/wb.js` 复制为生产 `resources/wb-guest-sdk/wb.js`；同步清理过时的 `wb-guest-sdk build:bundle` 提示。`pnpm --filter @genie/workbuddy-desktop build:wb-bootstrap` 成功，生成 `dist/guest/wb.js`（7032 bytes）及 source map；Desktop 协议/打包测试通过（2 files / 16 tests），精确验证只拦截 `https://www.workbuddy.cn/wb.js`、返回本地脚本、dispose 清理 listener，缺少本地产物时不注册宽泛拦截。Desktop typecheck 与本轮文件 ESLint 均通过。
- 残留与冻结审计：两仓生产代码对 `libraryHostApi`、旧 transport、资料库专用 Bridge/wire、`library-iframe-wrapper` 零命中；排除冻结 `space-panel/**` 后，Genie 新生产路径对 `/space/open`、`/space/storage`、`/extensions/library` 零命中。`/extension/library` 仅用于 Genie Shell/Deep Link、MindX standard builder/legacy 拒绝边界、测试与本文；MindX `apps/mindx/src/sdk/**` 和 Genie `packages/agent-ui/src/components/space-panel/**` 相对任务起点及 working tree 均零 diff。`/space/extension-preview` 只位于 library manifest、MindX preview route、测试和本文；`/space/d/*`、`/space/s/*`、`/space/federation/v1` 与 MindX 私有 Web/API 路径均保留。
- 架构与质量：Genie architecture guardian 输出 `errors=[]`、`requiresReview=false`，仅提示既有 `electron-builder.config.js` 超过 soft threshold；Desktop 定向 ESLint 通过。两仓 working tree 与 index 的 `git diff --check` 均通过。
- 最终 Git 状态：MindX 位于 `feature/1747-workbuddy-library-plugin-architecture`、HEAD `6794072f75a0436280099db66456c2fa1a21e558`，index 为空，unstaged 为本阶段测试夹具与本文 2 个文件；Genie 位于 `feat/issue-95508-library-integration`、HEAD `d44e5514a796eeed09ec13bca107fe4eb31db3e5`，index 为空，本阶段有 4 个 tracked Desktop 文件和 1 个新增协议测试文件未暂存。Genie 根 `tsconfig.json` 仍保持任务开始前用户已有的 9 行 project-reference 删除，继续为 unstaged，未被暂存、还原、覆盖或混入本阶段改动。
- 真实客户端探测：本机可见已安装 WorkBuddy `5.5.0`，但其安装包内没有本分支新增的 library manifest 与 `resources/wb-guest-sdk/wb.js`，本地也没有可用的 `9222` 调试端点；未发现可分别代表最终新客户端和指定旧版本的两套可控已登录客户端。在 MindX/Genie 尚未按 D5 发布、且本会话不替换用户安装包或擅自发布的前提下，无法把该安装包作为“新 MindX + 新客户端”或完整“新 MindX + 旧客户端”证据。因此 D3、D5 和最终真实联调 DoD 保持未完成，不以自动化测试冒充实机通过。
- 发布控制：未 push、未创建 PR、未发布 MindX/CDN/客户端，也未扩大客户端发布范围；后续仍严格按“MindX → 至少一个真实旧客户端 → 新 WorkBuddy 客户端 → Sidebar/右侧预览/Deep Link → 日志观察”的顺序执行。

## 14. Definition of Done

全部满足才算完成：

- [x] Sidebar 资料库入口完全由 `placement: "sidebar"` 产生；
- [x] 新客户端主入口为 `/extension/library`；
- [x] extension 子路由由通用 Host 传递、library remote 自行解释；
- [x] 右侧预览使用标准 `ExtensionMount`，由其选择 `ExtensionIframeHost`；
- [x] library iframe subject 为可信 builtin；
- [x] MindX 加载 `https://www.workbuddy.cn/wb.js`；
- [x] 新 iframe 以 `wbReady` 判断就绪；
- [x] 旧客户端以 SpaceSdk HostReady 判断并继续运行；
- [x] 外部 Deep Link 保持 `workbuddy://library/open`；
- [x] 新客户端内部路径全部为 `/extension/library/*`；
- [x] 新路径不会进入 SpaceSdk；
- [x] `libraryHostApi`、专用新 iframe Bridge 和 wire protocol 已删除；
- [x] 固定 `/space` library Extension Surface 已删除；
- [x] MindX 私有 `/space` Web/API 路径未被误删；
- [x] SpaceSdk 与 Genie `space-panel/**` 未新增能力、未破坏；
- [x] 两仓目标测试、typecheck 和构建通过；
- [ ] 新 MindX + 旧客户端、新 MindX + 新客户端均完成真实联调。
