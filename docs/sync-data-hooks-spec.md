# MindX 数据 Hook 架构指南

> 文件名为历史兼容入口。本文件不再定义 app 间“同步”流程，也不是 CI / Review 的必读门禁。

## 1. 权威边界

- Issue 中带稳定 ID 的验收标准是唯一业务契约。
- `apps/mindx` 是生产应用；其数据模型、Hook 与接口实现由研发按 Issue 独立维护。
- prototype 在一次性 `prototype/**` 分支上直接修改 `apps/mindx`，通过 transport mock 提供可执行设计证据；它不是另一个需要长期同步的 app。
- 页面 README 只可做技术导航，不能补充或改写 Issue AC。

因此，禁止以下做法：

- 为建立平行实现而复制 `/data`、Hook、parser 或页面代码；
- 以展示字段“相似匹配”生成生产业务模型；
- 让 prototype fixture 覆盖生产数据或接口约束；
- 为维持非生产证据的 Hook 签名而牺牲真实业务模型或生产架构。

## 2. 本指南的适用范围

本文件只提供 `apps/mindx` 内部的数据接入与 UI 适配建议，适用于：

- 生产分支接入 Record / Block 与真实接口；
- prototype 分支为同一套生产页面准备离线 transport mock；
- 评估 Hook、parser、service 与 Page 的职责边界。

具体实现仍以当前 `packages/core-data` 源码、类型定义和 Issue AC 为准。若本文示例与代码不一致，应更新本文或忽略示例，不得反向改代码来迁就文档。

## 3. 数据链路原则

MindX 的通用数据链路以 Record 五元操作为基础。关键批量读取与提交已经收敛到 `getRecords` / `commit` transport；登录等特别业务化接口按实际模块独立处理。

推荐的数据流：

```text
transport response
  → core-data Record / Block
  → page parser（纯映射）
  → page hook（查询、订阅、交互编排）
  → component props
  → Page
```

约束：

1. **Record / Block 是业务数据真相源**：不要在 UI Hook 中另建一套平行业务实体。
2. **parser 做纯映射**：业务数据到展示模型的转换应可独立测试，不产生请求或副作用。
3. **Hook 做编排**：负责查询、订阅、loading/error、用户动作与 service 调用，不承担大段 JSX。
4. **Page 做组合**：只消费 Hook 输出并组合组件，不解析原始接口响应。
5. **组件 props 面向展示语义**：业务组件可以接收强类型展示模型；共享原子组件不得耦合 Workspace、Agent、Memory 等业务实体。

## 4. Production implementation

`feature/**` / `bugfix/**` 中的正式实现应：

1. 从最新 `origin/main` 创建分支；
2. 读取 `packages/core-data` 的实际 Record 类型与 service API；
3. 使用真实 `getRecords` / `commit` 及模块专用接口；
4. 对实时数据使用项目既有的 MobX/reaction 或订阅机制，并在 Hook 卸载时清理；
5. 将解析逻辑放到当前 page 的 `parsers/`，跨 page 复用时先移动到公共目录；
6. 按 Issue AC 编写 parser、Hook 与交互测试；
7. 不携带 `prototype.config.json`、`apps/mindx/src/prototype/**` 或 prototype 专用构建配置。

示意代码：

```typescript
export function parseAgentRecord(record: AgentRecord): AgentViewModel {
  return {
    id: record.id,
    name: record.title,
    status: record.enabled ? "active" : "disabled",
  };
}

export function useAgentList() {
  const recordService = useRecordService();

  const agents = useMemo(
    () => recordService.agents.map(parseAgentRecord),
    [recordService.agents],
  );

  return { agents };
}
```

示例只表达职责分层。实际 Record 类名、字段、响应结构和订阅方式必须从当前源码确认。

## 5. Prototype runtime

prototype 复用完整 `apps/mindx` 路由与业务代码，只替换 transport 边界：

1. mock allowlist 至少覆盖当前页面实际需要的 bootstrap / Record 读取，以及 `commit`；
2. `/space/api` 等入口先规范化到对应 `/api` 路径再匹配 allowlist；
3. `getRecords` 返回符合真实 wire contract 的 Record 数据，不直接返回 UI view model；
4. `commit` 必须更新内存 Record store，使新增、修改、删除等交互在当前浏览器会话内可执行；
5. 未列入 allowlist 的 MindX API fail closed，并输出可定位的错误；
6. 编辑器 SDK 的脚本、样式等非数据静态资源继续加载；
7. 真实协同连接和生产 reporter 禁用；
8. mock fixture 统一放在 branch-local `apps/mindx/src/prototype/**`，由 prototype 工具生成和校验。

prototype mock 是设计证据的一部分。handoff 时应明确记录 mock 边界，避免研发把 mock 行为误认为生产接口承诺。

## 6. Hook 与 parser 检查清单

### 数据建模

- [ ] 使用现有 Record / Block / enum，而非从展示 mock 推导新业务字段
- [ ] 新业务实体确有必要时，在 Issue 与研发设计中明确，不在 prototype 中悄悄确立
- [ ] wire response、Record model、view model 三层类型没有混用

### 职责与依赖

- [ ] parser 是无副作用纯函数并有边界测试
- [ ] Hook 只负责数据/交互编排，Page 不解析接口数据
- [ ] page 私有实现留在 page 目录，跨 page 复用先上移公共目录
- [ ] 没有为同一业务建立平行 app 实现或源码复制关系

### 模式边界

- [ ] prototype 只 mock transport，未知 MindX API fail closed
- [ ] implementation 使用真实数据链路且不含 prototype runtime
- [ ] 每个测试或预览证据都引用现有 AC ID，没有新增隐含验收标准

## 7. Review 使用方式

本文件是按需参考，不是 CodeReview Agent 的固定输入。Reviewer 应优先读取：

1. Issue AC 原文或 infrastructure 工程目标；
2. 本轮 diff、调用方、类型与测试；
3. `packages/core-data` 的当前实现；
4. `docs/ui-development-spec.md`、`docs/biz-model-spec.md` 与模式对应流程文档。

只有当本轮确实涉及数据 Hook 分层时，才可用本指南辅助判断职责；任何结论都必须回到代码证据和 Issue AC，不得用本文件覆盖生产实现。
