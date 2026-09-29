# WorkBuddy Host API And Type Sync

本文说明标准 `window.wb` 的运行时边界、MindX 调用方式，以及 Genie 与 MindX 的类型同步。路径均相对各自仓库根目录。

## 运行时边界

| MindX 运行形态              | 当前窗口 `window.wb`                        | 调用路径                                                   |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| WorkBuddy Federation 主入口 | 宿主在同 realm 注入                         | 业务 → `workbuddyHost` 薄 Facade → 当前 `window.wb.*`      |
| 对话区资料库标准 iframe     | 页面加载固定 wb.js；`window.wbReady` 后存在 | 业务 → 同一 `workbuddyHost` 薄 Facade → 当前 `window.wb.*` |
| 旧 Desktop iframe           | 不使用标准 wb Guest SDK                     | 冻结的旧 `SpaceSdk` 兼容链路                               |
| 普通独立站                  | 不应使用宿主能力                            | `standalone`，Facade 报 `HOST_UNAVAILABLE`                 |

Federation 和标准 iframe 在业务层只有一个 `standard` 运行时，不得按载体分叉。标准 iframe 必须加载 `https://www.workbuddy.cn/wb.js` 并等待当前窗口 `window.wbReady`；禁止读取 `window.parent.wb`。

MindX 可以用 `apps/mindx/src/workbuddy-host/host-api.ts` 维持最小类型化入口，但它只做当前窗口 `window.wb` 的直接委托。不要引入 Transport registry、动态 target/path、资料库专用 postMessage、协议副本或 URL marker。

`wb` 的方法契约一律是 Promise。即使 Federation 同 realm 的实现可以立即得到结果，公开类型和 MindX 最小镜像仍写成异步方法；否则同一调用在标准 iframe Guest Proxy 下会返回 Promise，却被调用方当同步值消费并留下未处理 rejection。

## 标准 iframe 的宿主链路

1. Genie `detail-panel-wrapper` 在与 `wb-extension://` 相同的消费边界校验精确生产 origin `https://www.workbuddy.cn` 和 `/space` 路径；其他 URL 留在原 BrowserPreview。
2. 消费点匹配 library manifest 的 `artifactPreviews` contribution，以 `contribution.data.artifact` 传递已标准化文档 URL，并用 `ExtensionMount` 替换整个 BrowserPreview，因此不会创建浏览器地址栏。
3. Mount 按 contribution id 从 manifest 取得静态 `https://www.workbuddy.cn/space/extension-preview`，把 artifact 机械追加为 query，再按消费点明确的 iframe 容器分流；Mount 不接受动态加载 URL，也不包含资料库 URL hardcode。
4. Mount 从 registry summary 取得可信 builtin kind，内部 Host 构造 subject：`moduleId=library`、`type=extension`、`kind=builtin`，并通过通用 `attachIframe` 转移 MessagePort。
5. MindX preview entry 只接受精确生产 origin 的 `/space` artifact，跳转到 basename 内真实文档路由；随后请求固定 wb.js URL。Desktop 拦截该请求并返回本地 Guest bundle；不要把 404 CDN 响应当作生产链路预期。
6. wb.js 在当前 iframe window 建立 `window.wb` 与 `window.wbReady`。MindX 等待 ready 后进入 `standard` 运行时。
7. URL 切换或页签关闭/宿主卸载由 React Host 生命周期 dispose attachment，关闭 port/订阅；普通视图切换沿用 DetailPanel 的 keep-alive 显隐语义。

资料库 iframe 内容不能通过 URL、query、postMessage 或返回数据改变 subject。`libraryHostApi`、`host-bridge.ts`、资料库协议副本和 `library-iframe-wrapper` 都不属于标准方案。

## Genie 代码位置

### SDK 契约与类型

| 路径                                                            | 职责                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| `packages/workbuddy-core/src/wb/core/types.ts`                  | `WorkbuddySDK` 总契约及核心 SDK 类型入口 |
| `packages/workbuddy-core/src/wb/namespaces/*.ts`                | 平台 namespace 契约                      |
| `packages/workbuddy-core/src/domains/<domain>/common/facade.ts` | 业务 domain Facade 契约真相源            |
| `packages/workbuddy-core/src/domains/<domain>/wb/index.ts`      | 将 domain 能力挂到 `wb.<domain>`         |
| `packages/workbuddy-core/src/wb/README.md`                      | `wb.*` 使用、开发、错误码与生成说明      |
| `packages/workbuddy-core/types/wb-global.d.ts`                  | 生成的包外全局类型，禁止手改             |
| `packages/workbuddy-core/src/wb/core/wb-global.d.ts`            | 生成的包内全局类型，禁止手改             |
| `scripts/gen-sdk-dts.ts`                                        | 全局 SDK 类型生成脚本                    |

修改公开 `wb.*` 契约时改源定义，再按 Genie 当前脚本运行生成器；禁止手改生成文件。

### 运行时提供与标准 iframe

| 路径                                                               | 职责                                           |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| `packages/agent-ui/src/app-core/index.ts`                          | WorkBuddy renderer 初始化全局 `wb`             |
| `packages/agent-ui/src/router/extension-mount.tsx`                 | Extension/Federation 装配                      |
| `packages/workbuddy-extensions/src/renderer/hosts/iframe-host.tsx` | 通用 iframe Host、可信 subject 与生命周期      |
| `packages/workbuddy-extensions/src/runtime/iframe-attachment.ts`   | 通用 Guest attach/MessagePort 协议             |
| `packages/workbuddy-core/src/guest/**`                             | wb.js Guest SDK 源码                           |
| `apps/workbuddy-desktop/src/main/window/wb-guest-protocol.ts`      | 固定 wb.js URL 的本地拦截与 bundle 返回        |
| `packages/workbuddy-server/src/hub/extensions.ts`                  | `wb.extensions.*` 的 daemon 装配与 invoke 路径 |

通用 extension iframe 协议只由 Genie 基建维护。资料库业务不得复制该协议，也不得增加专用 handler。

## MindX 代码位置

| 路径                                                               | 职责                                              |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| `apps/mindx/src/workbuddy-host/workbuddy-global.d.ts`              | MindX 实际消费的最小 `WorkBuddy.SDK` 镜像         |
| `apps/mindx/src/workbuddy-host/load-workbuddy-guest-sdk.ts`        | 幂等加载 wb.js 并等待 `window.wbReady`            |
| `apps/mindx/src/workbuddy-host/runtime.ts`                         | 一次性解析 standard / legacy / standalone         |
| `apps/mindx/src/workbuddy-host/host-api.ts`                        | 当前窗口 `window.wb` 的薄类型化 Facade            |
| `apps/mindx/src/workbuddy-host/library-artifact-preview-route.tsx` | 标准 iframe manifest 入口及可信 artifact 路由转换 |
| `apps/mindx/test/workbuddy-host/**`                                | loader、竞速、直接调用与旧兼容测试                |

MindX 不复制 Genie 整份生成类型，只镜像实际消费的最小表面。

## 通用 renderer namespace 的标准注册

当能力属于跨业务通用平台能力、实现依赖 renderer 状态，并且 Federation 与所有标准 iframe Guest 都应可调用时，使用 `packages/agent-ui/src/app-core/wb-provider/` 的约定式注册：

1. 在 `wb-provider/types.ts` 的源契约中声明 namespace 和 Promise 方法，并把 namespace 加入 `ProvidableNamespaces` / `WorkbuddySDK` augmentation。公开 Core namespace 则修改 Core 真相源并运行生成器；禁止手改生成声明。
2. 新建独立 `<namespace>.provide.ts`，导出 `SdkProviderModule<'<namespace>'>`：`name` 对应 namespace，`phase` 选择实际初始化阶段，`create()` 返回实现，跨 realm 能力必须声明 `exposeToGuest: true`。
3. 在 `wb-provider/index.ts` 的 `PROVIDERS` 登记 provider。现有注册器会执行 `$provide(name, impl)`，随后按 `exposeToGuest` 调 `expose(name, impl)`：前者供同 realm Federation，后者让 iframe Guest 的 `wb:<namespace>:<method>` 命中 renderer 实现。
4. Web/Desktop entry 只调用统一的 `registerRendererSdkProviders(sdk)`，不得为单个 namespace 散点 `$provide`、`expose` 或传递专用注册参数；`initAppCore` 只持有 SDK 与更新运行状态，不用 `defineProperty` 临时挂 namespace。
5. 测试同时断言 provider 被 `$provide`、被 `exposeToGuest`，以及 `createForwardMethodChannel` 收到对应 Guest channel 时不调用 daemon fallback。

示例：

```ts
export const provider: SdkProviderModule<"env"> = {
  name: "env",
  phase: "renderer",
  exposeToGuest: true,
  create: () => ({
    async deployment() {
      return currentDeployment();
    },
  }),
};
```

不要为 `wb:<namespace>:<method>` 在 daemon 增加空壳 handler来掩盖 renderer provider 漏注册，也不要建立资料库专用 iframe Bridge。

## 单个 ExtensionMount 的业务 namespace

只与当前产物、当前预览 tab 或当前挂载上下文绑定的方法，不应进入全局 `wb` provider。由消费点通过 `<ExtensionMount exposes={...}>` 注入实例能力：

```tsx
const exposes = useMemo(
  () => ({
    preview: {
      async setTitle(title: string) {
        updateCurrentPreviewTitle(title);
      },
    },
  }),
  [updateCurrentPreviewTitle],
);

<ExtensionMount
  extensionId="library"
  container="iframe"
  contribution={contribution}
  exposes={exposes}
/>;
```

- 分派优先级是：实例 `exposes` → 全局 `exposeToGuest` registry → daemon IPC。
- `exposes` 对象引用必须稳定；每次 render 创建新对象会重建 method channel 并触发 iframe re-attach。
- 注册入口是 `exposes` prop，不存在需要业务方调用的公开 `ExtensionMount.dispose()`。URL、props 变化或组件卸载时，内部 `ExtensionIframeHost` effect cleanup 会调用 attachment `dispose()`，关闭 port、释放 bridge host，并让该实例能力不可达。
- 不依赖挂载实例但属于 library extension service 的业务方法继续走 `wb.extensions.invoke('library', method, params)`；只有真正跨业务的平台能力才提升为全局 namespace。

## 三类同步流程

| 场景                                   | Genie 类型改动                             | MindX 类型改动                            | 标准 iframe Host 改动 |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------- | --------------------- |
| 复用已有 `wb.*`                        | 无；核对源契约与 provider/expose           | 同步 Promise 最小镜像与 Facade            | 无                    |
| 新增公共 `wb.*`                        | 修改源契约/实现并运行生成器或标准 provider | 同步 Promise 最小镜像与 Facade            | 无                    |
| 新增 `library` extension server method | 不改公开 SDK；修改 extension method/DTO    | 继续用 `extensions.invoke<T>()`，同步 DTO | 无                    |

### 复用或新增公共 `wb.*`

1. 在 Genie 源契约确认 owner 和签名；只有跨业务平台能力才进入公开 `wb.*`。
2. 若新增能力，修改 Genie 源契约/实现并运行类型生成器，覆盖 Web/Desktop/Headless 所需装配。
3. 在 MindX `workbuddy-global.d.ts` 增加实际消费的最小签名。
4. 在 `host-api.ts` 直接调用 `getCurrentWorkBuddy().<namespace>.<method>()`，或在局部业务中使用等价的当前窗口类型化调用。
5. 测试 Federation/标准 iframe 共用同一 `standard` 行为，以及旧/standalone 不误用当前窗口 wb。

不得为新方法修改资料库 iframe Host、增加 postMessage switch，或回填旧 SpaceSdk handler。

### 新增 `library` extension server method

1. 在 Genie Library builtin extension 的 server 目录定义 method、DTO 与实现，并登记 service、process policy、权限和构建。
2. 调用方使用既有 `wb.extensions.invoke("library", method, params)`。
3. MindX 保留通用 `extensions.invoke<T>()`，只同步可序列化 DTO。
4. 两仓分别用契约测试覆盖 method、参数、返回值和错误。

无需且禁止修改标准 iframe 协议。

## 验证清单

- Genie 源契约、实现和生成类型一致；生成文件没有手改。
- `detail-panel-wrapper` 对资料库 URL 选择 manifest contribution 并替换整个 BrowserPreview；`ExtensionMount` 从 manifest 取 preview URL 并选择 iframe，内部 `ExtensionIframeHost` 的 library subject 完全由宿主 registry 可信注入，permission registry 使用相同 `moduleId/kind`。
- MindX 标准 iframe 只加载固定 wb.js URL，并等待当前窗口 `wbReady`；没有读取 `parent.wb`。
- Federation 与标准 iframe 均进入 `standard`，业务调用不区分载体。
- `library-iframe-wrapper`、`libraryHostApi`、资料库专用 Bridge/wire protocol 零生产引用。
- 旧客户端仍可由 SpaceSdk HostReady 快速锁定，且没有新增或扩展旧协议。
- URL 切换、隐藏、卸载后通用 Host attachment/port/subscription 被清理。
