---
name: smart-doc-editor-upgrade
description: |
  覆盖 MindX 智能文档页面与 SmartDoc Editor SDK 的开发/升级：编辑器组件、block 操作、插件、评论、标题栏、workspace/document 路由及 @tencent/smart-doc-* 版本升级。prototype 与 production 都直接维护 apps/mindx。
triggers:
  - 修改 MindX 文档/编辑器页面或路由
  - 修改 apps/mindx 的 doc-editor、文档 hooks、block 操作或插件
  - 使用或升级 @tencent/smart-doc-* 包
  - 用户提到编辑器、文档页面、SmartDoc、block、评论、大纲、插件、标题栏
---

# SmartDoc Editor 集成与升级

## 0. 先判工作模式

执行 `git branch --show-current`：

| 分支/意图                             | 模式           | 修改范围                                                 |
| :------------------------------------ | :------------- | :------------------------------------------------------- |
| `prototype/<issue>-<slug>`            | prototype      | 直接修改 `apps/mindx/**`；Issue AC 是唯一契约            |
| production `feature/**` / `bugfix/**` | implementation | 修改 `apps/mindx/**` 与确有必要的共享包，接真实数据/协同 |
| SDK/依赖升级                          | infrastructure | 扫描实际消费者并修兼容，不建立平行实现                   |

硬规则：

- `apps/mindx` 不得 import 其它 app 源码，也不建立平行实现或同步义务。
- SDK/依赖升级按实际 import 与 package 声明扫描消费者，不维护静态的双应用清单。
- prototype 中的 SDK/依赖改动只是证据，是否进入生产由研发在 fresh main 分支重新评估。

## 1. 知识获取（功能开发前必做）

官方文档基础 URL：`https://smart-doc.pages.woa.com`。

1. 读取 `/llms.txt` 获取当前索引。
2. 首先读取 `/skills/plugins.md`，确认官方是否已有插件。
3. 按索引读取与本需求直接相关的技能文档；首次接入再读 `/llms-full.txt`。
4. 精确类型以当前安装包 `node_modules/.pnpm/**/@tencent/smart-doc-*/dist/*.d.ts` 为准。

不得凭记忆假设 SDK 当前 API；网络不可用时明确标注未校准，不能编造插件或签名。

## 2. SDK 使用硬约束

- 数据修改只通过 `editor.applyOps()`、`editor.setRecords()` 或公开 `commands.*`。
- 禁止直接修改 Record/Block 对象，禁止操作编辑器内部 DOM。
- 禁止访问 `blockStore`、`recordStore` 等非公开内部 API。
- Plugin 只调用公开 commands/API，并遵守其 lifecycle/dispose 约定。
- 编辑器数据继续来自 MindX RecordService；prototype 只能在 transport 层模拟 records/commit，不在编辑器组件里 import fixture。
- prototype 必须禁真实协同 WS，但保留本地编辑与 commit mock；production 必须使用真实协同/commit。
- 先复用已有 doc-editor 封装与公开插件，再考虑新增自定义层。

## 3. 功能开发步骤

1. 把 Issue AC 映射为编辑器可观察行为和测试。
2. 查询官方插件/API，记录采用/不采用理由。
3. 阅读当前 `apps/mindx` 组件、hooks、Record/Block 路径；README 仅作技术导航。
4. 在 `dev-workflow` 对应 mode 下先写失败测试，再实现。
5. prototype：使用 `prototype:dev` 验证真实页面外壳，最终走 `prototype:build/verify`。
6. implementation：验证真实 Record、权限、协同、评论/版本等受影响链路，不带入 prototype runtime。

## 4. @tencent/smart-doc-\* 版本升级

### 4.1 盘点真实依赖

```bash
rg -n '"@tencent/smart-doc-|from "@tencent/smart-doc-|from '\''@tencent/smart-doc-' \
  pnpm-workspace.yaml apps/mindx packages
```

以命令结果为准，不维护“必须三处同步”的静态清单。项目使用 pnpm catalog 时，只在 `pnpm-workspace.yaml` 更新版本，使用方继续保留 `"catalog:"`。

### 4.2 查询与安装

```bash
npm view @tencent/smart-doc-editor version
npm view @tencent/smart-doc-plugin-comment version
```

更新 catalog 后运行 `pnpm install`。禁止用 `pnpm add ...@version` 覆盖使用方的 catalog 占位。

### 4.3 阅读本地 CHANGELOG

远程 llms 文档不是版本日志。安装后用 `find node_modules/.pnpm -path '*smart-doc-*' -name CHANGELOG.md` 定位并读取旧版到新版之间的条目，重点检查：

- breaking API/type/plugin lifecycle；
- 新 Block 与 FeatureConfig；
- theme/token/CSS 变化；
- peer dependency 与 i18n 要求；
- 测试 mock 是否需要更新。

### 4.4 扫描实际调用方

```bash
rg -n '@tencent/smart-doc-' apps/mindx packages \
  -g '*.ts' -g '*.tsx' -g '*.test.ts' -g '*.test.tsx'
```

逐个修复真正受影响的消费者。不要因为路径相似就复制改动，也不要为了保持平行镜像而修改生产实现。

### 4.5 验证

- `pnpm typecheck`
- `pnpm build`
- 受影响包的 lint/test
- production/editor 运行时：加载、输入、格式化、block、标题栏、插件/评论、销毁重建
- prototype 模式额外：验证受影响页面与相关测试；分享时由 `prototype-deploy` 直接从 dirty worktree 构建、打包并覆盖同一 Page，不生成提交或 checkpoint。只有冻结交付时才由 `prototype-handoff` 提交并普通推送最近分享的同一 tree。

## 5. 禁止事项

- 禁止为同一编辑器能力维护平行实现或强制同步流程。
- 禁止从其它 app 复制 editor/page/hooks 到 production。
- 禁止用 prototype fixture 替代生产 Record/schema。
- 禁止在仓库里增加 WorkBuddy 上传逻辑；编辑器原型静态制品沿用 prototype-kit 契约。
- 禁止跳过官方插件查询直接重复造轮子。
