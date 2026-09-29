# MindX 前端性能指标查询（Galileo / aegis RUM）

> 用途：查询线上真实用户性能数据（webVitals / pagePerformance / assetSpeed），
> 做版本对比、品类分解、瓶颈定位。数据由 aegis 采集器上报（见业务侧 PR #1837
> 开启的 `pagePerformance` / `webVitals` / `assetSpeed` 收集器）。
>
> 与 canonical 业务日志（`tags.code/event/module`，见 SKILL.md 主流程）是**不同的
> 数据类别**——性能数据不带业务 event/code，靠 `tags.type` 区分。先按
> `team-log-diagnosis` 完成 Galileo preflight（CLI 版本 / env / auth）。

## 数据定位

- **target**：`TAMv2.mindx`（前端 RUM target，与 canonical 日志同 target，同 `SDK-...` id）
- **namespace**：`Production`
- **过滤维度**：性能数据统一用 `tags.type` 区分，**不要用 `plugin:`**（`plugin` 在 tags 里
  但不是可查询 key；查询 DSL 用 `tags.type:<别名>`）

`tags.type` 查询别名映射（实测，别名 ≠ 落库 type 值）：

| 查询写法                | 落库 `type` 值     | plugin          | 含义                               |
| :---------------------- | :----------------- | :-------------- | :--------------------------------- |
| `tags.type:performance` | `page_performance` | pagePerformance | 页面加载 timing（首屏/白屏等）     |
| `tags.type:vitals`      | `web_vitals`       | webVitals       | Core Web Vitals（LCP/FCP/CLS/INP） |
| `tags.type:speed`       | `assets_speed`     | assetSpeed      | 单资源加载测速                     |
| `tags.type:pv`          | `spa` / `pv`       | spa             | PV / SPA 路由切换                  |

## 关键字段字典

### page_performance（`tags.type:performance`）

页面级加载分段，单位 **ms**：

| 字段                        | 含义                     |
| :-------------------------- | :----------------------- |
| `firstScreenTiming`         | **首屏时间**（核心指标） |
| `fp`                        | First Paint              |
| `ttfb`                      | 首字节时间（含后端）     |
| `dnsLookup` / `tcp` / `ssl` | 网络握手分段             |
| `contentDownload`           | 主文档下载               |
| `domParse`                  | DOM 解析                 |
| `resourceDownload`          | 资源下载总耗时           |

### web_vitals（`tags.type:vitals`）

| 字段  | 含义                      | 注意                                           |
| :---- | :------------------------ | :--------------------------------------------- |
| `LCP` | Largest Contentful Paint  | 未采到时为 `-1`，须 `and not tags.LCP:-1` 过滤 |
| `FCP` | First Contentful Paint    | 同上                                           |
| `CLS` | Cumulative Layout Shift   | 常见 `-1`（页面未产生偏移或提前卸载）          |
| `INP` | Interaction to Next Paint | 需有交互才采到                                 |

### assets_speed（`tags.type:speed`）

单资源测速，单位 ms：`assetType`(img/js/css…) / `duration` / `responseTime` /
`requestTime` / `connectTime` / `domainLookup` / `status` / `method` / `isHttps`。

## 通用维度（三类共有）

| 字段                        | 用途                                                                                                                                |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `version` / `tam_version`   | **版本对比关键**：形如 `20260902-1128-mindx-feature-1835-page-load-perf-df3311f1`，含分支名与 commit 短 SHA，可精确区分优化前后构建 |
| `from`                      | 当前路由，**按品类分解关键**：`/space/d/<nodeId>`（文档页）、`/space/home`（首页）；结合业务侧 kind 判断品类                        |
| `sampled`                   | 采样标记（`true`/`false`）；统计前确认采样口径，避免把采样数据当全量                                                                |
| `platform` / `tam_platform` | windows / macOS / iOS / android，排除端差异                                                                                         |
| `netType`                   | 4G / 3G / wifi，网络分层                                                                                                            |

## 查询范式

### 1. 拉样本看字段

```bash
galileo logs query --query 'tags.type:performance' --input '{
  "start": "2026-09-02T00:00:00+08:00",
  "end":   "2026-09-02T23:59:59+08:00",
  "target": "TAMv2.mindx",
  "namespace": "Production",
  "limit": 5,
  "sort_type": "desc"
}'
```

### 2. 版本对比（优化前后 firstScreenTiming）

用 `tags.version` 收敛到某一版本，分别查两个版本再对比中位数/分位：

```bash
# 优化前基线版本
galileo logs query \
  --query 'tags.type:performance and tags.version:"<baseline-version>"' \
  --input '{...同上, "limit": 100}'
# 优化后版本
galileo logs query \
  --query 'tags.type:performance and tags.version:"<optimized-version>"' \
  --input '{...同上, "limit": 100}'
```

> 注：`logs query` 单次最多 100 条，样本量大时用 `logs export` 导出到文件再本地统计
> 分位数（P50/P75/P90），不要用少量样本下结论。

### 3. 按品类分解

用 `tags.from` 过滤到目标文档路由（结合 nodeId → kind 判定品类），或先取一批
`from:/space/d/*` 再按 nodeId 关联业务侧品类。

### 4. 有效 web_vitals（排除未采到）

```bash
galileo logs query --query 'tags.type:vitals and not tags.LCP:-1' --input '{...}'
```

## 使用注意

- 性能字段值分布长尾，**必须取足量样本算分位数**（P50/P75/P90），单条样本无意义。
- `-1` 是"未采集到"哨兵值，不是真实性能值，统计前过滤。
- 版本对比须同口径：相同 `platform` / `netType` 区间、相同品类 `from`、相近时间窗，
  避免端 / 网络 / 流量结构差异干扰。
- 采样：`sampled` 字段标注是否被采样，跨版本对比时确认两版采样率一致。
