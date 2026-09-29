# Library Federation Code Map

路径均相对各自仓库根目录。使用前以 `rg` 和当前分支代码复核。

## MindX

### Federation 主入口

| 路径                                                      | 职责                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/mindx/src/federation/main.tsx`                      | 暴露给 WorkBuddy 的真实应用入口；使用当前窗口 `window.wb`                   |
| `apps/mindx/src/federation/federation-login-provider.tsx` | Federation 账号状态消费方                                                   |
| `apps/mindx/rspack.federation.config.mjs`                 | Module Federation remote 构建，remote name 为 `library`，expose 为 `./Main` |
| `apps/mindx/scripts/dev-federation.mjs`                   | 本地 Federation 开发服务                                                    |
| `apps/mindx/scripts/federation-artifacts.mjs`             | 发布制品与 manifest 生成                                                    |
| `apps/mindx-webserver/src/routes/federation.ts`           | `/space/federation/v1` manifest 服务                                        |

### 标准 WorkBuddy 运行时

| 路径                                                               | 职责                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `apps/mindx/src/workbuddy-host/load-workbuddy-guest-sdk.ts`        | 标准 iframe 幂等加载 `https://www.workbuddy.cn/wb.js`，script load 后继续等待当前窗口 `wbReady`    |
| `apps/mindx/src/workbuddy-host/runtime.ts`                         | 一次性解析 `standard / legacy-space-iframe / standalone`；Federation 与标准 iframe 均归 `standard` |
| `apps/mindx/src/workbuddy-host/host-api.ts`                        | 对当前窗口 `window.wb` 的薄类型化 Facade；无 Transport、marker 或自有协议                          |
| `apps/mindx/src/workbuddy-host/library-artifact-preview-route.tsx` | manifest preview entry；校验 `artifact` 后跳转到 basename 内真实文档路由                           |
| `apps/mindx/src/workbuddy-host/workbuddy-global.d.ts`              | MindX 实际消费的最小 WorkBuddy 类型，不是 Genie SDK 真相源                                         |
| `apps/mindx/test/workbuddy-host/**`                                | wb.js/wbReady、运行时竞速、当前窗口 Facade 与旧兼容分流测试                                        |

业务可通过 `workbuddyHost` 获得稳定类型，但该 Facade 只允许直接委托当前窗口 `window.wb`。不要恢复 `direct-transport.ts`、`iframe-transport.ts`、`transport-registry.ts`、`protocol.ts` 或任何 `libraryHostApi` 判断。

### 冻结旧方案

- `apps/mindx/src/sdk/space-sdk.ts`
- `apps/mindx/src/sdk/internal/space-sdk-impl.ts`
- `apps/mindx/src/sdk/internal/bridge-protocol.ts`
- 仍调用 `getSpaceSdk()` / `useSpaceSdk()` 的存量业务

只处理老客户端阻断性兼容 bug。新能力不得增加 `SpaceJsApiMethod`、bridge event 或旧调用点。

## Genie / WorkBuddy

### `window.wb` 平台能力

Genie 的 `wb.*` 契约、运行时注入和生成类型不属于 Library extension 自身。修改或复用这类能力时，先读 [workbuddy-host-api.md](workbuddy-host-api.md)，不要从资料库代码反向定义平台 SDK。

### Library builtin extension 与 Federation host

| 路径                                                                              | 职责                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workbuddy-extensions-builtin/extensions/library/extension.json`         | `library` 内层 manifest；主 entry 指向 Federation proxy，`artifactPreviews` 声明标准 iframe preview entry                             |
| `packages/workbuddy-extensions-builtin/extensions/library/distribution.json`      | builtin 信任、授权和 process policy                                                                                                   |
| `packages/workbuddy-extensions-builtin/extensions/library/src/manifest-loader.ts` | 拉取并校验 MindX Federation manifest，导入 hashed remote                                                                              |
| `packages/workbuddy-extensions-builtin/extensions/library/src/remote-entry.ts`    | 本地 Federation proxy container 的 `init/get`                                                                                         |
| `packages/agent-ui/src/router/extension-surface-targets.ts`                       | `/extension/library/*` 到 `library` entry 的固定 surface binding                                                                      |
| `packages/agent-ui/src/router/library-extension-route-view.tsx`                   | 侧边栏资料库路由壳                                                                                                                    |
| `packages/agent-ui/src/router/extension-mount.tsx`                                | WorkBuddy Extension 统一挂载装配；资料库预览消费此入口，不直接选择具体 Host                                                           |
| `packages/agent-ui/src/app-core/wb-provider/*.provide.ts`                         | renderer 通用 `wb.*` namespace 的标准注册点；`SdkProviderModule` + `PROVIDERS` + `exposeToGuest` 同时覆盖同 realm 与 Guest            |
| `packages/workbuddy-extensions/src/renderer/extension-mount.tsx`                  | 统一执行 Federation/iframe 等载体选择；从 manifest 解析 contribution URL，接收显式容器但不接受动态加载 URL，不包含资料库业务 hardcode |
| `packages/workbuddy-extensions/src/renderer/hosts/iframe-host.tsx`                | 标准 iframe Host；可信注入 subject 并管理 MessagePort 生命周期                                                                        |
| `packages/workbuddy-extensions/src/runtime/iframe-attachment.ts`                  | wb.js 通用 attach 协议与 port 清理                                                                                                    |

资料库专属 server 能力可在 `extensions/library/src/server/` 增加入口，并在 manifest、process policy 与构建脚本中登记。MindX 通过 `workbuddyHost.extensions.invoke("library", method, params)` 调用；不要自建 RPC 通道。

### 对话区资料库标准 iframe

| 路径                                                                                 | 职责                                                                                                                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-ui/src/components/detail-panel-wrapper/index.tsx`                    | 在与 `wb-extension://` 相同的消费层 hardcode 识别可信 `/space` URL，并用 ExtensionMount 替换整个 BrowserPreview                        |
| `packages/agent-ui/src/components/detail-panel-wrapper/library-preview-extension.ts` | 将可信 URL 匹配到 manifest `artifactPreviews` entry，动态文档地址只进入 `contribution.data.artifact`                                   |
| `packages/context-viewer-components/src/DetailPanel/browser-preview-override.tsx`    | 通用整块 BrowserPreview 替换契约；`undefined` 回落浏览器，其它 ReactNode（含 null）由宿主接管                                          |
| `packages/agent-ui/src/utils/space-url.ts`                                           | 精确生产 origin `https://www.workbuddy.cn` 与 `/space` 路径校验、preview/theme 参数标准化；其他环境不进入 builtin Mount                |
| `packages/workbuddy-extensions-builtin/extensions/library/extension.json`            | 声明 `library-document` artifact preview 与 `https://www.workbuddy.cn/space/extension-preview` 静态入口                                |
| `packages/workbuddy-extensions/src/renderer/extension-mount.tsx`                     | 按 contribution id 从 manifest 取 preview URL、追加 `artifact` query、执行显式 iframe 分流，并从 registry summary 透传 builtin kind    |
| `packages/workbuddy-extensions/src/renderer/hosts/iframe-host.tsx`                   | Mount 的内部 iframe 载体；注入 `moduleId=library`、`type=extension`、`kind=builtin`，设置 sandbox/allow/targetOrigin 并清理 attachment |
| `packages/workbuddy-core/src/guest/**`                                               | 标准 wb.js Guest SDK 源码与构建产物来源                                                                                                |
| `apps/workbuddy-desktop/src/main/window/wb-guest-protocol.ts`                        | Desktop 拦截固定 wb.js URL并返回本地 bundle                                                                                            |

`packages/agent-ui/src/components/library-iframe-wrapper` 应不存在。资料库预览不得拥有 host bridge、协议副本、`libraryHostApi` marker 或专用 postMessage listener。

### 冻结旧方案

- `packages/agent-ui/src/components/space-panel/**`
- `packages/agent-ui/src/pages/space.tsx` 等仍承载旧客户端路径的存量消费点

不加新 handler、prop、协议方法或业务功能。

## Genie 规范路由

先读根 `AGENTS.md`/`CODEBUDDY.md`，再按改动范围加载：

| 改动范围                                   | 必读入口与关键约束                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-ui/**`                     | `packages/agent-ui/CODEBUDDY.md`、`ARCHITECTURE.md`、`.codebuddy/rules/agent-ui-module-rules.md`、`workbuddy-architecture.md`；UI/样式先执行 reuse checkpoint |
| `packages/workbuddy-extensions/**`         | `packages/workbuddy-extensions/README.md`、`docs/README.md`；Runtime 只放通用基建                                                                             |
| `packages/workbuddy-extensions-builtin/**` | `packages/workbuddy-extensions-builtin/README.md`；builtin UI 只消费 `wb`                                                                                     |
| `packages/workbuddy-core/**`               | `packages/workbuddy-core/CODEBUDDY.md`、`ARCHITECTURE.md`、`src/wb/README.md`；Core 准入需 CR，禁止手改生成文件                                               |
| `packages/workbuddy-server/**`             | `packages/workbuddy-server/AGENTS.md`、`CODEBUDDY.md`、`ARCHITECTURE.md`；不得 import Electron                                                                |
| `apps/workbuddy-desktop/**`                | `apps/workbuddy-desktop/AGENTS.md`、`CODEBUDDY.md`、`ARCHITECTURE.md`；只承载 Electron 壳和原生 capability                                                    |

## 常用验证

命令以各仓当前 `package.json` 为准。

### MindX

```bash
pnpm --filter @mindx/app-mindx test -- test/workbuddy-host
pnpm --filter @mindx/app-mindx typecheck
pnpm --filter @mindx/app-mindx dist:federation:checked
```

### Genie

先执行 `nvm use`，以根 `.nvmrc` 为准。

```bash
pnpm exec vitest run packages/agent-ui/src/utils/space-url.spec.ts packages/agent-ui/src/components/detail-panel-wrapper/library-preview-extension.spec.ts packages/context-viewer-components/src/DetailPanel/browser-preview-override.spec.tsx
pnpm --filter @genie/workbuddy-extensions exec vitest run src/renderer/extension-mount.spec.ts src/renderer/hosts/iframe-host.spec.ts src/runtime/iframe-attachment.spec.ts
pnpm --filter @genie/workbuddy-extensions-builtin test -- src/library-extension.spec.ts
pnpm --filter @genie/agent-ui compile
```

`wb.js` 由 WorkBuddy Core 的 Guest SDK 构建产生；若调用方已明确自行构建，不要擅自修改 Desktop 协议或提交 dist 产物。
