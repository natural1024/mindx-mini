# 工作区脏状态检测与处理（公共子程序）

> 任何需要切换 git 分支的场景，都**必须**在 checkout 前执行此子程序。
> 被 `start-feature` Phase 3 Step 2 和 `/switch-route` 命令共同引用。

---

## 1. 检测工作区状态

```bash
HAS_STAGED=$(git diff --cached --quiet 2>/dev/null; echo $?)
HAS_UNSTAGED=$(git diff --quiet 2>/dev/null; echo $?)
HAS_UNTRACKED=$(git ls-files --others --exclude-standard | head -1)
CURRENT_BRANCH=$(git branch --show-current)

echo "staged=$HAS_STAGED unstaged=$HAS_UNSTAGED untracked=$HAS_UNTRACKED branch=$CURRENT_BRANCH"
```

- `HAS_STAGED=1` 或 `HAS_UNSTAGED=1` 或 `HAS_UNTRACKED` 非空 → 工作区脏，需要处理。
- 全部为 0/空 → 工作区干净，跳过，直接继续后续步骤。

---

## 2. 处理脏状态

### 对产品经理/设计师（自动执行，无需交互）

1. 告知用户：
   ```
   📦 检测到你有未保存的改动，我先帮你保存到当前分支，然后再继续。
   ```
2. 执行提交：
   ```bash
   git add .
   git commit -m "wip: 暂存切分支前的工作进度"
   git push origin ${CURRENT_BRANCH}
   ```
3. 提交成功后继续后续步骤。

### 对开发者（交互式询问）

```
📌 当前分支 `${CURRENT_BRANCH}` 上有未提交的改动，切换分支前需要先处理，你想怎么做？
1. 自动提交到当前分支（推荐，改动不会丢失）
2. 暂存到 git stash（改动保存在 stash 中，切回来后恢复）
3. 取消操作
```

- 选择 1：`git add . && git commit -m "wip: 暂存切分支前的工作进度" && git push origin ${CURRENT_BRANCH}`
- 选择 2：`git stash push -m "auto-stash: ${CURRENT_BRANCH}"`
- 选择 3：终止，不继续
