# MindX 国内与国际镜像构建

固定 `staging` 或 `release/*` 分支的一次 push 会触发国内、国际两条发布流水线。
待验证代码先推送到 `staging`，使用本次产出的镜像完成预发验证，再合入 `main`。
`main` 的 push 不再构建或推送发布镜像；面向 `main` 的 PR 继续执行两区域的本地构建与镜像冒烟检查。
两条流水线独立构建，各有工作目录和按区域区分的发布锁；不在同一个目录并发改写制品。
共享依赖下载缓存，不复用前端构建结果（`NX_SKIP_NX_CACHE=1`）。

| 配置         | 国内 `cn`                                                   | 国际 `international`                                      |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| CDN 根地址   | `https://static.workbuddy.cn/web/library`                   | `https://download.codebuddy.ai/web/library`               |
| 镜像仓库     | `ai-copilot.tencentcloudcr.com/ai-copilot/library-frontend` | `codebuddy.tencentcloudcr.com/codebuddy/library-frontend` |
| COS bucket   | `acc-1258344699`、`client-pkg-1258344699`                   | `codebuddy-1328495429`（新加坡）                          |
| COS 密钥文件 | `mindx-release-cos.yaml`                                    | `mindx-release-cos-sg.yaml`                               |
| TCR 密钥文件 | `mindx-release-tcr.yaml`                                    | `mindx-release-tcr-sg.yaml`                               |

所有密钥文件通过 `imports` 从 `genie/secret` 的 `main` 分支导入。
授权限定为 `x-team/mindx`、事件 `push`、分支 `staging` 与 `release/*`。
国际配置复用 Genie 的 `cos-sg.yaml` 和 `tcr.yaml` 中的凭据及目标地址。
启用 staging 入口前，须先在 `genie/secret/main` 的上述四个专用密钥文件中，
将 `allow_branches` 的 `main` 替换为 `staging`，保留 `release/*`；缺少的国际专用文件须先补齐。
随后将本次流水线配置同步到固定 `staging` 分支，push 才能使用新入口。

## 制品身份与验证

- 两个镜像使用相同的 `<commit 时间>-<40 位 commit SHA>-amd64` tag，由不同仓库区分。
- 各区域静态资源上传到各自 bucket 的 `/web/library/<commit SHA>/`，不会相互覆盖。
- CDN 地址在构建时写入 HTML、JS/CSS 和 Federation manifest，并作为环境默认值写入对应镜像。
  Helm `staticBaseUrl` / 容器 `BASE_URL` 不负责切换这两份镜像的 CDN。
- Federation 的 16 位 `releaseId` 是 remoteEntry 内容哈希，与外层 40 位 commit SHA 不同。
- 每条流水线依次完成测试与构建、本地制品校验、COS 上传、远端文件清单及 CDN HEAD 校验、
  容器 smoke test、镜像推送，最后输出区域、镜像版本、摘要和 CDN 地址。
- 任一步失败会阻止该区域后续步骤；两区域独立完成，不提供跨仓库原子推送或自动回滚。
  应分别检查两个流水线结果。
- PR 同时验证国内、国际的构建和本地镜像，不引用上传凭据，也不上传制品。

本地可查看两个区域的构建参数（不上传）：

```bash
node scripts/deploy/release-vars.mjs --pr --sha "$(git rev-parse HEAD)" --region cn
node scripts/deploy/release-vars.mjs --pr --sha "$(git rev-parse HEAD)" --region international
```

## 部署边界

本流程仅构建并推送，不修改 Genie / genie-secret 的 Helm 配置，也不启用国际部署。
国际流水线沿用 Genie 的推送入口 `codebuddy.tencentcloudcr.com`。
国际生产 Helm 中的 `codebuddy-international.tencentcloudcr.com` 属于拉取端配置；
其同步规则不由本流水线管理，真正启用国际部署时需验证目标 tag 已可拉取。
