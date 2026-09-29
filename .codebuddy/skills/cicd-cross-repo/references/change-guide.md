# 配置修改与诊断

先用 [repository-map.md](repository-map.md) 找到真实调用链。本指南的路径按所属仓库解析，示例中的版本、环境均须由本次需求和构建证据确定。

## 快速定点搜索

从 MindX 根目录运行；Genie CI 中可能有存量硬编码敏感值，先用 `-l` 定位文件，读取时屏蔽凭据/通知地址值。

```bash
rg -n 'include:|pull_request:|push:|imports:|IMAGE_VERSION_DATE' .ci/mindx-release.yml
rg -l --hidden 'map_module|STAGE_MODIFY_MODULES|BUILD_.*|zhiyan-pipeline-start' ../genie/.ci
rg -n 'image:|containerPort|targetPort|BASE_URL|enabled:' ../genie/deploy/kubernetes/helm/copilot/charts/library-frontend
rg -l 'library-frontend|standaloneReleaseEnabled' ../genie-secret/kubernetes/helm/copilot
rg -n 'library-frontend|route_418' ../genie/deploy/kubernetes/helm-saas-only/apisix-jobs/templates/apisix-route-configmap.yaml
```

读取 secret values 时仅提取目标组件的开关、tag、端口等相关字段；普通 `rg -A100` 可能把相邻服务密码一起输出。需要了解 imports 时提取 YAML 键名与 `allow_*` 白名单，不输出整个映射。

## 修改落点

| 需求                     | 通常需要联动                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 MindX 发布分支/事件 | `.ci/mindx-release.yml` selector、发布锁、secret 两个专用 imports 的 allow\_\*；PR 继续只做本地构建/冒烟                                                                                |
| 调整构建/镜像产物        | 构建脚本、实际 runtime Dockerfile、context 复制清单、验证脚本；保持 HTML/manifest/CDN 来自同一次构建                                                                                    |
| 新增 Genie Web 模块 CI   | `.ci/apps/web/ci.yml` 变更检测、构建 jobs、国内/海外与架构支持、tag 更新、手动/API 解析与 exports、各处 `map_module`，以及 `.cnb/web_trigger.yml` 表单                                  |
| 新增 Genie 服务 CI       | `services/cmd/<service>`、`services/build/<service>`，`.ci/services/.cnb.yml` build/push/tag 更新、`BUILD_*`、选择列表/exports、架构分支；按需参照 `docs/new-microservice-checklist.md` |
| 新增 Helm 组件           | 子 Chart、父 dependency/condition、环境 values、独立发布选择器、目标架构镜像与健康探针                                                                                                  |
| 新环境或地域             | genie-secret 目标 values、实际编排的 values 选择/合并、namespace/集群、secret imports 范围与 kubeconfig 选择、registry/CDN 可达性、APISIX 对应环境注册                                  |
| 智研 charts 下拉缺项     | 核对 Chart 名与仓库入口，再核对 QCI 平台参数定义；新增本地 Chart 不会自动证明平台下拉已有该值                                                                                           |
| 资料库自动交付           | MindX 输出确定的 tag/digest/CDN → 消费它的 Genie tag 更新或 QCI 参数接口；需设计显式交接，不使用 registry 的“最新镜像”                                                                  |
| 路由/流量切换            | APISIX route、唯一 set_route ID、Host/URI/upstream、环境注册块和作业执行证据                                                                                                            |

不要照抄其他模块的包管理器或端口：Genie Web 同时存在 workspace 与独立 yarn 应用；资料库是 Node 3000，许多其他前端是 Nginx 80。新增流水线要沿用目标模块实际构建方式。

## Helm values 的正确层级

给父 Chart 的非敏感示意：

```yaml
library-frontend:
  enabled: false
  standaloneReleaseEnabled: true
  libraryFrontend:
    image:
      tag: "<IMAGE_VERSION_DATE>"
```

直接渲染独立子 Chart 时使用的示意：

```yaml
libraryFrontend:
  enabled: true
  image:
    tag: "<IMAGE_VERSION_DATE>"
```

`standaloneReleaseEnabled` 不是 Helm 内置语法，也不是子 Chart 模板的渲染开关。实际 QCI 可能先从父层环境文件提取组件配置，再叠加 global、平台参数；查执行脚本确定次序。不能把完整父层 values 直接 `-f` 给子 Chart，然后据渲染成功推断覆盖生效。

任何新值都追踪到消费点：values 声明 → 模板字段/ENV/ConfigMap → 程序读取；`staticBaseUrl → BASE_URL` 与 MindX 的构建期 `MINDX_*` 基址尤其要分别验证。

## 验证策略

按改动选择检查，不因文档改动启动完整发布：

1. **CNB**：验证 YAML、schema、入口 include、事件/分支选择器和 `!reference` 是否能解析；修改手动触发器时连表单与事件参数一起查。若有 `cnb-pipeline`，使用其实际安装位置的校验器；普通 YAML parser 不认识 `!reference` 不代表平台配置非法，单文件语法通过也不代表跨文件引用有效。
2. **Shell**：Genie `.ci/CODEBUDDY.md` 要求内联脚本和 `if` 按 POSIX sh，提取后用 `sh -n`；独立 bash 脚本用 `bash -n`。不要执行部署脚本来“验证语法”。
3. **MindX 发布工具**：在 MindX 根目录运行 `node --test scripts/deploy/*.test.mjs`。改产物契约时按 `.ci/mindx-release.yml` 的 PR 流程补本地构建和容器冒烟；没有 Docker 或缺制品时写明未验证部分，不宣称通过。
4. **Helm**：对修改的 Chart 做 lint/template；检查最终镜像、service/targetPort/containerPort、health、资源与环境值。父 Chart 与独立 Chart 分别验证；环境级验证要使用确认过的实际提取/覆盖规则。
5. **APISIX**：检查 route JSON、ID 唯一性、当前环境 set_route 是否启用、Host/path 匹配与 upstream；模板验证不等于 Admin API 已下发。

下面是**无凭据、无集群操作**的资料库子 Chart 最小检查。在 Genie 根目录执行；它只证明默认 Chart 和显式 tag 可渲染，不证明目标环境覆盖正确：

```bash
helm lint deploy/kubernetes/helm/copilot/charts/library-frontend
helm template library-frontend \
  deploy/kubernetes/helm/copilot/charts/library-frontend \
  --set-string libraryFrontend.image.tag=local-validation
```

真实 values 可能渲染出 Secret/连接串，完整结果保存在权限受限的临时文件，只输出相关的脱敏字段。不要用 `helm upgrade`、运行 `helm_package.sh`（会 push），或执行发布流水线来替代本地验证。

## 交付顺序与平台核对

对于需要真正发布的请求，沿用用户已授权的目标，给出并核实：

1. 源码 SHA、CI 成功记录、完整镜像引用/digest、CDN commit 目录。
2. Genie 基础 Chart 和 genie-secret 目标环境配置的目标 ref，以及是否有更高优先级 tag 覆盖。
3. 智研 pipeline/run、`charts` 选择、环境/地域、实际拉取的仓库与 ref、values 合并次序、release/namespace、diff/审批结果；平台不可访问时列出这些具体缺口。
4. Helm workload 健康后，再按任务范围处理网关注册/切流；核验 `/status/health`、`/space/home`、`/space/federation/v1` 与 manifest 中的 CDN 资源。
5. 回滚绑定上一套已验证 tag/digest/CDN 与必要配置，保留历史 CDN 目录。若涉及网关切流，回滚也要覆盖网关；不能只改 image tag 就声称所有发布状态回退。

提交/PR 各走所属仓库规范。MindX 的业务发布与发布后 Issue/changelog 处理见 `docs/release-workflow.md`；构建成功、PR 合入或 values 合入都不能独自证明“已发布”。

## 常见现象 → 下一份证据

| 现象                            | 优先检查                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| 发布没有触发                    | 根 include、分支/event glob、ifModify、触发配置来自哪个 ref；再查平台记录                   |
| imports 拒绝                    | secret 文件实际路径及 allow_slugs/events/branches；不是直接扩大到所有 PR                    |
| 镜像已推送但集群不变            | tag 更新/环境覆盖、QCI 是否运行、charts 参数、独立开关与 release 选择                       |
| 平台提示未知服务或 job 被跳过   | 模块表单、case、BUILD\_\* exports、map_module 与架构分支是否全覆盖                          |
| ImagePullBackOff                | 最终渲染镜像、基础 tag 是否重复加 arch、仓库/架构是否存在、imagePullSecrets                 |
| Running 但不 Ready              | Service 80 与容器 3000 是否解耦、命名端口 http、health 路径、Node 启动时 HTML/manifest 校验 |
| HTML 正常而静态资源 404         | HTML/runtime publicPath、commit CDN 目录、双 COS 上传清单、CSS/Federation 引用完整性        |
| Service 正常但 `/space` 404/503 | APISIX Host/URI/当前环境 set_route、作业是否执行、线上 upstream/endpoints；不是只看模板定义 |
| 修改 staticBaseUrl 无变化       | 容器 BASE*URL 是否被程序消费；检查构建期 MINDX*\* 与已嵌入制品的绝对地址                    |
| prod tag 比基础 Chart 老        | genie-secret 环境 image.tag 或智研 `--set` 覆盖，实际 release values 与 imageID             |

诊断先比较同一次发布的证据，再定位根因；不要把表中的可能原因写成未经核实的事实。
