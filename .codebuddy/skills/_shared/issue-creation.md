# 建 CNB Issue 内容生成规约（共享 Reference）

> 本文件是**「新建 Issue」这个动作的唯一内容生成规约**。所有会触发建 Issue 的入口
> （`start-feature` 产品需求池入口 / 开发者轻量立项 / 「补 Issue」最小入口、
> `prototype-workflow`、`cmd-publish` 过期·无 Issue 分支自动修复、`issue-binding-route.mdc` 约束 5 的
> commit 前自动建 Issue）在生成 Issue **类型 / 标题 / 描述 / 标签** 时，**必须**遵循本文件。
>
> CNB CLI 不可用时的处理见 [mcp-degradation.md](./mcp-degradation.md)。

---

## 0. 先复用已有 Issue（不可跳过）

用户提供 Issue ID/URL 或明确说继续某个 Issue 时，先通过 CNB 拉取并复用该 Issue，**禁止创建重复 Issue**。只有没有可复用 Issue 时才执行后续「新建」规约。

已有 Issue 进入原型或研发前，必须包含结构化、可二元判定的验收标准（AC）。Issue AC 是唯一业务契约；聊天、README、spec、prototype 与 PR 都只能作为解释或证据。若最新需求会改变 AC，必须让产品负责人明确确认 Issue 更新，更新后重新拉取；禁止把新增范围只写进本地文件。

状态按入口决定：

- 产品/设计师只创建、记录或提交 Issue，未要求开始原型 → 需求池入口，唯一入口状态为`需求池`
- 产品原型新建/认领 → 唯一状态为 `原型中`
- 无原型的研发 Feature、Bug 或 Experience → 唯一状态为 `待研发`
- `待研发`可由需求澄清或`prototype-handoff`冻结成功后写入；研发认领并创建生产分支后才进入`开发中`

`需求池`是需求入口，不计入五态交付主线。五态交付状态标签是：`原型中`、`待研发`、`开发中`、`待发布`、`已发布`。

正文/类型校验分两种模式：

- **需求池入口**：本次仅由产品/设计师记录的 Issue，唯一状态为`需求池`。它严格执行本文三类型与网页模板契约，但可暂不包含 AC。
- **生命周期已有五态 Issue**：已经带唯一五态状态的存量 Issue。为兼容历史数据，只强制处于 open 状态并有结构化 AC；若存在任意 `type:*` 标签，则必须恰好一个合法值且与标题前缀一致，完全无 type 标签时不要求迁移。

---

## 1. 核心规约：基于「完整会话上下文 + 本地文件改动」建 Issue（不可跳过）

AI 在生成 Issue **类型、标题（subject）和描述（description）** 之前，必须同时消费：

### 信源 A · 完整会话上下文

- 通读本次会话从开头到当前的完整意图，而不是只看用户最后一条消息。
- 合并多轮澄清：若用户追加 / 修正 / 缩小 / 扩大了需求范围，issue 必须反映最终对齐后的全貌。
- 不得把对话里的举例、反例、临时设想、已否决方案当成 issue 正文需求。

### 信源 B · 本地文件改动

建 issue 前必须查看：

```bash
git status
git diff --staged
git diff
```

用 diff 校准会话意图：改动涉及的文件 / 目录 / 业务区应在 Issue 描述中体现。

### 归纳产出要求

- **类型**：按 §2.1 的确定性边界从 Feature、Bug、Experience 中选择且只选择一个。
- **标题**：按 §2.1 的映射生成，一句话覆盖本次任务核心目标。
- **描述**：正文标题、顺序和字段必须与 §2.2 对应的网页 YAML 模板一致；可选字段无内容时可省略。
- **验收标准**：需求池入口可暂不填写；进入原型或研发前必须补齐 `## 验收标准`。每条精确使用 `- [ ] AC-<n>: <可观察结果>`，并能独立判定 PASS/FAIL。
- 禁止只复制用户最后一句话当描述。

### 上下文不足时的处理

若会话上下文 + 本地改动仍不足以拟出准确标题，阻塞并向用户要一句话需求描述；禁止编造模糊占位。

---

## 2. Issue 字段规约

### 2.1 三类型唯一映射

| 类型       | 确定性边界                                                     | 唯一 type 标签    | 标题前缀 | 网页模板                                           |
| :--------- | :------------------------------------------------------------- | :---------------- | :------- | :------------------------------------------------- |
| Bug        | 违反既有明确正确行为、发生回归，或产生错误结果                 | `type:bug`        | `fix:`   | `.cnb/ISSUE_TEMPLATE/1-bug-report.yml`             |
| Experience | 能力已可用且结果正确，但存在认知、操作、效率或感受上的体验阻力 | `type:experience` | `feat:`  | `.cnb/ISSUE_TEMPLATE/2-experience-improvement.yml` |
| Feature    | 要求新增当前不支持的能力或业务结果                             | `type:feature`    | `feat:`  | `.cnb/ISSUE_TEMPLATE/0-feature-request.yml`        |

Experience 与 Feature 共用 `feat:` 前缀，必须依靠唯一 type 标签区分。每个新 Issue 必须恰好包含一个 `type:*` 标签，禁止缺失、并存或使用其它 type 标签。

按上述可观察事实自动分类，不让用户先自行三选一。只有证据仍同时支持多个边界且互相冲突时，才问一个能消除冲突的最小问题，然后继续自动分类。

标题格式为 `<映射前缀> <subject>`。

### 2.2 正文模板

AI 创建的正文必须使用下列精确 `## <字段>` 标题并保持顺序，与网页模板的字段标签一致。

**Feature**

1. `## 问题与目标`（必填）
2. `## 使用场景`（必填）
3. `## 范围`（可选）
4. `## 验收标准`（需求池入口可选；进入原型/研发前必填）
5. `## 补充材料`（可选）

**Bug**

1. `## 问题现象`（必填）
2. `## 发生位置与环境`（必填）
3. `## 复现频率`（必填；只使用网页模板选项）
4. `## 复现步骤`（必填）
5. `## 实际结果`（必填）
6. `## 预期结果`（必填）
7. `## 影响范围`（可选）
8. `## 验收标准`（需求池入口可选；进入修复前必填）
9. `## 证据`（可选）

**Experience**

1. `## 体验问题/当前阻力`（必填）
2. `## 使用场景`（必填）
3. `## 期望改善`（必填）
4. `## 优化建议`（可选）
5. `## 验收标准`（需求池入口可选；进入原型/研发前必填）
6. `## 补充材料`（可选）

### 2.3 需求池入口正文校验（强制）

需求池入口正文只允许所选网页模板字段，并执行以下确定性校验：

1. 必填 `##` 标题必须按 §2.2 的模板顺序恰好出现一次；可选标题可省略，出现时也必须在模板位置恰好一次。
2. 每个已出现字段的内容去除首尾空白后必须非空，且不能是 `待补充`、`TBD`、`TODO`、`无`、`N/A`、`NA`、`-`、`...` 或仅标点等占位内容。
3. 除模板字段外禁止未知二级标题；禁止 Route/Target/Source 元数据或任何其它模板外区块。
4. 需求池入口可完全省略 `## 验收标准`；一旦出现，该章节的每个非空行都必须精确匹配 `- [ ] AC-N: <非空可观察结果>` 或 `- [x] AC-N: <非空可观察结果>`，`N` 为正整数且 ID 唯一。
5. 原型/研发入口必须有 `## 验收标准`，至少一条符合上条格式且可独立二元判定的 AC。
6. 需求池入口禁止任何冻结 note 字段或原型交接记录；这些只可由已经分享并冻结的原型流程写入。

任一校验失败都必须在创建/晋级/分支动作前阻塞；不得自动填入占位内容蒙混通过。

### 2.4 生命周期兼容校验

生命周期已有五态 Issue 不强制迁移到新网页模板，但仍必须处于 open 状态并具有有效结构化 AC。若存在任意 `type:*` 标签，必须恰好一个 `type:feature`、`type:bug` 或 `type:experience`，并符合 §2.1 标题前缀映射；完全没有 type 标签时作为存量兼容。

生命周期正文可包含简短的原型交接记录；它只能说明 Page、冻结后推送的 prototype 分支/commit、最近一次分享的 package 摘要与当前 AC，不得取代或改写 `## 验收标准`。冻结路径必须重新读取 Issue，并以当前 AC digest 与最近分享的 source tree 对齐；AC 或 source tree 漂移时先重新分享。

### 2.5 标签（强制）

创建参数必须一次带齐唯一 type 标签和入口要求的状态：

- 产品需求池入口：带唯一 type 标签 + 唯一`需求池`标签。
- `prototype-workflow`：带唯一 type 标签 + `原型中`；五态交付状态标签必须恰好为 `原型中`。
- 开发者无原型直接立项、`start-feature` 兼容入口：带唯一 type 标签 + `待研发`；五态交付状态标签必须恰好为 `待研发`。

产品需求池入口不能直接用`待研发` / `开发中` / `待发布` / `已发布`；`待二次加工` 已退役，不再写入新 Issue。

### 2.6 负责人（强制）

- 创建时把当前操作者加为负责人。
- 默认使用 `git config user.name` 对应的 CNB username。

### 2.7 调用示例

`--labels` 每个标签必须重复传参；禁止把多个标签用逗号拼成一个参数。

产品需求池入口：

```bash
cnb issues create-issue \
  --repo x-team/mindx \
  --title "<feat|fix>: <subject>" \
  --body "<description>" \
  --labels "<type-label>" \
  --labels "需求池" \
  --assignees "<username>"
```

原型/研发入口：

```bash
cnb issues create-issue \
  --repo x-team/mindx \
  --title "<feat|fix>: <subject>" \
  --body "<description>" \
  --labels "<type-label>" \
  --labels "<原型中|待研发>" \
  --assignees "<username>"
```

---

## 3. 创建后远端复验（不可跳过）

### 3.0 创建幂等：解析响应，无法解析时做有界身份恢复（不可跳过）

1. 每次建 Issue **只允许调用一次** `cnb issues create-issue`。记录调用开始/结束时间、完整 title/body/labels/author。禁止因为 stdout 首行只有 CLI 版本号（如 `1.10.10`）就直接重试。
2. 把完整 verbose 响应与 expected 传给 `scripts/workflow/issue-create-identity.mjs` 的 `resolveCreatedIssueIdentity`。解析到 `iid` / `number` 但未带详情时它只返回 `DETAIL_REQUIRED`；此时立即 `get-issue` 拉该 IID 详情，再以 `responseIssueDetail` 调用 resolver。只有内部 `assertCreatedIssueDetail` 严格复验 IID、author、title、body 与 labels 并返回 `RESPONSE_ID` 后才能认领；不能只凭响应编号或标题认领。
3. 仅当响应无法解析 IID 时，列出当前作者最近的 open Issue，并调用 `resolveCreatedIssueIdentity`。候选必须同时满足：
   - createdAt 落在本次调用的有界时间窗；
   - author 与 title 精确相同；
   - body SHA-256 与本次正文相同；
   - 标签集合与本次创建参数相同。
4. 唯一命中才可恢复为本次创建结果；多个精确命中返回 `AMBIGUOUS` 并停止，请人工确认。**严禁按“标题 + 作者”保留最小编号、自动关闭其它 Issue**，因为同名 Issue 可能都是合法需求。
5. 0 个命中时才允许受限地再调用一次 create-issue；第二次仍无法通过响应 IID 或完整 fingerprint 唯一确认则停止。重试必须沿用完全相同的 title/body/labels/author。

后续 §3.1 复验、§3.2 标签修正及所有分支/晋级动作，都以这里确认的唯一 Issue IID 为准。

### 3.1 字段复验

用第 3.0 步确定的正式 Issue number 拉详情并校验：

1. 标题前缀、正文标题/顺序/内容通过 §2 的所选类型模板校验。
2. type 标签恰好一个且等于 §2.1 的目标标签。
3. 状态符合入口：需求池入口仅`需求池`；原型入口仅 `原型中`；研发入口仅 `待研发`。
4. 原型/研发入口的 `## 验收标准` 存在且至少包含一条格式正确、可二元判定的 AC。
5. 负责人包含创建时的当前操作者。

```bash
cnb issues get-issue --repo x-team/mindx --number <issue_iid> --verbose
```

若标签不符合要求，读取并保留其它非 type、非状态标签，只替换 type 与状态集合后覆盖设置。每个标签都要重复传 `--labels`；以下参数按实际保留标签数量展开：

```bash
cnb issues put-issue-labels \
  --repo x-team/mindx \
  --number <issue_iid> \
  --labels "<保留的其它 label 1>" \
  --labels "<保留的其它 label 2>" \
  --labels "<唯一 type-label>" \
  --labels "<需求池|原型中|待研发>"
```

修正后必须再次拉取，直到 type、状态、正文与 AC 契约全部通过；否则阻塞后续原型、分支或研发动作。所有建 Issue 的入口都必须执行本复验（含产品需求池入口、「补 Issue」最小入口和 `issue-binding-route.mdc` 约束 5 自动建）。

---

## 4. CNB CLI 不可用时

不生成本地临时 issue id，不写假分支名，不创建旧平台 fallback。提示用户执行：

```bash
cnb login --woa
```
