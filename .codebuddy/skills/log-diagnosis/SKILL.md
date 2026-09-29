---
name: log-diagnosis
description: 诊断 MindX host 的 request、workspace、smart-engine、collab、上传和 SDK canonical 日志链路；修改这些链路的日志事件、字段或观测顺序时也使用，以同步领域事件目录。默认诊断只查询和报告。
---

# MindX Log Diagnosis

先使用共享 `team-log-diagnosis` 完成 Galileo 环境、认证、查询语法和通用链路检查。本 Skill 只补充
MindX host 当前事件、查询顺序和故障归属，不复制通用 logger 规范。

查询前读取 [events-and-timelines.md](references/events-and-timelines.md)，并从当前
`apps/mindx/src/routers/index.tsx` 的 `initReporter({ tamToken })` 读取 target。禁止沿用本 Skill、旧日志
Skill 或历史 PR 中曾出现的 target。

## 查询顺序

1. 用时间窗加 `tags.uid` 或 `tags.nodeId` 确认当前用户/文档样本。
2. 用 `tags.logNamespace:mindx` 和 `tags.sdkName:@mindx/app-mindx` 查 host 事实。
3. 按用户动作选择 `tags.module`、`tags.event`、`tags.code`；不要先搜 message。
4. 涉及内容 SDK 时，用其 sdkName/logNamespace 查 producer entry，再回到 MindX 的 smart-engine、collab
   或 request 时间线。
5. 查不到时按共享 Skill 校验 logger buffer、SDK bootstrap、Aegis 初始化、Network collect 和 Galileo
   摄入，不把 production 中没有 Console 当作故障。

## 故障归属

- SDK event 已出现、MindX 后续事件未出现：检查 host adapter、调用桥或 host 业务编排。
- `app.request` 失败且业务终态也失败：两者可以是不同事实；按 code/module 分别判断，不按条数判重复。
- smart-engine fatal 与 submitted_failed 相邻且 errorCode 相同：当前 observer 应合并为 fatal；若两条都出现，
  检查版本或 observer 去重。
- Aegis 自动 JS error 没有 canonical tags 时属于自动采集，不伪造成某个 SDK event。
- 当前代码没有对应成功/动作事件时输出“无观测点”，不能以空结果证明流程成功。

## 前端性能指标（webVitals / pagePerformance / assetSpeed）

canonical 业务日志之外，MindX 前端 target `TAMv2.mindx` 还上报 aegis RUM 性能数据
（业务侧 PR #1837 开启 `pagePerformance` / `webVitals` / `assetSpeed` 采集器）。这是
**不同的数据类别**：不带业务 event/code，靠 `tags.type` 区分（`performance` /
`vitals` / `speed`）。

需要查首屏时间、LCP/FCP/CLS、资源测速，或做**版本前后性能对比**（用 `tags.version`
区分构建）、按品类分解（用 `tags.from` 区分路由）时，读
[perf-metrics.md](references/perf-metrics.md)：内含 target/type 定位、字段字典、
版本对比与分位统计范式。性能数据同样先按共享 `team-log-diagnosis` 完成 Galileo
preflight（CLI 版本 / env / auth）。

## 维护约束

修改以下范围中的 event、code、module、关键 attributes、host context、target 来源或链路顺序时，必须在
同一变更中更新 `references/events-and-timelines.md`：

- `apps/mindx/src/services/host-observability/**`
- `apps/mindx/src/template/app.tsx`
- `apps/mindx/src/routers/index.tsx`
- `apps/mindx/src/hooks`、`services/request`、`services/upload` 中的 canonical 日志调用
- `packages/reporter/**`

仓库级 `mindx-pr-review` 负责最终 blocker 和合并判断；本 Skill 的诊断结论只提供日志专项证据。
