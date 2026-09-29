# CNB CLI 容灾机制（共享 Reference）

> 本文件定义 CNB CLI 不可用时的降级策略，被 `start-feature` 和 `cmd-publish` 共同引用。

---

## 1. CNB CLI 健康检测

本地 AI 工作流统一使用开发者本人的 `cnb` CLI 登录态，不使用公共 PAT，不使用旧平台 MCP 作为 Issue / PR fallback。

探活命令：

```bash
cnb status
```

- 输出已登录 → 记录 `CNB_CLI_AVAILABLE=true`
- 未登录 / 过期 / 报错 → 记录 `CNB_CLI_AVAILABLE=false`，提示用户执行：

```bash
cnb login --woa
```

### 降级提示

**对产品经理/设计师**：

```
⚠️ CNB CLI 暂时不可用，无法自动创建 Issue / PR。
我会先把本地改动和需求信息保留好。请让开发者执行 `cnb login --woa` 后继续。
```

**对开发者**：

```
⚠️ CNB CLI 未登录或不可用。
请先执行 `cnb login --woa`，再重试当前流程。
```

---

## 2. 降级模式定义

CNB CLI 不可用时：

- `start-feature` / 「补 issue」：阻断远端 Issue 创建，不生成本地假 issue id。
- `cmd-publish`：代码本地提交可继续，但 PR 创建 / 更新、Issue 评论、状态流转必须暂停，等 `cnb login --woa` 后重试。
- 不再创建 `.vibe/mcp-debt.json` 欠债清单；本次迁移后 CNB 是唯一协作入口，远端协作动作必须真实落到 CNB。

---

## 3. Issue 创建降级

无法调用 `cnb issues create-issue` 时：

1. 不生成 `LOCAL-<ts>` 临时 ID。
2. 不切带假 issue id 的分支。
3. 输出阻断信息并提示登录：

```bash
cnb login --woa
```

原因：commit message 的 `#<issueid>` 已解释为 CNB Issue IID，使用本地假 ID 会污染 commit / PR description 契约。

---

## 4. PR 管理降级

无法调用 `cnb pulls post-pull` / `cnb pulls patch-pull` 时：

- 不创建旧平台 MR fallback。
- 不写 `.vibe/mcp-debt.json`。
- 开发者可先完成本地 commit / push，恢复 CNB CLI 后重试 `/publish`。

---

## 5. 角色阻断规则（仅 cmd-publish 使用）

| 角色                | 在 start-feature 中                         | 在 cmd-publish 中                           |
| ------------------- | ------------------------------------------- | ------------------------------------------- |
| **开发者**          | 阻断远端 Issue 创建，提示 `cnb login --woa` | 本地 commit 可继续；PR / Issue 远端动作暂停 |
| **产品经理/设计师** | 阻断远端 Issue 创建，提示开发者处理登录态   | 阻断 publish                                |

### 产品经理被阻断时的提示

```
🚫 CNB CLI 暂时不可用，无法自动创建 PR。
你的代码和本地改动仍然保留。请让开发者完成 `cnb login --woa` 后，再输入 /publish 继续。
```

### 开发者降级提示

```
⚠️ CNB CLI 未登录或不可用。
- ✅ 本地代码改动仍可继续
- ⏸️ PR 创建 / 更新、Issue 评论和状态流转暂停
- ▶️ 执行 `cnb login --woa` 后，重新运行当前流程
```
