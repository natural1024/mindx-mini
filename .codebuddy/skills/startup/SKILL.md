---
name: startup
description: 当用户要求在本地启动、运行或重启 MindX 时使用，包括 prototype 分支和生产开发。
---

# 启动流程

## 零步：先识别产品原型

如果产品经理/设计师说“启动原型”“运行原型”“继续原型”，或上下文是产品原型，**立即**加载 `prototype-workflow` 并停止本 skill。

不得在当前工作区运行 Git 身份检查、`pnpm install`、`pnpm build`、`pnpm dev` 或任何清理动作。`prototype-workflow` 只会在它管理的独立 worktree 中按需准备环境和启动服务，主工作区保持不变。

## 第一步：检查用户本地是否安装了 NodeJS(v20 及以上)

如果没有安装，则自动帮用户安装 fnm，并将 NodeJS v25 设置为默认版本。

## 第二步：检查并配置 Git 身份

运行 `git config user.name` 和 `git config user.email` 检查是否已配置。

如果**未配置**，则：

1. 询问用户的姓名（中英文均可）和邮箱
2. 自动执行 `git config user.name "xxx"` 和 `git config user.email "xxx"` 完成配置（仅项目级别，不影响全局）
3. 如果用户嫌麻烦不想填，可以使用默认值：`name: "MindX Designer"`, `email: "designer@mindx.ai"`

如果**已配置**，跳过此步骤。

## 第三步：在项目根目录下运行 pnpm install，确保依赖最新

## 第四步：运行 pnpm build，确保本地 packages 已构建

## 第五步：开发者启动模式

先执行 `git branch --show-current`：

1. **开发者明确要求运行已有 prototype worktree**：只在该 prototype worktree 中确认配置后运行：

   ```bash
   pnpm prototype:dev
   ```

   使用命令报告的 origin，**默认访问带 WorkBuddy 壳子的 `/space/shell`**（生产环境即嵌在 WorkBuddy 内，壳子是默认形态）；本地模式必须是 `BrowserRouter`。不要硬编码端口，也不要改用其它应用的启动命令。输出：

   ```text
   [MindXRoute] route=prototype-dev status=RUNNING branch=<branch> path=/space/shell
   ```

   配置缺失时停止并加载 `prototype-workflow`。不要在主工作区补脚手架。

2. **非 prototype 分支的开发者**：启动终端命令行窗口并运行 `pnpm dev`。

## 第六步：提示用户

将实际命令输出的地址返回给用户并提示访问。产品要分享原型时，转 `prototype-deploy`；它直接更新当前原型 worktree 的 WorkBuddy Page。

# 重新启动流程

当用户要求"重新启动项目"时，关闭运行中的 dev 进程，从启动流程的**第二步**开始重新执行。
