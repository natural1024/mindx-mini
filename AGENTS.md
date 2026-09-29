# Mindx 前端仓库

## 项目简介

Mindx 前端 Monorepo，基于 pnpm Workspaces 管理多包，使用 Rspack 构建，React 18 + TypeScript 技术栈。

## 🚀 开发 + 发布流程速查表

> **真相源**：[`docs/release-workflow.md`](./docs/release-workflow.md)。AI 在 commit / 创建 PR / 发布前必读。

### commit message 必备

- subject 末尾**必须**带 `#<issueid>` 或 `[no-issue]`，否则被 husky / CI 阻塞
- `#<issueid>` 必须真实存在；`#0` / `#000` 已废弃
- 产品/设计师禁用 `[no-issue]`；开发者仅 `chore`/`docs`/`refactor`/`style`/`test`/`build`/`ci`/`perf` 且累计改动全部命中显式工程资产类别时可用
- `revert` 必须绑定真实 `#<issueid>`，不得使用 `[no-issue]`
- 独立闸门：[`.codebuddy/rules/issue-binding-route.mdc`](./.codebuddy/rules/issue-binding-route.mdc)

### 角色 × skill 路由（prototype workflow）

| 角色        | 场景                           | 走的 skill               |
| :---------- | :----------------------------- | :----------------------- |
| 产品/设计师 | 仅建需求、记录想法             | `start-feature`          |
| 产品/设计师 | 改页面、做原型                 | `prototype-workflow`     |
| 产品/设计师 | 分享原型并获取固定链接         | `prototype-deploy`       |
| 产品/设计师 | 冻结原型并交给研发             | `prototype-handoff`      |
| 开发者      | 实现 Issue、参考冻结 prototype | `implement-issue`        |
| 任意        | 提交 / push / 创建生产 PR      | `cmd-publish` 按分支分流 |

产品原型在 AI 管理的 `prototype/<issue>-<slug>` 或 `prototype/draft-<id>-<slug>` worktree 中直接修改 `apps/mindx`；分享从 dirty worktree 生成 package，再委托 WorkBuddy 内置资料库 skill 发布，不 commit/push。只有 Issue-bound 原型冻结交付研发时才提交并普通 push；prototype 永不创建 PR、也不合并。

所有 PR 只能以受保护的 `main` 为 target；仓库 CI 会拒绝其他 target。平台侧仍需配置 CNB branch protection / target restriction，覆盖携带旧 CI 配置的历史目标分支。

### Issue 生命周期：需求池 + 五态状态机

`需求池`是尚未澄清、尚未承诺研发的入口，不计入五态交付主线。需求澄清后可直接进入`待研发`；需要产品原型时，先进入`原型中`，冻结交接后再进入`待研发`。

```text
需求池 → [原型中] → 待研发 → 开发中 → 待发布 → 已发布 + closed
```

- `prototype-handoff` 是 `<原型中> → <待研发>` 的交叉验证门禁，不增加新状态。
- 验收不占用状态：产品、QA 或提单人在 Issue AC、评论和正式交付证据中记录结论；未完成或不通过的验收保持在`开发中`。
- 负责人随状态接力：`需求池`、`原型中`归创建人；`待研发`、`开发中`、`待发布`、`已发布`归对应研发。`待研发`未指定时默认 `leoricxu`；`开发中`不得为空。
- 生产 PR 必须带唯一 `Refs #<id>`、`AC-contract: sha256:<digest>`、`Target-label: 待发布`；可信 CI 会从 Issue 的结构化验收标准重算 digest。合入 `main` 后，流水线以初次读取的 Issue version/ETag 执行标签 `If-Match` CAS，再重新获取并复验 AC、唯一 `<待发布>` 状态与全部非状态标签，最后才写合并证据备注；冲突或漂移一律失败关闭。
- 无 Issue 豁免按**改动性质**而不是 `packages/**` 等顶层目录判定。可信 CI 以 `merge-base..PR head` 的累计 diff 为准，仅放行分类器显式列出的根配置、工程目录（`.agents/`、`.cnb/`、`.codebuddy/`、`.github/`、`.husky/`、`.vibe/`、`docs/`、`scripts/`、`tools/`）、任意位置的 `.md` 文档、`packages/*/.business-frozen.json`，以及 basename 严格匹配 `*.test.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` / `*.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}` 的工程验证代码。PR #1850 的 `packages/ui-components/README.md`、`packages/ui-elements/README.md` 与 `packages/ui-components/.business-frozen.json` 属于允许示例。
- 上述类别不放行整个 `packages/**`、任意 JSON/隐藏文件、宽泛 `test/` 目录或近似测试名。累计 diff 只要在 `apps/mindx/**`、`packages/**/src/**`、根 `src/**` 或其他位置混入未命中明确文档/严格测试类别的业务或运行时代码、未知或非法路径，就失去无 Issue 豁免并 fail closed。
- 被分类器拒绝的累计 diff 必须建 Issue 并走 production route；prototype 永远没有 PR 描述契约。
- 发布后由开发者通知 AI 执行 `changelog` skill（命令 `/changelog`）把 `<待发布>` 推到 `<已发布>` + 智能生成 CHANGELOG.md

---

## 产品背景与业务建模

> 本节信息来源：腾讯文档空间《New空间产品方案》《新版空间规划》等 13 份产品文档（2026-03 ~ 2026-04）。
> AI 在分析需求、编写代码、做命名/建模决策时，必须以本节为产品语义基线，避免将 MindX 当成"通用在线文档"来理解。

### 产品背景

AI 行业正在从 "Chatbot 时代" 过渡到 "通用 Agent 时代"，用户同时使用 WorkBuddy / CodeBuddy / ClaudeCode / OpenClaw / CodeBuddy 等多个 Agent，面临两个核心痛点：

1. **上下文清零**：切换 Agent 后，新 Agent 不认识用户，用户被迫反复交代身份、项目背景、偏好；现有主流模型的上下文窗口仅相当于人类 4–26 天的文字记忆。
2. **资产分散**：每个 Agent 产出的文档、记忆、Skill 散落在各自平台，无法沉淀、无法跨 Agent 复用，也无法让人类集中审阅与治理。

同时观察到：

- 生产力工具的主体正在从"人"迁移到"人 + Agent"，老一代工具只优化了面向人类的体验，对 Agent 不友好。
- 通用 Agent 赛道（Claude / Codex / Gemini 等）竞争极度红海，腾讯文档团队的差异化机会在 **AI-native 工具** 与 **Agent 基建**，而非再造一个通用 Agent。
- 腾讯文档已沉淀的编辑器渲染、多人协作、多格式互转、存储与权限基建，是做这件事的天然长板。

### 产品定位

**MindX 是一个面向 Agent 的文档空间（Agent-native Workspace）**，即"Agent 的云端外挂 / 第二大脑"。

- 对 **Agent**：提供统一的会话记忆库、产物存储、结构化上下文注入与 MCP/Skill 调用通道，解决"每次重头来过"和"输出不符合用户习惯"两类问题。
- 对 **人类**：提供 All-in-One 的数据资产中枢，沉淀跨 Agent 产物、做缺席回顾、用文档做人机异步协作，并确保安全与可审计。

一句话描述："让跨平台 Agent 共用同一个 **会话记忆 + 产物存储 + 人机协作面板**"。

### 项目目标

**短期（当前阶段）**：打磨 MVP，先在部门和公司内成为口碑产品。

**中期**：面向"积极拥抱 AI 的重度用户"（Vibe Coder / 深度 AI 用户 / 多 Agent 协作者）建立差异化心智，实现 Agent 产物"进得来、留得住、找得到、用得好"。

**长期**：从"内容上下文"跃迁到"用户 ID"，成为 AI 时代的用户通行证——三方 Agent 登录时可直接以 MindX 作为身份与上下文来源。

阶段路线图（产品方）：

| 阶段   | 关键能力                                                | 对外定位                    |
| :----- | :------------------------------------------------------ | :-------------------------- |
| 阶段一 | 资产入库 + Skill/MCP 连接器 + 产物即时回流 + 协同编辑   | 让 Agent 产物进得来、留得住 |
| 阶段二 | Soul.md 人设、会话记忆萃取（L0→L1a/L1b→L2）、上下文注入 | 让 Agent 背景零复读         |
| 阶段三 | 语义冲突调和、时序权重、多模态理解、自主上下文编辑器    | 让输出"脱水"为高质量上下文  |
| 长期   | MindX ID + 跨平台登录 + 权限/安全基建                   | AI 时代的用户通行证         |

### 核心业务实体（语义模型）

AI 在做命名、类型建模、API/组件设计时，应对齐以下业务词汇，不要用通用的"文档 / 文件 / 用户"一笔带过。

| 业务实体                  | 英文标识（建议）         | 说明                                                                                                                                                                                                          |
| :------------------------ | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workspace / Space**     | `workspace` / `space`    | 用户的个人空间，是一切资产与协作的容器。一个 Human 拥有一个或多个 Workspace。                                                                                                                                 |
| **Human**                 | `human` / `user`         | 人类用户，通过邮箱验证码 / Google / Facebook 登录，首登走 Onboarding。                                                                                                                                        |
| **Agent**                 | `agent`                  | 平台的"一等公民"，与 Human 平级。通过 Token 接入外部 AI 工具（WorkBuddy / ClaudeCode / OpenClaw 等）。Agent 拥有头像、连接状态、已安装 Skills、动态记录，可作为文档创建者、编辑者、评论者。                   |
| **Skill**                 | `skill`                  | Agent 的能力扩展单元（类似插件），通过 zip 包 + 安装命令分发。典型如 MindX Docs（create / edit / save / read）、Data Analysis、Search Engine。Skill 在 MindX 侧有统一定义，在外部 Agent 内落地执行。          |
| **Document（文档/页面）** | `smartDoc`               | MindX 主力文档格式，基于腾讯文档智能文档编辑器，支持 Agent + Human 实时协同编辑，带版本历史与评论。MVP 编辑器仅上线此品类。                                                                                   |
| **RawData / 数据源**      | `dataSource` / `rawData` | 进入 MindX 的原始素材（文档 / 网页剪藏 / 会议转写 / 录音 / 图片等），是会话记忆的信源。内容类型枚举 15 种，来源枚举 3 种，状态枚举 7 种（抓取中 / 抓取失败 / 待萃取 / 萃取中 / 已萃取 / 萃取失败 / 未指定）。 |
| **Soul.md**               | `soul`                   | 用户人设文档，显式描述身份、偏好、不要的事、关注领域，是萃取与注入的"锚点"。                                                                                                                                  |
| **会话记忆（Memory）**    | `memory`                 | 从 RawData 中萃取、调和后的结构化记忆，采用 L0（标准化存档）→ L1a（单文档原子事实）/ L1b（多文档跨源调和）→ L2（更新 / 合并 / 废弃 / 置顶）三层架构。                                                         |
| **洞察卡片（Insight）**   | `insight`                | L2 产出的"for 人"形态：洞察内容 + 价值摘要 + 分类标签 + 置信度 + 溯源。支持置顶、编辑、废弃。                                                                                                                 |
| **Activity / 动态**       | `activity`               | 按时间倒序、按人/Agent 维度聚合的变更事件流（创建 / 修改 / 评论 / Agent 绑定等），是人类感知"Agent 帮我做了什么"的主入口。                                                                                    |
| **Share / Permission**    | `share` / `permission`   | 协作成员（Human + Agent）与链接级权限（仅邀请 / 可查看 / 可编辑），Agent 默认拥有本空间编辑权限。                                                                                                             |

### 当前产品阶段

**阶段判定：阶段一 MVP 收口 → 阶段二启动**（截至 2026 年 4 月）。

进行中（MVP v1.0，对应前端已实现 / 正在接入后端）：

- **登录**：邮箱验证码 + Google/Facebook OAuth + 快捷登录，登录态 localStorage 持久化。
- **Onboarding**：4 步向导（欢迎 / 命名 Agent / 连接 Agent / 就绪）+ 欢迎文档 + 快速上手卡片。
- **Dashboard**：文档 Tab（列表 + 场景筛选 + 未读提醒 + 缺席摘要）、动态 Tab（按天分组 + 成员筛选）、Agent Tab（列表 / 搜索 / 新建 / 详情 / Token 管理 / Skills 视图 / 删除确认）、Skills Tab（列表 + 详情展开 + 3 步安装）。
- **智能文档编辑器（MVP）**：复用智能文档内核；支持 Human + Agent 实时协作、协作侧边栏、版本历史、评论。
- **Skill / MCP 连接器**：`/connect_mindx`、`/save_to_mindx`、`/create_mindxdoc` 等 P0 Skill，支持外部 Agent 通过 Token 握手与产物回流。
- **萃取链路（初版）**：L0/L1a/L1b/L2 Skill 已做到 V2 版评测——多文档召回率 ~95.9%、精确率 ~98.7%、幻觉率近零。

正在进行 / 规划中：

- Agent 记忆**消费端**：双格式产出（Insight + MCB）、三层注入（Tier1/2/3）、记忆可执行化（软提示 / 硬规则 / 自动行为）、效果闭环验证。
- 数据源能力扩展：网页剪藏、腾讯文档导入、语音速记、第三方录音接入。
- 萃取优化：信息密度自适应、跨文档调和、粒度规则、用户画像隐式生长。
- Agent 权限精细化、批量操作、Skill 市场化扩展。

**不在当前范围（明确排除）**：通用 Agent 对话能力、手机号登录、2FA/SSO、Skill 自动卸载、第三方 Skill 审核、Agent 间直接通信。

### AI 编码时的关键语义约束

1. **Agent 是一等公民**：所有"创建者 / 协作者 / 权限主体"相关模型都必须同时支持 Human 和 Agent 两种身份，不要默认只有人类。
2. **Workspace 是边界**：资产 / 动态 / 权限 / 记忆都以 Workspace 为聚合根，跨 Workspace 的能力目前不做。
3. **文档 ≠ 纯文本**：智能文档具备实时协同、版本、评论、Agent 可读写，避免用简单 Markdown 模型去建模。
4. **Memory ≠ Context**：Memory 是持久化的跨会话记忆库（图书馆），Context 是单次对话注入的子集（借出的几本书）；不要混用字段名。
5. **Skill 是分发制品**：MindX 定义 Skill，Agent 端执行 Skill，二者通过 MCP 协议衔接；Skill 的安装在外部 Agent 内完成，不要试图在 MindX 前端做"在线安装"。
6. **Agent-friendly 优先**：所有新接口 / 新能力设计时，先考虑是否对 Agent 友好（可通过 MCP/Skill 调用、结构化、可溯源），再考虑人类视觉体验。

## 工作区结构

```
mindx/
├── src/                  # 主应用入口
├── packages/             # 公共库包（发布产物）
│   └── example-pkg/      # 示例库包
├── apps/                 # 业务应用包
├── tools/                # 工具链包（不发布）
│   ├── build-config/     # Rspack 构建配置封装
│   ├── eslint-config/    # ESLint 共享配置
│   └── script/           # CI/CD 辅助脚本
└── dist/                 # 主应用构建产物
```

## 常用命令

```bash
pnpm install              # 安装所有依赖
pnpm build                # 构建全部库包（tools → packages）
pnpm dev                  # 启动主应用开发服务器
pnpm prototype:scaffold   # 在 prototype 分支生成 branch-local runtime
pnpm prototype:dev        # 本地启动可执行原型
pnpm prototype:build      # 生成静态 site + manifest（不上传）
pnpm prototype:package    # 把已验证 site 压缩为根目录含 index.html 的 ZIP
pnpm dist                 # 生产环境构建主应用
pnpm test                 # 运行全部测试
pnpm lint                 # ESLint 代码检查
pnpm typecheck            # TypeScript 类型检查
pnpm clean                # 清理所有构建产物
```

## 技术栈

- **运行时**：Node.js >= 20、pnpm >= 9
- **框架**：React 18，@tencent/smartcanvas-lib
- **语言**：TypeScript 5（strict 模式）
- **构建器**：Rspack 1.x（基于 `@mindx/build-config` 封装）
- **测试**：Vitest 2 + jsdom + React Testing Library (RTL)
- **代码规范**：ESLint 9 + Prettier

## 项目开发模式

本项目采用 Issue-first、executable-evidence 的产研协作模式，角色为**前端开发者**与**产品经理/设计师**。完整流程见 [`docs/prototype-workflow.md`](./docs/prototype-workflow.md)。

### 目录与分支角色

| 范围                                      | 定位               | 说明                                             |
| :---------------------------------------- | :----------------- | :----------------------------------------------- |
| Issue 验收标准                            | **唯一业务契约**   | 用稳定 `AC-1`、`AC-2`… 描述可验收行为            |
| `prototype/**` + `apps/mindx`             | **可执行设计证据** | AI 从最新 main 建独立 worktree，产品直接探索页面 |
| `feature/**` / `bugfix/**` + `apps/mindx` | **生产实现**       | 研发从最新 main 独立创建分支并接真实数据/接口    |
| `packages/core-data`                      | 业务实体真相源     | 研发维护；prototype 只 mock transport，不改模型  |
| `packages/ui-components`                  | 业务无关 UI 底座   | 共享；继续遵守原子组件准入                       |

### Prototype 交付不变量

- 原型始终在 AI 管理的独立 worktree 中；主工作区的分支、文件与 dirty 状态不得被修改、切换、reset、clean 或删除。
- 原型身份使用稳定 `deploymentKey`：Issue-bound 为 `issue:<issueId>`，draft 为 `draft:<draftId>`。同一身份分享时携带既有 `pageId` / `nodeBlockId` 覆盖同一 WorkBuddy Page。
- `draft` 草稿与 issue-bound Issue 原型共用 `ACTIVE_LIMIT=3` 三个运行槽；只有 `starting` 与 `active` 占槽。准备可并发创建受管 worktree；启动前在锁内重查容量，满额时保留 `worktree_ready` 且不 spawn 第四个 service。暂停保留同一 worktree 并释放端口与运行槽。
- 已给出 Issue 的开始操作直接复用并校验该 Issue；没有 Issue 时进入 local draft 草稿，不创建 Issue，也不读取或校验 Issue。Workbench 分配 `draft:<draftId>` 后才创建 worktree、准备并启动服务。
- draft 支持开始、暂停、继续、分享和显式丢弃；丢弃只清理受管本地 worktree，不访问 Issue，停止或删除无法确认时保留状态。draft 不得直接冻结或 handoff；必须先 promote 到 open、唯一`原型中`且含结构化 AC 的真实 Issue，保留 worktree、迁移 runtime identity，并重新分享。
- active 或 paused 都可以分享；Issue-bound 原型也可从两种状态冻结。冻结先校验当前 tree 等于最近分享的 `sourceTreeSha`，再幂等 commit/普通 push；漂移必须重新分享。随后把最小 Page/package 回执、checkpoint 与 remote 证据写回 Issue、转为`待研发`并清理该 worktree。
- 分享绝不 commit/push；冻结绝不建 PR、打 tag 或合并。研发从最新 `main` 独立实现，以 Issue 为契约、以 Page 与已推送分支为参考；不得 merge 或整分支 cherry-pick 原型代码。
- 分享按 `share-prepare → WorkBuddy 内置资料库 skill → share-complete/share-reject` 编排。Node/Workbench 与 lifecycle host adapter 都不发现或执行内置 skill；Issue-bound 路径 CAS 覆盖并复验唯一 `## 原型发布` 区块，draft 跳过 Issue。最小回执只含稳定 Page/node/URL 与 package identity；外部一步导入不承诺失败后原子回退。仓库不保存 WorkBuddy 上传凭据。

### Page 内部结构 + 禁止跨 page 引用（P0 硬规则）

> 完整规范：[docs/page-internal-structure.md](./docs/page-internal-structure.md)（仅适用于 `apps/mindx`）

**核心规则**：

1. **新增的 page 私有 hook / 业务组件 / parser**，**必须**放到该 page 自己的目录下：
   ```
   apps/mindx/src/pages/<xxx-page>/
     - index.ts               # 必须 · 对外唯一出口
     - pc.tsx / pc.less
     - README.md              # 可选 · 仅技术导航，不承载需求契约
     - hooks/                 # page 私有 hooks
     - components/            # page 私有业务组件
     - parsers/               # page 私有语义映射（可选）
   ```
2. **公共目录**（跨 page 复用 / 存量未拆分）继续放在 `apps/mindx/src/{hooks|components|parsers|utils}/`，目录骨架与现状一致
3. ⛔ **禁止跨 page 引用任何文件**（含 hook / 组件 / parser / 类型定义）。一旦发现 page A 想用 page B 的内容 → 必须先把可复用部分**物理搬到**公共目录，再两侧从公共目录 import
4. **page 对外唯一出口是 `index.ts`**，外部不允许跨过它直达 `pc.tsx` 或子目录
5. Page README 是可选技术导航，不要求固定 schema、与 `@region` 集合一致或 staleness 扫描；Issue AC 是唯一业务契约

兜底：ESLint `no-restricted-imports` + code-review-agent `cross-page-import` 类别双层 P0 阻塞。

### 相关 Skills

| Skill                | 用途                                  | 触发角色    |
| :------------------- | :------------------------------------ | :---------- |
| `prototype-workflow` | 开始、暂停、继续原型                  | 产品/设计师 |
| `prototype-deploy`   | 分享当前原型到同一 WorkBuddy Page     | 产品/设计师 |
| `prototype-handoff`  | 冻结原型、写回交接并清理本地 worktree | 产品/设计师 |
| `implement-issue`    | 最新 main 上创建生产分支并独立实现    | 开发者      |
| `ui-development`     | 页面与 UI 组件开发规范                | 全角色      |
| `cmd-publish`        | 生产分支提交、push 与 PR 的统一出口   | 开发者      |
| `dev-workflow`       | 分档 → Code/Review/Test Agent         | 全角色      |

## 开发规范

### 测试驱动开发（TDD）

项目采用 TDD 方式开发，即先写测试用例，再写代码。测试用例规范参考：`./docs/unit-test-spec.md`

### 编码规范

(编码规范)[./docs/coding-spec.md]：文件命名、 编码规范等

### Agent Team 协作基建（dev-workflow）

任何代码修改在落笔前都会先过 `dev-workflow` skill 的分档闸门（L1/L2/L3），由主会话派发 Code/Review/Test 三个专精 Agent 协作完成。L2/L3 收尾后自动进入 Polish 窗口（轻量改动通道）。详见 [Agent Team 协作基建](./docs/agent-team-spec.md)。

### 错误上报与监控（reporter）

> 完整规范：[`packages/reporter/README.md`](./packages/reporter/README.md)。
> 错误码枚举的真相源：[`packages/reporter/src/error-codes.ts`](./packages/reporter/src/error-codes.ts)。

当用户要求加上报 / 监控 / 告警，或 AI 改动时遇到 `reporter.report*`、接口错误处理、核心链路请求等上报相关代码，必须先阅读 `packages/reporter/README.md`，再按其中的字段规范、错误码约定和 AI Checklist 执行。

`AGENTS.md` 只保留入口路由；具体接入范式、禁止事项、接口报错 `shouldReport` 用法、告警规则模板统一维护在 reporter README 中，避免两处规则漂移。

### 新增子包

1. 在 `packages/`（库）或 `apps/`（应用）下创建目录
2. `package.json` 的 `name` 统一使用 `@mindx/<包名>` 前缀
3. 复用 `@mindx/build-config` 中的 Rspack 配置
4. 复用 `@mindx/eslint-config` 作为 ESLint 基础配置

### TypeScript

- 所有包继承 `tsconfig.base.json`，不得关闭 `strict` 模式
- 库包需额外维护 `tsconfig.build.json` 用于生成类型声明文件

### 测试

- 测试文件命名：`*.test.ts` / `*.test.tsx`
- 测试环境：jsdom（浏览器模拟）
- 覆盖率提供者：v8

参考：[单元测试规范](./docs/unit-test-spec.md)

### 构建产物（库包）

- 同时输出 ESM（`.mjs`）和 CJS（`.cjs`）格式
- 类型声明文件（`.d.ts`）通过 `tsc -p tsconfig.build.json` 单独生成
- 仅发布 `dist/` 目录

## CI/CD

使用 CNB（`.cnb.yml`），发布流水线位于 `.ci/mindx-release.yml`，构建按 `tools → packages → apps` 顺序执行。公共工程校验脚本位于 `scripts/workflow/`。
