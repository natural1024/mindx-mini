---
name: cicd-cross-repo
description: |
  跨 MindX（资料库）、Genie（WorkBuddy/CodeBuddy）、genie-secret、secret 四仓定位
  CI/CD 代码与配置，梳理构建、制品、Helm、智研 QCI 和网关发布链路，排查失败或新增配置。
  当用户提到 CICD、CI/CD、CI CD、资料库部署、发布流、发布流水线、helm 配置、
  智研平台、智研流水线、QCI，且需要理解或调整项目构建部署时使用。
  原型分享仍走 prototype-deploy；仅提交代码或生成 changelog 使用对应发布技能。
metadata:
  short-description: 四仓 CI/CD 导航、资料库部署与 Helm/智研配置
---

# 跨仓 CI/CD

目标是快速回答“由谁触发、在哪构建、产物是什么、配置在哪里、谁把它部署到哪个环境”，并在用户要求修改时补齐整条调用链。

## 仓库与检索起点

| 用户称呼                      | 本地默认位置（相对 MindX 根目录） | 职责                                                      |
| ----------------------------- | --------------------------------- | --------------------------------------------------------- |
| MindX / 资料库                | `.`                               | 前端与 Node Web Server、CNB 构建、COS/CDN、资料库运行镜像 |
| Genie / WorkBuddy / CodeBuddy | `../genie`                        | 产品大仓、CNB 编排、Helm Chart 模板、APISIX、智研调用入口 |
| genie-secret                  | `../genie-secret`                 | 按环境覆盖的 Helm values、业务配置、独立发布开关          |
| secret                        | `../secret`                       | CNB imports 凭据与使用范围、TCR/COS/智研认证、kubeconfig  |

不要混淆远端 `genie/secret` 与 `genie-secret/genie-secret`。Genie 侧资料库模块叫 `library`，镜像/Chart/Service 叫 `library-frontend`，values 内部键叫 `libraryFrontend`；历史路由名还可能叫 `tdocs-mindx`。

先确认四仓存在、当前分支、HEAD、dirty 状态及适用的 `AGENTS.md` / `CODEBUDDY.md`。本地分支内容不等于 main，更不等于线上。若当前是受管 worktree，用 `git worktree list --porcelain` 找到原始 MindX checkout，再在其平级目录找另外三仓；不要把 worktree 父目录当作项目集合根目录。缺仓时先继续可查部分，明确缺失证据，不自行猜配置或切换已有 checkout。

从已确认的 MindX 根目录开始，只列文件名来缩小范围：

```bash
git status --short
git branch --show-current
git rev-parse HEAD
rg --files --hidden -g '!.git' -g '!node_modules' .ci scripts/deploy apps/mindx-webserver
rg --files --hidden -g '!.git' -g '!node_modules' ../genie/.ci ../genie/.cnb
rg --files ../genie/deploy/kubernetes/helm/copilot/charts/library-frontend
rg -l 'library-frontend|libraryFrontend' ../genie-secret/kubernetes
rg --files ../secret
```

命令参数中的目录先确认存在；`rg` 无命中和目录不存在要分开处理。不要从四仓根目录一次性输出所有 `values.yaml` 或凭据文件。

## 按任务读取

- **理解流程、找配置、排查发布**：读 [references/repository-map.md](references/repository-map.md)，再沿本次涉及的链路定点读源码。
- **新增/修改 CI、部署环境或 Helm 配置**：先用流程地图确定归属，再读 [references/change-guide.md](references/change-guide.md)。
- **CNB 语法或构建记录**：若当前环境提供 `cnb-pipeline` / `cnb-api`，按需加载；没有时使用仓库配置和平台官方文档，不假设个人目录中的工具存在。
- **历史 Orange-CI**：只在目标分支或构建记录确实使用 `.orange-ci.yml` 时查 OCI；不要因 `oci/scripts/` 目录存在就判断仍由 OCI 发布。
- **资料库已部署但客户端不展示**：在发布证据正确后，再转 `library-federation-develpment` 排查 manifest、remote entry、Host 接入。

## 执行方式

1. 从用户意图和现有上下文确定模块、环境/地域、分支或构建号，以及本次是查询、修改还是执行发布。能从配置推断的先查，不为每个字段提问。
2. 从根 `.cnb.yml` 沿 `include → 分支/事件 → stage/reference → script → artifact` 追踪；部署端继续追到 `Chart → 环境 values → 平台参数/覆盖 → release/namespace → 路由`。仅找到一个文件不能证明它被调用。
3. 只读任务给出证据和结论；修改任务落实到正确仓库的最小改动、验证和交付顺序。修改前遵守该仓库规则；用户当前明确指定的流程优先，本 skill 不额外引入审批或一律跳过开发规范。
4. 区分“代码定义”“文档描述”“平台已配置”“实际部署成功”。平台脚本未在本地找到时，说明需要从对应智研任务配置/日志核实，不补写一个想象中的本地路径。

凭据只记录**文件路径、变量名、allow\_\* 范围和消费 stage**。不要把 token、密码、Webhook key、DSN、kubeconfig 内容复制进输出或新配置，也不要沿用存量示例中的硬编码凭据。跨 secret 仓检索优先 `rg -l`；需要查看配置时只提取相关字段，完整 values 的渲染输出也可能含敏感内容。

用户只要求梳理或新增配置，不等于要求立即触发发布。已有发布授权不重复询问；执行外部变更时沿用已明确的环境、制品和范围。失败后先核实已完成的阶段，避免重复发审批、切流或覆盖制品。

## 输出要求

给出与本次任务有关的链路、具体文件和定位键、改动/验证结果及未核实环节。对部署至少区分：构建 SHA、镜像 tag/digest、CDN release、Chart/values 来源、智研运行记录、release/namespace。引用实际检查过的文件；滚动版本值每次现场读取，不照抄参考文档快照。
