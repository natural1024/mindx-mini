# Command: `/switch-route <route_id>`

> 允许用户随时切换活跃路由。必须安全处理未提交的代码，对设计师全程屏蔽技术细节。

---

## Step 1: 校验路由

1. 读取 `.vibe/branch-routes.json`，校验 `route_id` 是否存在于 `routes` 中。
2. 若不存在：列出所有可用路由供用户选择，终止。
3. 若存在：继续。

## Step 2: 处理工作区脏状态

→ 执行 [工作区脏状态检测与处理](./dirty-workspace-handler.md)。

- 工作区干净 → 直接进入 Step 3。
- 工作区脏 → 按子程序处理完毕后继续 Step 3。
- 用户选择取消 → 终止，不切换。

## Step 3: 切换 git 分支

更新活跃路由并切换到目标路由对应的分支：

```bash
# 更新活跃路由
echo "<route_id>" > .vibe/active-route

# 查找该路由下用户最近工作的 feature 分支
TARGET_SOURCE=$(从 routes 中取 route_id 对应的 source_branch)
LAST_BRANCH=$(git branch --list "feature/*" --sort=-committerdate | head -20)
```

在本地分支中查找属于目标路由的最近 feature 分支：

1. 遍历本地 `feature/*` 分支，提取分支名中的 issue_id。
2. 读取对应的 `.vibe/specs/spec-<issue_id>.md`，检查其中的 `route_id` 是否与目标路由匹配。
3. 找到匹配分支 → `git checkout <该分支>`。
4. 未找到 → 停留在当前状态，告知用户下次执行 `/start-feature` 时会自动在新路由下创建分支。

## Step 4: 输出结果

**对产品经理/设计师**（屏蔽所有技术细节）：

```
✅ 已切换到「<路由名称>」需求。
📦 之前的改动已安全保存，不会丢失。
💡 现在可以告诉我你要做什么，我来帮你。
```

**对开发者**：

```
✅ 已切换活跃路由: ${old_route_id} → ${route_id}
📌 目标分支: ${target_branch}
🔀 当前 git 分支: ${当前分支}
```
