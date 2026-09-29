# 错误码国际化（retcode → i18n）改造说明与已知边界

> 本次为**纯前端**改造，不依赖后端（spaceengine）配合。目标：前端错误提示不再直接透传
> 后端中文 `msg`，而是以业务错误码（retcode）为优先键映射到可国际化文案，实现 zh-CN /
> en-US / zh-HK 三语覆盖。

## 一、核心机制

### 1. retcode 优先解析链（`packages/request/src/intercept-axios.ts` → `handleBusinessErrorCode`）

文案按以下优先级逐级回退（“优先”指 **retcode 映射优先于后台 `msg`**，而非优先于 `customMsg`）：

```
customMsg（调用方 errorMsg，业务显式覆盖意图，最高优先级，现状不变）
  → resolveRetcodeMessage(retcode)（本次新增核心：命中全局映射→词条翻译；未命中→通用兜底翻译）
  → 后台 msg（仅“未注入 resolver”时的过渡兜底）
  → "服务繁忙，请稍后重试"（msg 缺失且无 resolver 时的默认常量）
```

- **注入后**：retcode 文案优先于后台中文 `msg`，外语环境零中文外露。
- **未注入 resolver（sandbox / 单测）**：退化为 `customMsg ?? msg ?? 默认常量`，与改造前完全一致，零回归。

### 2. 全局映射层（`packages/request/src/retcode-messages.ts`）

- `RETCODE_MESSAGE_KEYS`：纯数据「retcode → 中文词条 key」映射（含网络层负数码 `-1`/`-2`）。
- `createRetcodeResolver($t)`：resolver 工厂，`$t` 在错误发生时才求值，跟随当前语言，不在模块加载时固化。
- `@mindx/request` **零 i18n 依赖**；翻译由 `apps/mindx` 通过 `configureRequest({ resolveRetcodeMessage })` 注入。

### 3. 网络层文案 i18n（决策四）

`ErrorCode.Network(-1)` / `ErrorCode.Cancelled(-2)` 作为负数 retcode 纳入映射表，
`transport.ts` 与 `intercept-axios.ts` 的「网络异常，请稍后重试」「请求已取消」改走 resolver，
未注入时回退现有中文常量。

### 4. 散落映射收敛策略

| 散落映射                                                                | 处理              | 理由                                   |
| :---------------------------------------------------------------------- | :---------------- | :------------------------------------- |
| `NODE_MOVE_ERROR_MESSAGES`（core-data，56031-56034）                    | ✅ 收敛引用全局表 | 与全局表码值**重叠**，不收敛会文案漂移 |
| `workspace-exception-page`（56031-56034）                               | ✅ 收敛引用全局表 | 同上                                   |
| `CREATE_DATA_SOURCE_ERROR_MESSAGES`（import-kit，698301-698308/696003） | ⛔ 保持独立       | 见下方「已知边界 · 5」                 |

## 二、已知边界（本次不落地，明确声明）

### 1. retcode 全部来自 HTTP 200 body

映射层只作用于 `bizCode = resp.code ?? resp.retcode`（HTTP 200 的业务码），不处理传输层 status。

### 2. 401 / 12100（未登录）—— 不进 retcode 映射

后端 `v2StatusMap` 将其覆写为真实 HTTP 401，由传输层（`intercept-fetch.ts` / `intercept-xhr.ts`）
统一 `on401 → redirectToLogin` 跳登录，不进入业务码文案链。

### 3. 非 200 HTTP status（400/403/404/500）—— 不做差异化

现状被 axios response interceptor 统一包成 `ErrorCode.Network`，仅由上述「网络层文案 i18n」覆盖，
本次**不做按 status 的差异化区分**。

### 4. `needErrorCode: true` 的调用点 —— 各业务层自理 i18n

这些接口 `return` 原始 `{ code, msg, data }`，**不进** `handleBusinessErrorCode`，
由业务层自行按 `code` 分支提示，其 i18n 由各业务自理。本次仅声明为已知边界，不强制落地：

- `apps/mindx/src/services/login/index.ts`
- `apps/mindx/src/services/page-database/index.ts`
- `apps/mindx/src/services/sms/index.ts`
- `apps/mindx/src/services/wechat-jssdk/index.ts`
- `apps/mindx/src/services/link-info/index.ts`
- `apps/mindx/src/services/wechat-short-link.ts`
- `apps/mindx/src/config/smart-engine-request.ts`
- `apps/mindx/src/pages/wb-home-page/hooks/use-wb-recent-guide.ts`
- `packages/import-kit/src/services/raw-data/index.ts`
- `packages/import-kit/src/services/raw-data/third-party/index.ts`

### 5. import-kit `CreateDataSourceErrorCode`（698xxx / 696003）—— 保持独立码域

**未收敛进全局表**，理由：

- 这些是 import-kit **专属业务码**，不属于后端 spaceengine 通用 retcode 全集，与全局表码值**不重叠**（无文案漂移风险）；
- 现状 `getCreateDataSourceErrorMessage()` 已正确 `$t` 化、调用时求值（无语言固化坑），词条注册在 import-kit 自有 ns（`import-kit.json`）；
- 走 `needErrorCode: true` 业务自理路径，不进 `handleBusinessErrorCode`；
- 强行搬入 `@mindx/request` 协议层会引入跨业务域耦合与词条 ns 归属混乱，收益仅“理论单一源”。

收敛原则总结：**收敛与全局表重叠、会漂移的映射；保留已良好 i18n 化的独立业务码域。**

## 三、词条

新增词条三语齐备（zh-CN / en-US / zh-HK），登记在 `apps/mindx/src/locales/`。
词条 key 使用简体中文原文，与仓库既有约定一致。
