# Project Snapshot（项目现状扫描）

> 由 `start-feature` Phase 2.5 调用。产出 `.vibe/project-snapshot.json`，供需求对齐（设计师）与架构拷问（开发者）消费。`cmd-publish` 等下游 skill 也可复用。

## §1. 作用

构建 AI 在需求对齐时的"参照系"，回答三个问题：

1. **项目当前在做什么阶段？** — 避免产品/设计师提出阶段外的激进需求。
2. **已经有哪些业务实体和 UI 资产？** — 识别是否引入了新实体、新 Record 类、重复组件。
3. **最近团队在做什么？** — 判断新需求与近期方向是否协调。

## §2. 缓存规则

- 缓存文件：`.vibe/project-snapshot.json`
- TTL：**300 秒（5 分钟）**
- 命中判定：
  ```
  if exists(.vibe/project-snapshot.json)
     and now - snapshot.generated_at < snapshot.ttl_seconds:
      → 直接加载，跳过扫描
  else:
      → 重新扫描并覆写
  ```
- 失效条件（任一命中即强制重建）：
  - 文件不存在
  - `generated_at` 超过 TTL
  - JSON 解析失败

## §3. 扫描动作（未命中缓存时并发执行）

### 3.1 读取项目背景

读 `CODEBUDDY.md`，提取以下章节到 snapshot：

- `## 产品目标` → `project_goal`
- `## 当前项目阶段` → `current_phase`（取粗体行如 **阶段一（进行中）：...**）
- `## 当前项目阶段` 的当前阶段列表项 → `phase_one_scope`（字符串数组）
- `## 业务实体` 下所有条目名 → `business_entities.defined_in_docs`（**仅作为文档描述参考**，不作为判定依据）

> ⚠️ **重要**：`defined_in_docs` 是人工维护的产品语言，**不是真相源**。真相以 §3.2 扫描到的 `record_classes` 为准。两者可能偏离，§8 会做一致性校验。

### 3.2 扫描 Record 类（真相源）

目录：`packages/core-data/src/models/records/`

对该目录下每个 `.ts` 文件：

1. 识别 `class RecordXxx extends RecordBase` 定义。
2. **只提取当前类直接声明的字段**（不递归读取基类源码）。
3. 收集字段名，写入 `business_entities.record_classes[]`：

```json
{
  "name": "RecordAgent",
  "path": "packages/core-data/src/models/records/record-agent.ts",
  "fields": ["platform", "description", "status", "token"],
  "inherited_fields_ref": "base_record_fields"
}
```

> ⚠️ **不扫描基类源码**（避免每次 snapshot 都要读 `record-base.ts`）。基类字段在 §3.2.1 以硬编码方式固化到 snapshot 的 `base_record_fields` 字段中，下游消费时做集合并集。

#### 3.2.1 RecordBase 基类字段（snapshot 产出时硬编码）

所有 Record 子类 `extends RecordBase`，自动继承以下 15 个字段（来源：`packages/core-data/src/models/record-base.ts`，校对时间：2026-04-22）：

```
id, version, enabled, parentId, table, parentTable,
spaceId, title, createdBy, createdAt, updatedBy, updatedAt,
deletedBy, deletedAt, pointer
```

snapshot 产出时把上述清单完整冗余到 `business_entities.base_record_fields`，便于下游消费方无需再次解析源码。

> ⚠️ **维护约定**：`record-base.ts` 字段增删时，开发者在对应 MR 中**同步修改本文件 §3.2.1 清单**；MR 评审人检查；如未同步，记入欠债清单但不阻塞合入。规则文件与源码的滞后差异需收敛在 1 周内。

### 3.3 扫描页面复杂度

遍历 `apps/mindx/src/pages/**/*.tsx`（按页面目录聚合，每个目录产出 1 条记录）。对每个页面：

| 字段                  | 采集方式                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `component_count`     | 统计从 `@mindx/ui-components` 导入的组件数                            |
| `form_count`          | 语义识别：`<input>`、`<textarea>`、`<select>`、自定义 Form 组件的数量 |
| `button_count`        | `<button>` 及 UI 组件库 Button 出现次数                               |
| `modal_count`         | Modal / Dialog / Drawer 出现次数                                      |
| `page_form`           | 按 §4 的 MindX 页面形态分类判定                                       |
| `uses_record_classes` | 扫描该页面引用的 Record 类（字符串数组）                              |

### 3.4 读取 UI 组件清单

读 `packages/ui-components/src/index.ts` 的 `export` 声明，提取组件名数组 → `existing_ui_components`。

### 3.5 读取最近 spec

列出 `.vibe/specs/spec-*.md` 中按修改时间倒序的最近 5 个文件，读取每个文件的首个 `# ` 标题 → `recent_specs`。

### 3.6 读取最近 commit

```bash
git log --oneline -20 | cat
```

收集 commit message 列表 → `recent_commits`。

### 3.7 读取接口清单（可选）

若 `docs/api-catalog.md` 存在，解析后写入 `available_backends`；不存在则字段为 `null`。

## §4. MindX 页面形态分类

| 形态            | 典型特征                              | 代表页面                 |
| --------------- | ------------------------------------- | ------------------------ |
| **展示型**      | 只读列表/详情页，无核心写入交互       | Agent 列表、Memory 展示  |
| **文档编辑型**  | 智能文档编辑器内核，长文档 + 协作标记 | MVP 文档编辑器           |
| **对话/会话型** | 人 ↔ Agent 交互流，消息序列为主       | Agent 对话页             |
| **资产管理型**  | 多资产分类 + 批量操作 + 入库动作      | 数据源导入、工作空间管理 |
| **仪表盘型**    | 多卡片聚合 + 跨模块数据可视化         | 阶段一暂无               |

AI 对每个页面做语义判断，从上述 5 类中择一赋值到 `page_form`。

## §5. Snapshot 数据结构

```json
{
  "generated_at": "ISO 8601 时间戳",
  "ttl_seconds": 300,

  "project_goal": "MindX：AI 时代云端外挂大脑...",
  "current_phase": "阶段一（进行中）：Agent 可读可写可互动的文档底座",
  "phase_one_scope": [
    "mindx 记忆萃取与注入的基础能力",
    "本地/在线资产一键入库",
    "Skill 与第三方 Agent 插件封装",
    "MVP 文档编辑器",
    "第三方 Agent 产物回流"
  ],

  "business_entities": {
    "defined_in_docs": [
      "Workspace",
      "Document/Page",
      "DataSource",
      "Memory",
      "MemoryCard",
      "Insight",
      "Soul.md",
      "Skill",
      "MCPConnection",
      "Human",
      "Agent"
    ],
    "base_record_fields": [
      "id",
      "version",
      "enabled",
      "parentId",
      "table",
      "parentTable",
      "spaceId",
      "title",
      "createdBy",
      "createdAt",
      "updatedBy",
      "updatedAt",
      "deletedBy",
      "deletedAt",
      "pointer"
    ],
    "record_classes": [
      {
        "name": "RecordAgent",
        "path": "...",
        "fields": ["platform", "description", "status", "token"],
        "inherited_fields_ref": "base_record_fields"
      },
      {
        "name": "RecordMemory",
        "path": "...",
        "fields": ["description", "fileKey", "status"],
        "inherited_fields_ref": "base_record_fields"
      },
      {
        "name": "RecordSource",
        "path": "...",
        "fields": [
          "agentId",
          "sourceType",
          "sourceUrl",
          "fileKey",
          "contentMd5",
          "status"
        ],
        "inherited_fields_ref": "base_record_fields"
      }
    ],
    "consistency": {
      "drift_detected": false,
      "docs_only": [],
      "code_only": [],
      "note": "docs_only: 文档提到但源码无对应 Record 类的实体；code_only: 源码存在但文档未描述的 Record 类"
    }
  },

  "existing_pages": [
    {
      "path": "apps/mindx/src/pages/agent-page/pc.tsx",
      "component_count": 6,
      "form_count": 0,
      "button_count": 3,
      "modal_count": 0,
      "page_form": "展示型",
      "uses_record_classes": ["RecordAgent"]
    }
  ],

  "existing_ui_components": ["Button", "Card", "Input"],

  "recent_specs": ["spec-32: feat: ..."],
  "recent_commits": ["abc1234 feat: ..."],

  "available_backends": null
}
```

## §6. 扫描失败的降级

- 若 `CODEBUDDY.md` 不存在 → 对应字段置空，继续扫描其他项，**不阻塞**。
- 若 `packages/core-data/src/models/records/` 不存在 → `record_classes: []`。
- 若 `.vibe/specs/` 不存在 → `recent_specs: []`。
- 所有扫描动作失败 → snapshot 仍写入，字段为空，标记 `generated_at`，TTL 正常计时。下游消费方（需求对齐/架构拷问）需对空字段做容错。

## §7. 何时强制重建

下游 skill 若发现 snapshot 关键字段为空但当前项目明显有对应资产（如 Record 类存在但 `record_classes: []`），应**一次性**强制重建（删除 snapshot 文件后重新调用本流程），避免陷入错误缓存。

## §8. 实体一致性校验（扫描后必做）

> §3.1 和 §3.2 执行完毕后、写入 snapshot 之前，**必须**执行本步骤。目的是暴露"文档描述"与"源码真相"的漂移，防止下游需求对齐误判。

### 8.1 映射规则

以下映射由 AI 按语义判断，把 `defined_in_docs` 的条目对应到 `record_classes` 的类名（不是严格字符串匹配）：

| 文档实体                                    | 预期对应 Record 类                             |
| ------------------------------------------- | ---------------------------------------------- |
| Agent / Human                               | `RecordAgent`                                  |
| Memory / MemoryCard / Insight               | `RecordMemory`                                 |
| DataSource / Document/Page                  | `RecordSource`                                 |
| Workspace / Soul.md / Skill / MCPConnection | （当前可暂无对应 Record 类，记为"纯概念实体"） |

> 若出现映射表未覆盖的实体名，AI 基于语义相近度尝试匹配，匹配不到则归入 `docs_only`。

### 8.2 产出 `consistency` 字段

- `docs_only[]`：在 `defined_in_docs` 中出现、但 §8.1 映射后找不到任何对应 Record 类，**且**不属于"纯概念实体"的条目。
- `code_only[]`：在 `record_classes` 中出现但 `defined_in_docs` 未描述（或语义上无法对应）的类名。
- `drift_detected`：`docs_only.length > 0 || code_only.length > 0` 则为 `true`。

### 8.3 AI 消费 snapshot 时的强制动作

当需求对齐/架构拷问读取 snapshot 后：

1. **优先输出实体依据**：AI 在引用任何业务实体时，必须显式标注来源，如 `「RecordMemory（源码 packages/core-data/src/models/records/record-memory.ts，子类字段: description/fileKey/status；继承基类字段: id/title/createdAt/...）」`，禁止只引用文档实体名。
2. **字段存在性判定用并集**：校验某个字段是否已存在时，**必须**取 `record_classes[x].fields ∪ business_entities.base_record_fields` 的并集。禁止只查子类 `fields`（基类的 15 个通用字段如 id/title/createdAt/spaceId 等容易被漏算）。
3. **drift 提示**：若 `drift_detected: true`，AI 在需求对齐的输出开头插入一段提示：
   ```
   ⚠️ 检测到 CODEBUDDY.md 业务实体描述与源码存在偏离：
     - 文档提及但源码无对应 Record：${docs_only}
     - 源码存在但文档未描述：${code_only}
     本次对齐以源码 record_classes 为准。
   ```
4. **禁止臆造**：若产品需求中的实体名**既不在** `record_classes` **也不在**“纯概念实体”列表中，AI 必须显式提示“该实体在源码中不存在，需要先回到 Issue 澄清业务语义与可观察行为，再由研发在 implementation 设计中评估 Record、接口、迁移和兼容方案”，不得直接放行或在本地另建模型契约。

### 8.4 drift 处理原则：提示不阻塞

`drift_detected: true` **只触发提示，不阻塞管线**：

- ✅ AI 在需求对齐输出开头插入漂移提示（§8.3 第 3 条）
- ✅ AI 在引用实体时以 `record_classes`（源码真相）为准
- ❌ **不得**因为 drift 就中断 `start-feature` 管线
- ❌ **不得**要求用户先修 CODEBUDDY.md 再继续

> 设计原因：文档与代码的偏离是长期存在的维护成本，应通过"定期清理"而非"阻塞开发"解决。drift 提示是让产品知情，而非给流程设卡。
