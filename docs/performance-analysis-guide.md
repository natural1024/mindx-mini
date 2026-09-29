# 性能分析 Skill 使用指南

> MindX 的性能指标查询与分析能力已沉淀在 `log-diagnosis` skill 中
> （`apps/mindx` 仓库自有 skill，性能查询 playbook 位于
> `.codebuddy/skills/log-diagnosis/references/perf-metrics.md`）。
> 本文只讲**怎么用**；查询语法、字段字典、统计口径等技术细节由 skill 自带。

---

## 1. 怎么触发

**对 AI 直接说人话**，无需记命令。以下说法都会自动路由到性能查询能力：

- 「查一下首屏时间 / LCP / FCP」
- 「最新版本的性能怎么样」
- 「对比版本 A 和版本 B 的性能」
- 「这个页面（nodeId）慢不慢」
- 「弱网用户 / iOS 用户的表现」
- 「资源加载慢吗」
- 「为什么这个版本变慢了，帮我分析」

也可显式调用：`@command://log-diagnosis`。

## 2. 能问什么

| 你想了解的 | 示例说法                                                         |
| :--------- | :--------------------------------------------------------------- |
| 总体性能   | 「查今天 doc 页的首屏 P50/P90」                                  |
| 某次部署   | 「189a1282 这个 commit 部署后的性能」（版本号含分支+commit SHA） |
| 单个页面   | 「r9obqQp44BeAb1kAeu0KZw 这个页面的 LCP」                        |
| 前后对比   | 「优化前 a7b86397 和优化后 189a1282 对比，注意控制口径」         |
| 归因分析   | 「首屏变慢了，看看是前端还是后端的问题」                         |
| 分维度     | 「按平台 / 按网络类型 / 按品类分组看一下」                       |

## 3. AI 会做什么（自动执行）

1. **Preflight**：Galileo CLI 版本/认证检查
2. **取数**：按线索构造查询（时间窗/版本/路由/维度过滤），大样本自动导出
3. **统计**：分位数（P50/P75/P90），过滤无效哨兵值
4. **口径控制**：平台/网络构成对齐、剔除后端慢样本等干扰分离
5. **归因**：首屏变化时拆 ttfb（后端）/ resourceDownload（前端资源）/ 渲染段定位责任方
6. **结论**：数据 + 机制解释 + 建议，不只报数字

## 4. 给线索的建议（越具体越准）

- **时间范围**：精确到小时段
- **版本**：构建号或 commit SHA（如 `189a1282`，可精确定位某次部署）
- **页面**：nodeId 或路由
- **对比要求**：说明要不要控制变量（AI 默认会做）

## 5. 限制

- 性能数据有 **1-2 分钟入库延迟**，刚部署查不到属正常
- 单条样本不构成结论，AI 会主动算分位数
- 查询时间窗最长 7 天

## 6. 相关文档

- 查询技术细节与字段字典：`.codebuddy/skills/log-diagnosis/references/perf-metrics.md`
- 业务日志诊断（uid/nodeId/事件链路）：`.codebuddy/skills/log-diagnosis/SKILL.md`
- 优化方法论：`docs/performance-optimization-playbook.md`
- 项目过程档案：`docs/research/page-load-perf-baseline-1835.md`
