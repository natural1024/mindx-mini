# mindx-mini

> mindx 仓库的「剔肉还壳」精简骨架：保留 AI 约束、CI/研发规范与构建脚手架，仅内置一个 React Hello World 入口，作为新业务从零起步的模板。

## 目录概览

```
apps/hello/            React 18 + Rspack 入口（唯一业务示例）
packages/              空占位，业务包按需新增
tools/build-config/    共享 Rspack 构建配置
tools/eslint-config/   共享 ESLint 规则
tools/stylelint-*/     设计系统守门 Stylelint 规则
scripts/workflow/      CNB CI 校验脚本（Issue/PR/分支契约等）
docs/                  研发规范、流程文档（*-spec.md）
.ci/ .cnb/ .cnb.yml    CNB 流水线配置
.husky/                Git 钩子
.codebuddy/ .claude/   AI 上下文、agent、规则、skills
.vibe/                 分支路由 / 开发者白名单
AGENTS.md              AI 协作根规范（CLAUDE.md / CODEBUDDY.md 软链于此）
```

## 快速开始

```bash
pnpm install          # 安装依赖 + postinstall 同步工程 skills
pnpm dev              # 启动 apps/hello 开发服务器（默认 :3000）
pnpm build            # nx 全量 build（tools → apps）
pnpm dist             # 打 apps/hello 生产产物到 apps/hello/dist
pnpm lint             # 全仓 ESLint
pnpm typecheck        # 全仓 tsc --noEmit
pnpm test:workflow    # 跑 CI 校验脚本的单元测试
```

## 从这里起步

1. 保留本仓所有 `docs/*.md`、`scripts/workflow/`、`.husky/`、`commitlint.config.cjs`、`.cnb.yml` 作为研发规范单一事实源。
2. 在 `apps/` 或 `packages/` 下新增你的业务包，`pnpm-workspace.yaml` 会自动纳管。
3. 提交前遵循 `docs/git-spec.md` + `commitlint.config.cjs`：subject 末尾必须以 `#<issueid>` 或 `[no-issue]` 结尾。
4. 更多 AI/研发协作细节见 `AGENTS.md`。
