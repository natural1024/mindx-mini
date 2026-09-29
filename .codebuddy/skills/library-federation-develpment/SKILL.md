---
name: library-federation-develpment
description: |
  当开发或排查 MindX 资料库在 WorkBuddy 中的新接入方案时使用。触发场景包括：
  客户端能力或接口、WorkBuddy 调用、联邦模块、Module Federation、资料库插件、
  library extension、workbuddyHost、libraryHostApi、新 iframe、对话区资料库产物预览、
  extension server、window.wb、WorkbuddySDK、wb.* 类型同步、wb.extensions.invoke、
  remoteEntry，以及 MindX 与 Genie 跨仓联调。
metadata:
  short-description: 开发 MindX 与 WorkBuddy 的资料库联邦模块及新 iframe 接入
---

# Library Federation Development

协助开发者在 MindX 与 Genie（WorkBuddy）两仓调研、设计、实现和验证资料库新接入方案。

## 术语约定

- **mindx**: 当前项目仓库
- **genie**: Workbuddy 的代码大仓
- **workbuddy**: 主要指 WorkBuddy 客户端，也包括 Web 端
- **library**: 资料库，MindX 在 WorkBuddy 中的名称，genie 侧的命名应该以 `library` 为准，不应该出现 `mindx` 的命名
- **extension/插件**: genie 侧的联邦模块方案，在 genie 中资料库是以插件的方式运行的
- **federation/联邦模块**: MindX 以联邦模块的形式接入到 WorkBuddy 中，等同于"插件"
- **老 iframe**: 位于 `apps/mindx/src/sdk` 中的老版本 `iframe` 通信方案，已被 federation 和新 iframe 方案完全替代，只做向前兼容
- **标准 iframe**: 会话区资料库 URL 由 Genie `detail-panel-wrapper` 在与 `wb-extension://` 相同的消费边界识别；随后按 manifest 的 `artifactPreviews` contribution 挂 `ExtensionMount`，由 Mount 选择 `ExtensionIframeHost`。页面加载标准 `https://www.workbuddy.cn/wb.js`，客户端拦截并提供本地 bundle，`window.wbReady` 完成后从当前窗口直接使用 `window.wb`

## 向前兼容

新的 federation (插件) 化方案在 Workbuddy 客户端 5.5.0 及以上版本中支持。老版本的客户端仍然使用老的 iframe 方案，修改 MindX 中相关的业务代码时，**务必确保老的 iframe 调用方式仍能正常工作**。

同时，老的 iframe 方案不再新增任何功能，仅允许 bugfix。

## 架构基线

- WorkBuddy 侧边栏资料库主入口使用 `library` builtin extension 加载 MindX Module Federation remote，完全放弃旧入口 iframe。
- 对话区资料库产物预览必须消费 Genie 通用 `ExtensionMount`，不得直接选择 `ExtensionIframeHost`。`detail-panel-wrapper` 校验精确 `https://www.workbuddy.cn/space[/...]` URL、匹配 library manifest 的 `artifactPreviews` contribution，并用 `contribution.data.artifact` 传动态文档 URL；Mount 从 manifest 取静态 preview entry，并显式选择 iframe 容器。Mount 不包含资料库域名或路径 hardcode，也不接受动态加载 URL覆盖；registry 可信注入 `moduleId=library`、`type=extension`、`kind=builtin`。身份不得来自 URL、query 或 iframe 消息。
- Federation 与标准 iframe 在 MindX 内完全等价：两者都从**当前窗口**读取 `window.wb`。标准 iframe 先加载固定 URL `https://www.workbuddy.cn/wb.js` 并等待 `window.wbReady`；不得读取 `window.parent.wb`。
- MindX 可保留薄的类型化 `workbuddyHost` Facade，但它只能直接调用当前 `window.wb`，不得再引入 Direct/Iframe Transport、资料库专用 wire protocol、`libraryHostApi` marker 或 Genie 专用 Bridge。
- 旧 MindX `SpaceSdk` 与 Genie `packages/agent-ui/src/components/space-panel/**` 仅为老客户端保留。不得新增功能、协议方法、handler、prop 或重构；只允许独立处理阻断性兼容 bug，等待老客户端退场后删除。

## 仓库门禁

1. 用 `git rev-parse --show-toplevel` 确定 MindX 根目录，不要依赖当前目录名。
2. Genie 的唯一约定位置是 MindX 根目录的平级目录 `../genie`。
3. 若 `../genie` 不存在或不是 Git 仓库，停止跨仓调研和写入，询问用户，并提示：**请把 Genie 仓库放到与 MindX 平级、目录名为 `genie` 的位置，以便同时联动两个仓库。** 不要自行 clone、移动仓库，也不要静默使用 `~/projects/genie` 等其他副本。
4. 分别检查两仓 `git status --short --branch`。两仓分支、dirty 状态、Issue、包管理命令和提交规范相互独立；不得覆盖或回退用户已有改动。

## 开发前必读

- MindX：根 `AGENTS.md`，以及目标目录中的规则和架构文档。
- Genie：根 `AGENTS.md`（及其指向的根 `CODEBUDDY.md`），再读取目标路径向上的 `AGENTS.md`、`CODEBUDDY.md`、`README.md`、`ARCHITECTURE.md` 和命中的 `.codebuddy/rules/*.md`。
- 修改 Genie `agent-ui` 时至少读取 `packages/agent-ui/CODEBUDDY.md`、`.codebuddy/rules/workbuddy-architecture.md`、`agent-ui-module-rules.md`，UI/样式改动还要执行 pre-edit reuse checkpoint。
- 修改 Genie extension、Core、Server 或 Desktop 时，按 [references/code-map.md](references/code-map.md) 的“规范路由”继续加载对应文档。不要把 MindX 规范套到 Genie，也不要反过来。
- 涉及 `window.wb`、新增/复用 `wb.*` 能力、MindX `workbuddyHost` 或跨仓类型同步时，必须读取 [references/workbuddy-host-api.md](references/workbuddy-host-api.md)。

本 skill 不依赖任何外部 skill、插件或特定 Agent 工作流。若当前 Agent 提供额外能力，可以使用，但不得把它们当作执行本 skill 的前置条件。

## 能力落点决策

按顺序判断，不要先改 Bridge：

1. **纯 MindX 云端 CRUD**：优先经 `workbuddyHost.http`，不在 Genie 增加转发业务层。
2. **资料库专属端上业务**：优先封装在 Genie `library` extension 的 server/service 中；MindX 通过 `workbuddyHost.extensions.invoke("library", method, params)` 调用。当前 `library` extension 是 UI-only，新增 service 时对齐 Genie extension manifest、process policy、权限、构建和 `bootstrap()` 生命周期规范。
3. **跨业务通用平台 capability**：才考虑已有或新增 `wb.<namespace>`。遵守 Genie 分层：稳定跨端契约归 Core（需准入 CR），daemon/本地运行能力归 Server，Electron 原生动作只在 Desktop 提供窄 host capability，业务策略不得放 Desktop。
4. **renderer 提供、所有挂载实例都可用的通用 capability**：必须走 `packages/agent-ui/src/app-core/wb-provider/` 的标准 provider 流程：独立 `*.provide.ts` → `SdkProviderModule` → `PROVIDERS` 登记 → `exposeToGuest: true`。`$provide` 服务同 realm，`exposeToGuest` 服务 iframe Guest；两者缺一不可。所有 `wb` 方法都按异步 Promise 契约设计。详细流程见 [references/workbuddy-host-api.md](references/workbuddy-host-api.md)。
5. **只与某个 `ExtensionMount` 实例绑定的业务 capability**：通过该 Mount 的 `exposes` prop 注册；实例 exposes 优先于全局 expose，再回落 daemon。保持 `exposes` 引用稳定，卸载或重挂时由 iframe Host cleanup 调 attachment `dispose()` 回收。`ExtensionMount` 没有需要业务方手调的公开 `dispose()` 方法。详细流程见 [references/workbuddy-host-api.md](references/workbuddy-host-api.md)。
6. **仅 UI 展示或挂载**：放对应 renderer/extension surface；`agent-ui` 不实现 daemon 业务，不直接创建 service，不新增 adapter 业务方法。

新增 `wb.*` 方法或 extension server method 时，通常只需修改能力实现与 MindX 的最小类型镜像/类型化 Facade。标准 iframe 的 MessagePort 协议属于 Genie 通用 extension 基建；资料库代码不得复制、包装或扩展它，也不得为具体业务方法增加专用 handler。

通用 renderer namespace 不得通过 `initAppCore()` 的 `defineProperty`、Web/Desktop SDK entry 的散点 `$provide`、daemon no-handler 补丁或资料库专用 Bridge 注册。单挂载业务 namespace 也不得误注册进全局 `expose()`。

## 执行流程

1. 读取 [references/code-map.md](references/code-map.md)，再用 `rg` 验证路径与当前实现，避免把文档当作永不变化的真相。
2. 画出调用链：MindX 业务调用点 → 当前窗口 `window.wb`（或其薄 Facade）→ Genie `wb.*` 或 `library` service。标准 iframe 额外标明 `wb.js → wbReady`，但业务调用链与 Federation 不分叉。
3. 明确主入口 Federation、标准产物 iframe、旧 iframe 三者中的目标；前两者共享标准运行时，旧链路只允许兼容 bugfix。
4. 按两仓各自的测试规范实现和补充测试。新增通用 renderer namespace 时，同时覆盖 `$provide`、`exposeToGuest` 和 Guest channel 不回落 daemon；agent-ui 覆盖资料库 URL 校验、manifest contribution 选择和对整个 BrowserPreview 的替换；通用 `ExtensionMount` 覆盖 contribution URL 解析与容器执行，内部 iframe Host 基建覆盖实例 exposes、subject、origin、port 与 dispose 清理；不得在 MindX 或资料库 wrapper 中复制协议测试。
5. 分仓执行最小相关测试、typecheck、lint/build；跨仓行为再做联调。不要用一仓通过代替另一仓验证。
6. 提交、push 或 PR 只在用户明确要求时执行，并分别遵守两仓根规则中的 commit、Issue 和发布规范。

## 红线

- 不给 `apps/mindx/src/sdk/**` 或 Genie `space-panel/**` 增加新功能。
- 不从 MindX iframe 读取 `window.parent.wb`；只使用 wb.js 在当前窗口建立的 `window.wb`。
- 不把资料库业务逻辑挂到 `window.wb`；`window.wb` 只承载 WorkBuddy 平台 SDK。资料库专属逻辑默认走 `library` extension server，除非开发者明确要求并满足通用平台 capability 的准入条件。
- 不把通用 renderer namespace 只 `$provide` 到同 realm 而漏掉 `exposeToGuest`；也不把同步返回类型镜像到 MindX。`wb.*` 方法跨边界一律视为 Promise。
- 不把 `ExtensionMount exposes` 描述成全局能力或虚构公开的 `ExtensionMount.dispose()`；公开注册入口是 `exposes` prop，清理由内部 attachment 生命周期完成。
- 不创建 `library-iframe-wrapper`、资料库专用 postMessage Bridge、wire protocol、marker 或 fallback；不绕过通用 Host 的 origin/source、subject、权限和清理逻辑。
- 不手改 Genie 自动生成的 `wb-global.d.ts`、`*.generated.ts` 或生成式 API 文档。
