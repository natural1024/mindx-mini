# 四仓流程地图

以下路径相对各自仓库根目录。核对日期：2026-09-09；依据本地 checkout，非线上状态证明：MindX `75422077e`、Genie `10d6c4f97c1`、genie-secret `beef4055`、secret `7594c39`。Genie、secret 当时不在 main，后续任务应重新核对目标 ref。文档中的具体版本与开关是定位线索，实际执行配置优先。

## 1. MindX：从源码到可交付制品

```text
mindx/.cnb.yml → include .ci/mindx-release.yml
  main / pull_request → 构建 + 本地制品验证 + runtime 镜像冒烟（不上传、不推送）
  (main|release/*) / push
    → release-vars → 安装/检查/构建 → 本地制品清单
    → secret/mindx-release-cos.yaml → 双 COS 上传 → COS 清单 + CDN 验证
    → 组装 runtime context → 构建镜像 + 冒烟
    → secret/mindx-release-tcr.yaml → TCR push → 输出交付契约
    → 后续 Genie/智研部署（本流水线未自动触发）
```

| 文件                                                                                                                   | 查什么                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `.cnb.yml`                                                                                                             | 根 include、PR 检查/评审/Issue 契约、合入状态同步，以及其他自动化；不要把代码同步事件当发布 |
| `.ci/mindx-release.yml`                                                                                                | 两类构建入口、`ifModify`、stage 级 imports、串行发布顺序、分支发布锁                        |
| `.ci/mindx-release.dockerfile`                                                                                         | CNB 构建环境，与运行时镜像区分                                                              |
| `scripts/deploy/release-vars.mjs`                                                                                      | SHA 校验、基础/架构 tag、CDN 目录和环境变量                                                 |
| `scripts/deploy/verify-mindx-release.mjs`                                                                              | `local` / `remote` / `ogp` 验证；本地文件引用、上传清单、公共资源检查                       |
| `scripts/deploy/prepare-mindx-runtime-context.mjs`                                                                     | 从同一次构建复制 runtime 所需文件，生成 `.release/mindx-runtime/`                           |
| `scripts/deploy/smoke-mindx-runtime.mjs`                                                                               | 构建/启动本地容器，检查 health、HTML、manifest、缺失资源及制品一致性                        |
| `apps/mindx-webserver/ci/Dockerfile`                                                                                   | 发布实际使用的 runtime Dockerfile，由 prepare 脚本复制到 context                            |
| `apps/mindx-webserver/Dockerfile`                                                                                      | 仓库独立构建入口，不要误当发布流水线实际入口                                                |
| `apps/mindx-webserver/src/config.ts`、`src/html/`、`README.md`                                                         | Node 配置消费、HTML/OGP、运行说明                                                           |
| `apps/mindx/scripts/federation-artifacts.mjs`、`apps/mindx/rspack.federation.config.mjs`、`tools/build-config/rspack/` | Federation 制品与构建期 publicPath                                                          |
| `docs/release-workflow.md`                                                                                             | Issue / PR / 发布状态真相源；发布配置不替代业务交付契约                                     |

产物与约束：

- 构建包括 `build`、`dist`、`dist:federation:checked`、Web Server build，设置 `NX_SKIP_NX_CACHE=1`。发布先跑 typecheck/test 与 deploy 脚本测试，PR release job 使用 `ifModify` 筛选。
- 普通资源与 Federation 文件在 `apps/mindx/public/cdn/`；HTML 在 `apps/mindx/public/server-html/`。`.release/mindx-release.json` 是本次生成的验证清单，不是发布配置真相源，不要整份输出长资源列表。
- 两个 COS bucket 是 `acc-1258344699`、`client-pkg-1258344699`，key 前缀 `/web/library/<完整 SHA>/`；CDN 对应 `https://static.workbuddy.cn/web/library/<完整 SHA>`。
- `MINDX_PUBLIC_ASSET_BASE_URL` 指向该 commit 目录；`MINDX_FEDERATION_CDN_BASE_URL` 再追加 `/js/federation`。业务入口 `/space` 与静态资源 CDN 是两个边界。
- `IMAGE_VERSION_DATE` 是 **commit 日期**（流水线 TZ=Asia/Shanghai，`YYYYMMDDHHmm`）加 `-<完整 SHA>`；完整 `IMAGE_TAG` 再加 `-amd64`。不是流水线启动时间，PR 用 `pr-<SHA>-amd64`。
- 镜像仓库：`ai-copilot.tencentcloudcr.com/ai-copilot/library-frontend`。交付输出包括 repository、基础 tag、完整 tag、digest、CDN URL；CDN 验证/容器冒烟失败后不会继续推镜像。
- Helm Chart 已注入 `BASE_URL`，但 MindX `src/config.ts` 使用的是 `MINDX_*` 基址，HTML/JS/CSS 也有构建期引用。不能仅改 `staticBaseUrl` 就宣称更换了 CDN。OGP 图标使用独立稳定资源地址，也不随 commit CDN 目录迁移。

`docs/superpowers/specs/2026-09-03-mindx-cnb-release-pipeline-design.md` 可解释设计背景，但其中旧 OCI 迁移、secret 文件选择、tag 算法、端口待修事项不能当现状：本快照已无根 `.orange-ci.yml`，release imports 使用专用 `mindx-release-*.yaml`，Chart 已读取 `containerPort`。

## 2. Genie：构建入口、Chart 与两类部署路径

### CI 导航

| 文件/目录                                                                         | 作用                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.cnb.yml`                                                                        | 聚合入口，先确认具体子配置确实被 include                                                                                                                           |
| `.ci/CODEBUDDY.md`                                                                | 内联 `script` / `if` 的 POSIX sh 规则、构建工具链要求                                                                                                              |
| `.ci/common.yml`                                                                  | 公共 stage；搜索 `.STAGE_HELM_LOGIN`、`.STAGE_GET_KUBECONFIG`、`.STAGE_HELM_DEPLOY`、`.STAGE_CALL_ZHIYAN_TEST_PIPELINE`                                            |
| `.ci/apps/web/ci.yml`                                                             | Web 模块构建、双架构镜像、CDN 上传、镜像号回写 MR；搜索 `STAGE_MODIFY_MODULES`、`map_module`、`web_trigger_build_workbuddy_web`、`api_trigger_build_workbuddy_web` |
| `.ci/services/.cnb.yml`                                                           | Go 服务 build/push/update tag、手动服务选择、部分智研触发                                                                                                          |
| `.ci/apps/workbuddy-desktop/`、`.ci/apps/vscode/`、`.ci/apps/plugins_deploy.yaml` | Desktop、IDE、插件构建/分发；不是资料库镜像构建入口                                                                                                                |
| `.ci/packages/.cnb.yml`                                                           | 公共包/CLI 发布入口，按实际 include 继续追                                                                                                                         |
| `.cnb/web_trigger.yml`                                                            | 平台手动触发器表单、模块/服务选项，与 `.ci/` 中事件实现同时检查                                                                                                    |
| `.ci/web_trigger.yml`                                                             | Helm tag 打包、tag_deploy、智研审批创建/查询/更新等流程                                                                                                            |
| `docs/new-microservice-checklist.md`                                              | 新服务构建、Chart、环境配置、路由接入导航；示例值需重新核对                                                                                                        |
| `apps/web/solutions/doc/DEPLOYMENT.md`                                            | 现有前端模块的独立发布实例，含 QCI 和跨仓开关说明                                                                                                                  |

Genie Web 模块有自动回写 image tag 的流程；**MindX 资料库不是 Genie `apps/web` 中的一个待构建源码目录**。本快照的 MindX CI 只输出制品契约，不自动修改 Genie values、建 tag 更新 PR 或触发智研。新增资料库自动交接需显式实现这段连接，不能假设 Genie 通用构建流程已经覆盖。

### 资料库 Helm 定位

共同前缀：`deploy/kubernetes/helm/copilot/`。

| 路径/键                                                             | 作用                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Chart.yaml` 的 `library-frontend` dependency                       | 本地子 Chart 注册，condition 为 `library-frontend.enabled`   |
| `values.yaml` 的 `library-frontend.enabled`                         | 父 Chart 默认关闭该依赖                                      |
| `charts/library-frontend/Chart.yaml`                                | 子 Chart 元信息                                              |
| `charts/library-frontend/values.yaml` 的 `libraryFrontend`          | 子组件 enabled、image、端口、探针、资源、HPA、环境变量默认值 |
| `charts/library-frontend/templates/libraryFrontend/deployment.yaml` | 实际 image 拼接、容器端口、ENV、探针和资源消费               |
| 同目录 `service.yaml`、`hpa.yaml`、`ingress.yaml`、`rollout.yaml`   | Service、伸缩、Ingress、rollout；按问题读取                  |

默认镜像 tag 填基础 tag，模板在 `global.arch.enabled=true` 时追加 `-<arch>`。MindX 当前只构建 amd64；不要填成 `...-amd64-amd64` 或未经验证改为 arm64。端口链是 **Service 80 → targetPort http → containerPort 3000**；健康探针 `/status/health` 使用命名端口 `http`。

### 独立 release 与整包/tag_deploy 不要混用

**独立发布**：现有 Genie 前端部署文档描述 CNB 产镜像、tag 更新 MR 合入、genie-secret 开启 `standaloneReleaseEnabled`、智研 QCI 选择 `charts`、diff/upgrade、APISIX 生效。`helm-upgrade.sh` 的行为来自该部署文档，本次四仓未定位到这个脚本实体；实际下载地址、版本、values 合并顺序和 release 名需查智研任务配置/日志。

**仓内另有整包/tag 路径**：`.ci/web_trigger.yml` 的 `saas* / tag_push` 调 `.ci/tools/saas/get_info_from_tag.sh` 和 `.ci/tools/saas/helm_package.sh` 打包/上传 Helm；`tag_deploy.*` 经 `.STAGE_HELM_PULL`、`.STAGE_GET_KUBECONFIG`、`.STAGE_HELM_DEPLOY` 调 `.ci/tools/saas/deploy/<module>.sh`。`copilot.sh` 按 region/env 选择 values、namespace，并执行 diff/deploy/rollback。这是实际存在的另一条配置链，不可拿它的参数当作智研独立发布参数。

`.ci/common.yml` 的智研 test stage 用 `zhiyan-pipeline-start`，与 `.ci/web_trigger.yml` 的变更审批插件、服务测试环境的智研部署入口分别承担不同职责。看到“智研”不能直接推导为生产部署。Genie Web 发布通知中的单模块部署入口指向 QCI 项目 `15362` / 流水线 `11791660`；这里只作为重新查找入口，具体运行环境与 ID 必须现场确认。

## 3. genie-secret：环境覆盖与独立发布开关

远端：`genie-secret/genie-secret`；本地配置在 `kubernetes/helm/copilot/`。

| 文件                                 | 本快照的资料库配置                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `values-saas-staging.yaml`           | 国内预发：`standaloneReleaseEnabled: true`、`enabled: false`，含 `libraryFrontend.staticBaseUrl/runEnv` |
| `values-saas-prod.yaml`              | 国内生产：同上，另有 `libraryFrontend.image.tag` 覆盖                                                   |
| `values-saas-staging-singapore.yaml` | 国际预发：两个开关均 false，留有国际基址配置                                                            |
| `values-saas-prod-singapore.yaml`    | 国际生产：两个开关均 false，镜像 tag 为占位；不能据此认为国际发布已支持                                 |
| `values-saas-exclusive.yaml`         | 专享基线：`enabled: false`                                                                              |

其他地域、测试环境、企业模板先按文件名发现，再核实部署实际选中的配置；不要把上表扩成“所有环境都一样”。

三种开关作用不同：父层 `library-frontend.enabled` 控制伞形 Chart 依赖；`library-frontend.standaloneReleaseEnabled` 供独立部署编排判断；子 Chart 的 `libraryFrontend.enabled` 控制资源渲染。独立 release 场景前两项可以是 **false / true**，不是矛盾，也不应为了“启用”把父依赖全部打开。

基础 tag 可能在 Genie 子 Chart 和 genie-secret 环境覆盖中同时存在；本快照国内生产就有环境级 tag。修改基础文件后必须确认最终传给 Helm 的值，不能因基础 tag 变化就宣称生产升级。独立 Chart 输入与父 Chart 输入的键层级不同，平台可能提取外层 `library-frontend`；确切提取/合并规则以执行脚本为准。

该仓 `.cnb.yml` 目前定义 reviewer 与 mergeable auto-merge，不能据此宣称 values 合入即自动部署。`reviewersConfig.json` 提供审核人规则。

## 4. secret：凭据 imports 与作用范围

远端：`genie/secret`。本节只记录变量名，不记录值。

| 文件                                     | 消费方与字段                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `mindx-release-cos.yaml`                 | MindX upload stage：`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`NEW_COS_BUCKET`、`COS_ENDPOINT` |
| `mindx-release-tcr.yaml`                 | MindX push stage：`DOCKER_USER`、`DOCKER_PASS`、`DOCKER_REGISTRY`                                     |
| `cos.yaml`、`cos-sg.yaml`、`cos-cs.yaml` | Genie 相关资源上传；以具体 imports 定位，不互换区域凭据                                               |
| `tcr.yaml`、`tcr-old.yaml`               | Genie Helm/镜像认证：`TCR_*`、`DOCKER_*`、`HELM_PREFIX`、`IMAGE_PREFIX` 等，按消费者确认 registry     |
| `zhiyan.yaml`                            | `ZHIYAN_TOKEN`、`ZHIYAN_PROJECT_*`、`PLM_*`，用于智研触发/审批                                        |
| `cnb.yaml`                               | CNB/跨仓访问所用凭据，以消费 stage 的变量名为准                                                       |
| `kubeconfig/`                            | 集群连接配置；只定位目标环境文件，不输出内容                                                          |

MindX 两个专用文件当前限定 `allow_slugs: [x-team/mindx]`、`allow_events: [push]`、`allow_branches: [main, release/*]`。新增发布分支/事件必须同时核对入口和 imports 授权范围；不要为跑通 PR 发布放宽凭据边界。

MindX `.cnb.yml` 还引用四仓之外的 `x-team/x-team-secrets/mindx_envs.yml`，服务于通知等工程流程。发现外部 import 应标明未覆盖仓库，不把它误映射到本地 `secret`。

## 5. APISIX 与线上证据边界

- SaaS 路由：Genie `deploy/kubernetes/helm-saas-only/apisix-jobs/templates/apisix-route-configmap.yaml`，环境参数在同 Chart 的 values。
- 私有化路由：`deploy/kubernetes/helm/apisix/templates/apisix-route-configmap.yaml`，参数命名与 SaaS 模板不同。
- 本快照 SaaS `route_418` 名为 `tdocs-mindx`，`/space`、`/space/*` 指向 `library-frontend.<namespace>.svc.cluster.local:80`，Host 来自 `route.domain.copilot`。
- `saas-staging` 块注册 `set_route 526243593652798918 "$route_418"`；`saas` 生产块相应行仍是注释。生产附近注释还保留旧 upstream 描述，应以 route 实体为准。
- 因此“模板已有路由”“当前环境注册路由”“作业已经执行”“线上 APISIX 当前配置”是四份不同证据。部署镜像本身不会替代路由作业，也不能从注释行反推线上当前没有路由。
